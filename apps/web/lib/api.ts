export interface ProblemSummary {
  id: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  pattern: string
  tags: string[]
  budgetMin: number
}

export interface ProblemDetail extends ProblemSummary {
  statement: string
  entry: string
  starter: Record<string, string>
  sampleTests: Array<{ args: unknown[]; expected: unknown }>
  hiddenTestCount: number
}

export interface SessionRow {
  id: string
  problemId: string
  problemTitle: string
  language: string
  createdAt: string
  status: 'recording' | 'transcribing' | 'analysing' | 'ready' | 'failed'
  durationMs?: number
  verdict: string | null
  headline: string | null
  score: number | null
  maxScore: number | null
  talkRatio: number | null
  silentCodingMs: number | null
}

export type CodeEvent =
  | { t: number; kind: 'edit'; added: number; removed: number; lines: number }
  | { t: number; kind: 'snapshot'; code: string; lines: number }
  | { t: number; kind: 'run'; passed: number; total: number; ok: boolean }
  | { t: number; kind: 'paste'; chars: number }
  | { t: number; kind: 'reveal'; what: string }
  | { t: number; kind: 'phase'; phase: 'start' | 'submit' }

export interface CaseResult {
  index: number
  hidden: boolean
  note: string | null
  passed: boolean
  got?: unknown
  expected?: unknown
  args?: unknown[]
  error?: string
}

export interface RunResponse {
  error: string | null
  message?: string
  results: CaseResult[]
  passed: number
  total: number
}

export interface Metrics {
  durationMs: number
  timeToFirstWordMs: number | null
  timeToFirstKeystrokeMs: number | null
  planningWindowMs: number | null
  talkRatio: number
  wordsPerMinute: number
  longestSilenceMs: number
  longestSilenceAtMs: number | null
  silentCodingMs: number
  silentCodingSpans: Array<{ start: number; end: number; added: number; removed: number }>
  runCount: number
  firstRunAtMs: number | null
  finalPassed: number | null
  finalTotal: number | null
  churnRatio: number
  totalAdded: number
  totalRemoved: number
  speechSegments: number
  pasteCount: number
  pastedChars: number
}

export interface Analysis {
  verdict: 'strong-hire' | 'hire' | 'lean-hire' | 'lean-no-hire' | 'no-hire'
  headline: string
  rubric: Array<{ dimension: string; score: number; max: number; evidence: string }>
  findings: Array<{
    atMs: number | null
    severity: 'critical' | 'major' | 'minor' | 'positive'
    title: string
    detail: string
  }>
  drills: string[]
  weakPatterns: string[]
  engine: string
  model: string
  generatedAt: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  at: string
}

export interface SessionDetail {
  meta: SessionRow
  problem: ProblemDetail & {
    ambiguities: string[]
    followUps: string[]
    pitfalls: string[]
    optimal: { time: string; space: string; approach: string }
    tests: Array<{ args: unknown[]; expected: unknown; hidden?: boolean; note?: string }>
  }
  events: CodeEvent[]
  speech: Array<{ start: number; end: number; text: string }>
  voiced: Array<[number, number]>
  metrics: Metrics | null
  analysis: Analysis | null
  chat: ChatTurn[]
  finalCode: string
}

export interface LanguageInfo {
  id: string
  label: string
  monaco: string
  ext: string
  /** False when the compiler is not installed on this machine. */
  available: boolean
  version: string | null
  /** Command that would make it available. */
  install: string
}

export interface Health {
  whisperReady: boolean
  analysisEngine: string
  languages: LanguageInfo[]
  /** Ordered pipeline steps, so the UI does not hard-code the backend's stages. */
  pipelineStages?: Array<{ id: string; label: string }>
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => fetch('/api/health').then(json<Health>),

  settings: () => fetch('/api/settings').then(json<{ language: string | null }>),
  saveSettings: (patch: { language?: string }) =>
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(json<{ language: string | null }>),

  problems: () => fetch('/api/problems').then(json<ProblemSummary[]>),
  nextProblem: () => fetch('/api/problems/next').then(json<{ id: string }>),
  problem: (id: string) => fetch(`/api/problems/${id}`).then(json<ProblemDetail>),

  sessions: () => fetch('/api/sessions').then(json<SessionRow[]>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(json<SessionDetail>),
  status: (id: string) =>
    fetch(`/api/sessions/${id}/status`).then(
      json<{ status: SessionRow['status']; stage: string | null; error: string | null }>,
    ),

  createSession: (problemId: string, language: string) =>
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problemId, language }),
    }).then(json<{ id: string }>),

  sendEvents: (id: string, events: CodeEvent[]) =>
    fetch(`/api/sessions/${id}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    }),

  run: (id: string, code: string, language: string) =>
    fetch(`/api/sessions/${id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, language }),
    }).then(json<RunResponse>),

  uploadAudio: (id: string, blob: Blob) => {
    const form = new FormData()
    form.append('audio', blob, 'audio.webm')
    return fetch(`/api/sessions/${id}/audio`, { method: 'POST', body: form })
  },

  finish: (id: string, durationMs: number, code: string, language: string) =>
    fetch(`/api/sessions/${id}/finish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationMs, code, language }),
    }).then(json<{ ok: boolean }>),

  /** Re-runs the tests and the write-up against what is already on disk. */
  reanalyse: (id: string) =>
    fetch(`/api/sessions/${id}/reanalyse`, { method: 'POST' }).then(json<{ ok: boolean }>),

  /**
   * Asks the interviewer a follow-up. Resolves with the whole answer, but calls
   * `onDelta` as it arrives so the UI can render it while it is still being
   * written — a debrief answer takes long enough that waiting reads as a hang.
   */
  chat: async (
    id: string,
    message: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> => {
    const res = await fetch(`/api/sessions/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok || !res.body) {
      throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line; anything after the last one
      // is a partial frame that belongs to the next read.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const event = JSON.parse(line.slice(5).trim()) as {
          delta?: string
          done?: boolean
          error?: string
        }
        if (event.error) throw new Error(event.error)
        if (event.delta) {
          answer += event.delta
          onDelta(event.delta)
        }
      }
    }
    return answer
  },
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export const VERDICT_STYLE: Record<string, { label: string; color: string }> = {
  'strong-hire': { label: 'Strong hire', color: 'var(--color-good)' },
  hire: { label: 'Hire', color: 'var(--color-good)' },
  'lean-hire': { label: 'Lean hire', color: 'var(--color-accent)' },
  'lean-no-hire': { label: 'Lean no hire', color: 'var(--color-warn)' },
  'no-hire': { label: 'No hire', color: 'var(--color-danger)' },
}
