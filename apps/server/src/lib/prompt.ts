import { mmss } from './metrics.js'
import type { Analysis, Metrics, Problem } from './types.js'

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

/**
 * The debrief conversation. Same record as the write-up, plus the write-up
 * itself, minus the JSON schema — the point of this half is the part a written
 * report cannot do: answer the follow-up question the candidate actually has.
 *
 * Returned as a system prompt rather than folded into the first message so it
 * can sit behind a cache breakpoint; it is identical on every turn and it is
 * the largest thing in the request.
 */
export function buildChatSystem(
  problem: Problem,
  metrics: Metrics,
  narrative: string,
  finalCode: string,
  language: string,
  analysis: Analysis | null,
): string {
  return `You are the interviewer who just ran this algorithms round, now sitting down with the candidate afterwards to talk it through. The written debrief is already delivered and they have read it. Blunt, specific, no flattery — but this is a conversation, not a second report.

You are holding the full record of the session: everything they said, everything they typed, on one clock. Use it. When you make a claim about what happened, point at the timestamp.

=== PROBLEM ===
${problem.title} (${problem.difficulty}, pattern: ${problem.pattern})

${problem.statement}

Ambiguities a strong candidate should have raised:
${problem.ambiguities.map((a) => `- ${a}`).join('\n')}

Known pitfalls:
${problem.pitfalls.map((p) => `- ${p}`).join('\n')}

Optimal solution: ${problem.optimal.approach} — time ${problem.optimal.time}, space ${problem.optimal.space}

Follow-ups a real interviewer escalates to once the base solution works:
${problem.followUps.map((f) => `- ${f}`).join('\n')}

=== MEASUREMENTS (computed from the recording, treat as fact) ===
Session length:            ${mmss(metrics.durationMs)}
First word / first key:    ${at(metrics.timeToFirstWordMs)} / ${at(metrics.timeToFirstKeystrokeMs)}
Planning window:           ${metrics.planningWindowMs === null ? 'n/a' : `${Math.round(metrics.planningWindowMs / 1000)}s`}
Share of session speaking: ${pct(metrics.talkRatio)} at ${Math.round(metrics.wordsPerMinute)} wpm
Longest silence:           ${Math.round(metrics.longestSilenceMs / 1000)}s at ${at(metrics.longestSilenceAtMs)}
Silent coding:             ${Math.round(metrics.silentCodingMs / 1000)}s across ${metrics.silentCodingSpans.length} stretch(es)
Test runs:                 ${metrics.runCount}, first at ${at(metrics.firstRunAtMs)}
Edit churn:                +${metrics.totalAdded} −${metrics.totalRemoved} chars (ratio ${metrics.churnRatio.toFixed(2)})

=== SESSION TRANSCRIPT (speech and code edits on one clock) ===
${narrative}

=== THEIR SUBMISSION (${language}) ===
\`\`\`${language}
${finalCode}
\`\`\`

=== THE DEBRIEF YOU ALREADY WROTE ===
${
  analysis
    ? `Verdict: ${analysis.verdict} — ${analysis.headline}

Scorecard:
${analysis.rubric.map((r) => `- ${r.dimension}: ${r.score}/${r.max} — ${r.evidence}`).join('\n')}

Findings:
${analysis.findings.map((f) => `- [${f.atMs === null ? 'overall' : mmss(f.atMs)}] (${f.severity}) ${f.title}: ${f.detail}`).join('\n')}`
    : '(the write-up failed for this session, so you are working from the record alone)'
}

=== HOW TO TALK ===
- Answer the question they asked. Do not restate the debrief they have already read.
- Keep it short. A few sentences, or a code block and a few sentences. This is a conversation.
- When they ask for the optimal solution, give it in ${language} as working code, and say in one or two lines where their approach diverged from it. They have finished the round — withholding the answer now helps nobody.
- When they ask you to drill them, ask one follow-up question and stop. Wait for the answer before judging it.
- Ground your claims in the record. "At 07:12 you said X while the editor already had Y" beats any general advice.
- If they push back and they are right, say so plainly and move on.
- Their spoken words come from a local speech-to-text pass, so treat garbled words as transcription noise rather than confusion on their part.`
}
