import { mmss } from './metrics.js'
import type { Metrics, Problem } from './types.js'

const pct = (x: number) => `${Math.round(x * 100)}%`
const at = (ms: number | null) => (ms === null ? 'never' : mmss(ms))

/**
 * The rubric is deliberately narrow: this is an algorithms loop, not a
 * behavioural or system-design one. Every dimension is something a Google
 * coding interviewer actually writes on the feedback form.
 */
const RUBRIC = [
  [
    'clarification',
    'Probed the ambiguities before coding, restated the problem, asked about input bounds/types.',
  ],
  [
    'approach',
    'Stated a baseline, then justified the optimisation. Did not leap to a memorised answer without reasoning.',
  ],
  ['complexity', 'Stated time AND space complexity unprompted, and got them right.'],
  [
    'correctness',
    'The final code actually solves the problem, including the cases the tests cover.',
  ],
  [
    'edge_cases',
    'Named edge cases (empties, duplicates, overflow, single element) before being forced to.',
  ],
  ['code_quality', 'Readable names, no dead ends left in, structure that a reviewer could follow.'],
  [
    'communication',
    'Kept narrating while coding. Silence during implementation is the classic failure mode.',
  ],
] as const

export function buildPrompt(
  problem: Problem,
  metrics: Metrics,
  narrative: string,
  finalCode: string,
  language: string,
  testSummary: string,
): string {
  return `You are a Google L4/L5 coding interviewer writing up a candidate immediately after an algorithms round. You are known for being fair but blunt. You do not flatter.

You have something a normal interviewer does not: a millisecond-aligned record of BOTH what the candidate said out loud AND what they typed. Use it. Your feedback must cite specific timestamps. Generic advice is worthless — the whole point of this record is that you can say "at 07:12 you said X while the editor shows you had already written Y".

=== PROBLEM ===
${problem.title} (${problem.difficulty}, pattern: ${problem.pattern})

${problem.statement}

Ambiguities a strong candidate should have raised:
${problem.ambiguities.map((a) => `- ${a}`).join('\n')}

Known pitfalls for this problem:
${problem.pitfalls.map((p) => `- ${p}`).join('\n')}

Optimal solution: ${problem.optimal.approach} — time ${problem.optimal.time}, space ${problem.optimal.space}

=== OBJECTIVE MEASUREMENTS ===
These are computed from the recording, not inferred. Treat them as fact.

Session length:            ${mmss(metrics.durationMs)}
First word spoken:         ${at(metrics.timeToFirstWordMs)}
First key pressed:         ${at(metrics.timeToFirstKeystrokeMs)}
Planning window:           ${
    metrics.planningWindowMs === null
      ? 'n/a'
      : `${Math.round(metrics.planningWindowMs / 1000)}s between first word and first keystroke${
          metrics.planningWindowMs < 0 ? ' (NEGATIVE — typed before speaking)' : ''
        }`
  }
Share of session speaking:  ${pct(metrics.talkRatio)}
Speaking pace:             ${Math.round(metrics.wordsPerMinute)} wpm
Longest silence:           ${Math.round(metrics.longestSilenceMs / 1000)}s starting at ${at(metrics.longestSilenceAtMs)}
Silent coding (typed with no narration): ${Math.round(metrics.silentCodingMs / 1000)}s across ${metrics.silentCodingSpans.length} stretch(es)
Test runs:                 ${metrics.runCount}, first at ${at(metrics.firstRunAtMs)}
Edit churn:                ${metrics.totalAdded} chars added, ${metrics.totalRemoved} removed (ratio ${metrics.churnRatio.toFixed(2)})
Pastes:                    ${metrics.pasteCount} (${metrics.pastedChars} chars)

How to read these: a churn ratio above ~0.6 usually means a wrong path was taken and rewritten. Silent coding above ~60s is the most common reason an otherwise-correct candidate gets downgraded. A negative or near-zero planning window means they started typing before they had an approach.

=== SESSION TRANSCRIPT (speech and code edits on one clock) ===
${narrative}

=== FINAL SUBMISSION (${language}) ===
\`\`\`${language}
${finalCode}
\`\`\`

=== TEST RESULTS ===
${testSummary}

=== YOUR TASK ===
Return ONLY a JSON object, no prose before or after, no markdown fence. Schema:

{
  "verdict": "strong-hire" | "hire" | "lean-hire" | "lean-no-hire" | "no-hire",
  "headline": "one sentence, max 140 chars, the single thing that decided it",
  "rubric": [
    { "dimension": "<one of: ${RUBRIC.map(([k]) => k).join(', ')}>",
      "score": 0-4,
      "max": 4,
      "evidence": "cite a timestamp or a line of their code" }
  ],
  "findings": [
    { "atMs": <int ms offset or null>,
      "severity": "critical" | "major" | "minor" | "positive",
      "title": "short, specific",
      "detail": "what happened, why it costs them, what to do instead" }
  ],
  "drills": ["concrete, repeatable practice actions"],
  "weakPatterns": ["algorithm pattern names to practise next"]
}

Rules:
- Include every one of these ${RUBRIC.length} dimensions exactly once: ${RUBRIC.map(([k, d]) => `${k} (${d})`).join(' | ')}
- 4-8 findings. At least one "positive" if anything was genuinely good, but do not invent one.
- atMs must be a real offset from the transcript so the UI can jump to it. Use null only when a finding is about the submission as a whole.
- Judge the ALGORITHM and the REASONING. Ignore typos, formatting, and anything a linter would catch.
- If they never stated complexity out loud, that is at most a 1 on "complexity" no matter how good the code is.
- If the code fails tests, "correctness" cannot exceed 2.
- Do not soften the verdict to be encouraging.`
}

export const RUBRIC_DIMENSIONS: readonly string[] = RUBRIC.map(([k]) => k)
