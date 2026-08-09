import { execFile } from 'node:child_process'
import {
  ANALYSIS_ENGINE,
  ANALYSIS_MODEL,
  OLLAMA_MODEL,
  OLLAMA_URL,
  type AnalysisEngine,
} from '../config.js'
import { RUBRIC_DIMENSIONS } from './prompt.js'
import type { Analysis, AnalysisFinding, RubricScore } from './types.js'

/** Tools are pointless here — the whole record is already in the prompt — and
 *  letting the model wander the filesystem makes runs slow and non-deterministic. */
const NO_TOOLS = 'Bash Edit Write Read Glob Grep WebSearch WebFetch Task NotebookEdit TodoWrite'

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  // Models sometimes fence the JSON despite instructions.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    // Last resort: grab the outermost brace pair.
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('No JSON object in model output')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

async function viaClaudeCode(prompt: string): Promise<string> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--output-format', 'json', '--model', ANALYSIS_MODEL, '--disallowedTools', NO_TOOLS],
      { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000 },
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

async function viaAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANALYSIS_ENGINE=anthropic but ANTHROPIC_API_KEY is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL === 'sonnet' ? 'claude-sonnet-5' : ANALYSIS_MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return (
    body.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('') ?? ''
  )
}

async function viaOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: 'json' }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const body = (await res.json()) as { response?: string }
  return body.response ?? ''
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback

const VERDICTS = new Set<Analysis['verdict']>([
  'strong-hire',
  'hire',
  'lean-hire',
  'lean-no-hire',
  'no-hire',
])
const SEVERITIES = new Set<AnalysisFinding['severity']>(['critical', 'major', 'minor', 'positive'])

/** Never trust the model's shape — the UI renders this directly. */
function coerce(raw: unknown, engine: AnalysisEngine, model: string): Analysis {
  const o = (raw ?? {}) as Record<string, unknown>

  const rubricIn = Array.isArray(o.rubric) ? o.rubric : []
  const byDimension = new Map<string, RubricScore>()
  for (const entry of rubricIn) {
    const e = (entry ?? {}) as Record<string, unknown>
    const dimension = String(e.dimension ?? '').trim()
    if (!RUBRIC_DIMENSIONS.includes(dimension)) continue
    byDimension.set(dimension, {
      dimension,
      score: clamp(e.score, 0, 4, 0),
      max: 4,
      evidence: String(e.evidence ?? '').slice(0, 600),
    })
  }
  // Fill anything the model dropped so the report never renders a hole.
  const rubric: RubricScore[] = RUBRIC_DIMENSIONS.map(
    (d) => byDimension.get(d) ?? { dimension: d, score: 0, max: 4, evidence: 'Not assessed.' },
  )

  const findings: AnalysisFinding[] = (Array.isArray(o.findings) ? o.findings : [])
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>
      const severity = String(e.severity ?? 'minor') as AnalysisFinding['severity']
      return {
        atMs: typeof e.atMs === 'number' && Number.isFinite(e.atMs) ? Math.max(0, e.atMs) : null,
        severity: SEVERITIES.has(severity) ? severity : 'minor',
        title: String(e.title ?? 'Untitled').slice(0, 200),
        detail: String(e.detail ?? '').slice(0, 2000),
      }
    })
    .slice(0, 12)

  const verdict = String(o.verdict ?? 'lean-no-hire') as Analysis['verdict']

  return {
    verdict: VERDICTS.has(verdict) ? verdict : 'lean-no-hire',
    headline: String(o.headline ?? 'No summary produced.').slice(0, 240),
    rubric,
    findings,
    drills: (Array.isArray(o.drills) ? o.drills : [])
      .map((d) => String(d).slice(0, 300))
      .slice(0, 8),
    weakPatterns: (Array.isArray(o.weakPatterns) ? o.weakPatterns : [])
      .map((p) => String(p).slice(0, 60))
      .slice(0, 6),
    engine,
    model,
    generatedAt: new Date().toISOString(),
  }
}

export async function analyse(prompt: string): Promise<Analysis> {
  const engine = ANALYSIS_ENGINE
  const text =
    engine === 'anthropic'
      ? await viaAnthropic(prompt)
      : engine === 'ollama'
        ? await viaOllama(prompt)
        : await viaClaudeCode(prompt)

  return coerce(extractJson(text), engine, engine === 'ollama' ? OLLAMA_MODEL : ANALYSIS_MODEL)
}
