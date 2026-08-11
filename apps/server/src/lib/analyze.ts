import { ANALYSIS_ENGINE, type AnalysisEngine } from '../config.js'
import { complete, engineModel } from './engines.js'
import { RUBRIC_DIMENSIONS } from './prompt.js'
import type { Analysis, AnalysisFinding, RubricScore } from './types.js'

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

/**
 * Valid JSON is not the same as a usable debrief. `coerce` fills every hole it
 * finds, which is right for a report that is mostly there and wrong for one the
 * model never really wrote — that would render as a confident "lean no hire"
 * with an empty scorecard. Anything that fails this is worth another attempt.
 */
function isUsable(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const o = raw as Record<string, unknown>
  const scored = Array.isArray(o.rubric)
    ? o.rubric.filter((e) =>
        RUBRIC_DIMENSIONS.includes(String((e as Record<string, unknown>)?.dimension ?? '')),
      ).length
    : 0
  return VERDICTS.has(o.verdict as Analysis['verdict']) && scored >= RUBRIC_DIMENSIONS.length / 2
}

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
  const messages = [{ role: 'user' as const, content: prompt }]
  let lastProblem = 'unknown'

  // One retry. The prompt is expensive to produce and the session cannot be
  // redone, so a single bad sampling should not cost the whole write-up.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = extractJson(await complete({ messages, json: true }))
      if (isUsable(raw)) return coerce(raw, ANALYSIS_ENGINE, engineModel())
      lastProblem = 'the model returned JSON without a verdict or a scorecard'
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err)
    }
    if (attempt === 1) console.warn(`[analyse] attempt 1 unusable (${lastProblem}); retrying`)
  }

  throw new Error(`The debrief could not be parsed after two attempts: ${lastProblem}`)
}
