import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { E2E_DATA } from '../playwright.config'

/**
 * The report page is the most complex screen and the slowest to produce for
 * real — a genuine run costs a whisper pass plus a model call. So the specs get
 * a hand-written session with the exact shape the pipeline emits.
 *
 * Anything here that drifts from the real pipeline output is a bug in this
 * file; keep the shapes in sync with `apps/server/src/lib/types.ts`.
 */
export const FIXTURE_SESSION_ID = 'e2e-fixture-session'

export default async function seed() {
  const sessions = path.join(E2E_DATA, 'sessions')
  await rm(E2E_DATA, { recursive: true, force: true })
  const dir = path.join(sessions, FIXTURE_SESSION_ID)
  await mkdir(dir, { recursive: true })

  // Most specs want the ordinary dashboard, not the first-run chooser; the
  // preference specs clear this through the API themselves.
  await writeFile(
    path.join(E2E_DATA, 'settings.json'),
    JSON.stringify({ language: 'python' }, null, 2),
    'utf8',
  )

  const problems = JSON.parse(
    await readFile(path.resolve(__dirname, '../apps/server/src/data/problems.json'), 'utf8'),
  )
  const problem = problems.find((p: { id: string }) => p.id === 'two-sum-sorted')

  const write = (name: string, value: unknown) =>
    writeFile(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8')

  await write('meta.json', {
    id: FIXTURE_SESSION_ID,
    problemId: 'two-sum-sorted',
    problemTitle: 'Two Sum in a Sorted Array',
    language: 'python',
    createdAt: '2026-08-09T12:00:00.000Z',
    status: 'ready',
    durationMs: 300_000,
  })
  await write('problem.json', problem)

  await write('speech.json', [
    { start: 2_000, end: 9_000, text: 'Okay so the array is sorted, can the values be negative?' },
    { start: 12_000, end: 20_000, text: 'I think two pointers works here instead of a hash map.' },
    { start: 250_000, end: 262_000, text: 'Time is O of n and space is constant.' },
  ])
  await write('voiced.json', [
    [2_000, 9_000],
    [12_000, 20_000],
    [250_000, 262_000],
  ])

  await writeFile(
    path.join(dir, 'events.jsonl'),
    [
      { t: 0, kind: 'phase', phase: 'start' },
      { t: 40_000, kind: 'edit', added: 120, removed: 0, lines: 6 },
      { t: 90_000, kind: 'edit', added: 90, removed: 40, lines: 9 },
      { t: 150_000, kind: 'edit', added: 60, removed: 10, lines: 11 },
      { t: 200_000, kind: 'run', passed: 6, total: 6, ok: true },
      { t: 300_000, kind: 'phase', phase: 'submit' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n',
    'utf8',
  )

  await write('metrics.json', {
    durationMs: 300_000,
    timeToFirstWordMs: 2_000,
    timeToFirstKeystrokeMs: 40_000,
    planningWindowMs: 38_000,
    talkRatio: 0.09,
    wordsPerMinute: 118,
    longestSilenceMs: 230_000,
    longestSilenceAtMs: 20_000,
    silentCodingMs: 227_000,
    silentCodingSpans: [{ start: 23_000, end: 247_000, added: 270, removed: 50 }],
    runCount: 1,
    firstRunAtMs: 200_000,
    finalPassed: 6,
    finalTotal: 6,
    churnRatio: 0.18,
    totalAdded: 270,
    totalRemoved: 50,
    speechSegments: 3,
    pasteCount: 0,
    pastedChars: 0,
  })

  await write('analysis.json', {
    verdict: 'lean-no-hire',
    headline:
      'Correct solution, but nearly four minutes of silent coding left the reasoning invisible.',
    rubric: [
      { dimension: 'clarification', score: 2, max: 4, evidence: 'One question at 00:02.' },
      { dimension: 'approach', score: 3, max: 4, evidence: 'Named two pointers at 00:12.' },
      { dimension: 'complexity', score: 3, max: 4, evidence: 'Stated only at 04:10.' },
      { dimension: 'correctness', score: 4, max: 4, evidence: '6/6 tests passing.' },
      { dimension: 'edge_cases', score: 1, max: 4, evidence: 'Never mentioned.' },
      { dimension: 'code_quality', score: 3, max: 4, evidence: 'Readable loop.' },
      { dimension: 'communication', score: 1, max: 4, evidence: '227s of silent coding.' },
    ],
    findings: [
      {
        atMs: 23_000,
        severity: 'critical',
        title: 'Went silent for the entire implementation',
        detail: 'From 00:23 to 04:07 you wrote the whole solution without a word.',
      },
      {
        atMs: 12_000,
        severity: 'positive',
        title: 'Chose two pointers for the right reason',
        detail: 'You tied the choice to sortedness rather than reciting it.',
      },
    ],
    drills: ['Narrate every loop invariant before you write the loop.'],
    weakPatterns: ['two-pointers'],
    engine: 'fixture',
    model: 'fixture',
    generatedAt: '2026-08-09T12:05:00.000Z',
  })

  await writeFile(
    path.join(dir, 'solution.py'),
    'def two_sum_sorted(nums, target):\n    lo, hi = 0, len(nums) - 1\n    return [lo, hi]\n',
    'utf8',
  )
}
