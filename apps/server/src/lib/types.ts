/**
 * All timestamps are milliseconds since the session started, so the speech
 * track and the code track share one clock. That shared clock is the whole
 * point of this app: it lets us ask "what was he saying while he wrote that?"
 */

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface TestCase {
  /** Positional args handed to the entry function. */
  args: unknown[]
  expected: unknown
  /** Hidden cases are not shown in the UI, only in the report. */
  hidden?: boolean
  /** Why this case exists — surfaced in the report when it fails. */
  note?: string
}

/**
 * The vocabulary a problem's entry point may use. Deliberately tiny: it is
 * enough for every algorithms problem in the bank, and each type has to be
 * hand-mapped into Java, C++ and Go, so growth here is not free.
 */
export type SigType = 'int' | 'bool' | 'string' | 'int[]' | 'string[]' | 'int[][]'

export interface Signature {
  params: SigType[]
  returns: SigType
}

export interface Problem {
  id: string
  title: string
  difficulty: Difficulty
  /** Canonical pattern, e.g. "two-pointers". Drives weakness tracking. */
  pattern: string
  tags: string[]
  /** Minutes a real loop would give you. */
  budgetMin: number
  statement: string
  /** Deliberately vague points a good candidate should ask about. */
  ambiguities: string[]
  /** What the interviewer escalates to once you have a working solution. */
  followUps: string[]
  optimal: { time: string; space: string; approach: string }
  /** Traps that separate a hire from a no-hire. */
  pitfalls: string[]
  entry: string
  /** Types of the entry point, used to generate harnesses for typed languages. */
  signature: Signature
  /**
   * Hand-written starters for the dynamic languages. Java, C++ and Go starters
   * are generated from `signature`, so adding a problem does not mean writing
   * five stubs by hand.
   */
  starter: Record<string, string>
  tests: TestCase[]
}

export type CodeEvent =
  | { t: number; kind: 'edit'; added: number; removed: number; lines: number }
  | { t: number; kind: 'snapshot'; code: string; lines: number }
  | { t: number; kind: 'run'; passed: number; total: number; ok: boolean }
  | { t: number; kind: 'paste'; chars: number }
  | { t: number; kind: 'reveal'; what: string }
  | { t: number; kind: 'phase'; phase: 'start' | 'submit' }

export interface SpeechSegment {
  start: number
  end: number
  text: string
}

export type SessionStatus = 'recording' | 'transcribing' | 'analysing' | 'ready' | 'failed'

export interface SessionMeta {
  id: string
  problemId: string
  problemTitle: string
  language: string
  createdAt: string
  status: SessionStatus
  /** Populated as the pipeline advances; surfaced in the UI. */
  stage?: string
  error?: string
  durationMs?: number
}

export interface Metrics {
  durationMs: number
  /** ms until the first word — long values mean you started cold. */
  timeToFirstWordMs: number | null
  /** ms until the first character typed. */
  timeToFirstKeystrokeMs: number | null
  /**
   * Gap between first word and first keystroke. Positive = you talked through
   * the approach before coding, which is what interviewers score. Negative =
   * you dove straight into the editor.
   */
  planningWindowMs: number | null
  /** Share of the session you were actually speaking. */
  talkRatio: number
  wordsPerMinute: number
  longestSilenceMs: number
  longestSilenceAtMs: number | null
  /** Time spent typing with no speech nearby — "dark coding". */
  silentCodingMs: number
  silentCodingSpans: Array<{ start: number; end: number; added: number; removed: number }>
  runCount: number
  firstRunAtMs: number | null
  finalPassed: number | null
  finalTotal: number | null
  /** removed/added characters. High churn = you rewrote a lot, i.e. wrong path. */
  churnRatio: number
  totalAdded: number
  totalRemoved: number
  speechSegments: number
  pasteCount: number
  pastedChars: number
}

export interface RubricScore {
  dimension: string
  score: number
  max: number
  evidence: string
}

export interface AnalysisFinding {
  /** ms offset this finding points at, so the UI can scrub the timeline. */
  atMs: number | null
  severity: 'critical' | 'major' | 'minor' | 'positive'
  title: string
  detail: string
}

export interface Analysis {
  verdict: 'strong-hire' | 'hire' | 'lean-hire' | 'lean-no-hire' | 'no-hire'
  headline: string
  rubric: RubricScore[]
  findings: AnalysisFinding[]
  /** Concrete next actions, not platitudes. */
  drills: string[]
  /** Pattern names to bias future problem selection toward. */
  weakPatterns: string[]
  engine: string
  model: string
  generatedAt: string
}

export interface SessionBundle {
  meta: SessionMeta
  problem: Problem
  events: CodeEvent[]
  speech: SpeechSegment[]
  finalCode: string
  metrics: Metrics
  analysis?: Analysis
}
