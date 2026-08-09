import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGES, starterCode, type Language } from './runner.js'
import type { Problem } from './types.js'

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/problems.json')

let cache: Problem[] | null = null

export async function allProblems(): Promise<Problem[]> {
  if (!cache) {
    cache = JSON.parse(await readFile(DATA, 'utf8')) as Problem[]
  }
  return cache
}

export async function getProblem(id: string): Promise<Problem | null> {
  return (await allProblems()).find((p) => p.id === id) ?? null
}

/** Everything except the hidden test cases and the answer key. Sent to the UI
 *  during a session — showing `optimal` mid-interview would defeat the point. */
export function publicView(p: Problem) {
  return {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    pattern: p.pattern,
    tags: p.tags,
    budgetMin: p.budgetMin,
    statement: p.statement,
    entry: p.entry,
    // Every supported language, including the ones whose stub is generated
    // from the signature rather than stored on the problem.
    starter: Object.fromEntries(
      (Object.keys(LANGUAGES) as Language[]).map((lang) => [lang, starterCode(p, lang)]),
    ),
    sampleTests: p.tests
      .filter((t) => !t.hidden)
      .map((t) => ({ args: t.args, expected: t.expected })),
    hiddenTestCount: p.tests.filter((t) => t.hidden).length,
  }
}

/**
 * Picks the next problem. Sessions you did badly on bias the choice toward that
 * pattern; otherwise prefer something you have not seen recently.
 */
export function chooseNext(
  problems: Problem[],
  history: Array<{ problemId: string; weakPatterns: string[] }>,
): Problem {
  const seen = new Set(history.map((h) => h.problemId))
  const weak = new Set(history.flatMap((h) => h.weakPatterns))

  const unseenWeak = problems.filter((p) => !seen.has(p.id) && weak.has(p.pattern))
  if (unseenWeak.length > 0) return unseenWeak[0]!

  const unseen = problems.filter((p) => !seen.has(p.id))
  if (unseen.length > 0) return unseen[0]!

  // Everything seen: revisit the oldest.
  const order = new Map(history.map((h, i) => [h.problemId, i]))
  return [...problems].sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0))[0]!
}
