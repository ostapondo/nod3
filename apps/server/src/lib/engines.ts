import { execFile, spawn } from 'node:child_process'
import { ANALYSIS_ENGINE, ANALYSIS_MODEL, OLLAMA_MODEL, OLLAMA_URL } from '../config.js'

/**
 * The transport half of talking to a model, split out from what we ask it for.
 * The debrief wants one JSON object and can wait; the post-mortem chat wants
 * prose, arriving a token at a time, over several turns. Both run on whichever
 * of the three engines the user configured, so the difference belongs here and
 * not in every caller.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompleteOptions {
  /** Stable instructions. Cached where the engine supports it. */
  system?: string
  messages: ChatMessage[]
  /** Ask for a bare JSON object back. */
  json?: boolean
  maxTokens?: number
  /**
   * Called with each chunk of text as it arrives. Engines that cannot stream
   * call it once with the whole answer, so callers never need to branch.
   */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/** The name to report in the UI: what this engine was actually handed. */
export function engineModel(): string {
  if (ANALYSIS_ENGINE === 'ollama') return OLLAMA_MODEL
  // The CLI resolves its own alias, so quoting a full id here would be a guess.
  return ANALYSIS_ENGINE === 'anthropic' ? apiModel(ANALYSIS_MODEL) : ANALYSIS_MODEL
}

/**
 * The `claude` CLI takes short aliases; the Messages API takes full ids. Sending
 * an alias straight through was a 404 for every model except sonnet.
 */
const API_MODELS: Record<string, string> = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4-5',
}

export function apiModel(name: string): string {
  return API_MODELS[name] ?? name
}

/** Tools are pointless here — the whole record is already in the prompt — and
 *  letting the model wander the filesystem makes runs slow and non-deterministic. */
const NO_TOOLS = 'Bash Edit Write Read Glob Grep WebSearch WebFetch Task NotebookEdit TodoWrite'

/** Engines without a conversation API get the whole exchange as one document. */
function flatten(system: string | undefined, messages: ChatMessage[]): string {
  const turns = messages.map((m) =>
    m.role === 'user' ? `CANDIDATE: ${m.content}` : `INTERVIEWER: ${m.content}`,
  )
  const body =
    messages.length === 1 && messages[0]?.role === 'user'
      ? (messages[0]?.content ?? '')
      : `${turns.join('\n\n')}\n\nINTERVIEWER:`
  return system ? `${system}\n\n${body}` : body
}

// ------------------------------------------------------------- claude-code ---

const CLAUDE_ARGS = ['-p', '--model', ANALYSIS_MODEL, '--disallowedTools', NO_TOOLS]
const CLAUDE_TIMEOUT_MS = 10 * 60_000

/** One envelope at the end — what the debrief wants, since it needs the whole object. */
async function claudeOneShot(prompt: string, opts: CompleteOptions): Promise<string> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      'claude',
      [...CLAUDE_ARGS, '--output-format', 'json'],
      { maxBuffer: 32 * 1024 * 1024, timeout: CLAUDE_TIMEOUT_MS, signal: opts.signal },
      (err, out, stderr) => {
        if (err) return reject(new Error(`claude CLI failed: ${stderr || err.message}`))
        resolve(out)
      },
    )
    child.stdin?.end(prompt)
  })

  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string }
  if (envelope.is_error)
    throw new Error(`claude returned an error: ${envelope.result ?? 'unknown'}`)
  if (!envelope.result) throw new Error('claude returned an empty result')
  return envelope.result
}

/**
 * Token by token, for the chat. `--include-partial-messages` turns print mode
 * into the same `content_block_delta` stream the API emits, one event per line.
 * Without it the answer arrives whole after a long pause, which reads as a hang
 * however fast it actually was.
 */
function claudeStreaming(prompt: string, opts: CompleteOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [...CLAUDE_ARGS, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: CLAUDE_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    )

    let text = ''
    let stderr = ''
    let failure: string | null = null
    let buffer = ''

    const handle = (line: string): void => {
      if (!line.trim()) return
      let event: {
        type?: string
        is_error?: boolean
        result?: string
        event?: { type?: string; delta?: { type?: string; text?: string } }
      }
      try {
        event = JSON.parse(line) as typeof event
      } catch {
        // `--verbose` is required for stream-json and occasionally says
        // something of its own. Anything unparseable is not our stream.
        return
      }

      if (event.type === 'stream_event') {
        const inner = event.event
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
          const delta = inner.delta.text ?? ''
          text += delta
          opts.onDelta?.(delta)
        }
        return
      }

      if (event.type === 'result') {
        if (event.is_error) failure = String(event.result ?? 'unknown')
        else if (!text && event.result) {
          // No partials came through — an older CLI, or a turn that produced its
          // text some other way. Whole and late beats nothing.
          text = event.result
          opts.onDelta?.(text)
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        handle(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (err) => reject(new Error(`claude CLI failed: ${err.message}`)))
    child.on('close', (code) => {
      handle(buffer)
      if (failure) return reject(new Error(`claude returned an error: ${failure}`))
      if (!text) {
        return reject(
          new Error(
            code === 0
              ? 'claude returned an empty result'
              : `claude CLI exited ${code}: ${stderr.slice(0, 500)}`,
          ),
        )
      }
      resolve(text)
    })

    child.stdin.end(prompt)
  })
}

async function viaClaudeCode(opts: CompleteOptions): Promise<string> {
  const prompt = flatten(opts.system, opts.messages)
  return opts.onDelta ? claudeStreaming(prompt, opts) : claudeOneShot(prompt, opts)
}

// --------------------------------------------------------------- anthropic ---

/** Reads an SSE body line by line without buffering the whole response. */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      yield buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

async function viaAnthropic(opts: CompleteOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANALYSIS_ENGINE=anthropic but ANTHROPIC_API_KEY is not set')

  const streaming = Boolean(opts.onDelta)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: opts.signal ?? null,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: apiModel(ANALYSIS_MODEL),
      max_tokens: opts.maxTokens ?? 16000,
      stream: streaming,
      // The session dossier is large and identical on every turn of a chat, so
      // a breakpoint here is the difference between paying for it once and
      // paying for it per question.
      ...(opts.system
        ? { system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }] }
        : {}),
      messages: opts.messages,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`)

  if (!streaming) {
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    return (
      body.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') ?? ''
    )
  }

  if (!res.body) throw new Error('Anthropic API returned no body to stream')
  let text = ''
  for await (const line of sseLines(res.body)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    const event = JSON.parse(payload) as {
      type?: string
      delta?: { type?: string; text?: string }
      error?: { message?: string }
    }
    if (event.type === 'error') throw new Error(event.error?.message ?? 'Anthropic stream error')
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const chunk = event.delta.text ?? ''
      text += chunk
      opts.onDelta?.(chunk)
    }
  }
  return text
}

// ------------------------------------------------------------------ ollama ---

async function viaOllama(opts: CompleteOptions): Promise<string> {
  const streaming = Boolean(opts.onDelta)
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    signal: opts.signal ?? null,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: streaming,
      ...(opts.json ? { format: 'json' } : {}),
      messages: opts.system
        ? [{ role: 'system', content: opts.system }, ...opts.messages]
        : opts.messages,
    }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 500)}`)

  if (!streaming) {
    const body = (await res.json()) as { message?: { content?: string } }
    return body.message?.content ?? ''
  }

  if (!res.body) throw new Error('Ollama returned no body to stream')
  let text = ''
  // Ollama streams newline-delimited JSON rather than SSE.
  for await (const line of sseLines(res.body)) {
    if (!line) continue
    const event = JSON.parse(line) as { message?: { content?: string }; error?: string }
    if (event.error) throw new Error(`Ollama: ${event.error}`)
    const chunk = event.message?.content ?? ''
    if (!chunk) continue
    text += chunk
    opts.onDelta?.(chunk)
  }
  return text
}

export async function complete(opts: CompleteOptions): Promise<string> {
  switch (ANALYSIS_ENGINE) {
    case 'anthropic':
      return viaAnthropic(opts)
    case 'ollama':
      return viaOllama(opts)
    default:
      return viaClaudeCode(opts)
  }
}
