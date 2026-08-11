import { analyse } from './analyze.js'
import { log, publish, stage } from './bus.js'
import { buildPrompt } from './prompt.js'
import { LANGUAGES, runTests, type Language } from './runner.js'
import {
  patchMeta,
  readCode,
  readMetrics,
  readNarrative,
  readProblem,
  sessionDir,
  writeAnalysis,
} from './store.js'
import type { Analysis } from './types.js'

/**
 * The last two stages of a session: grade the code, then have the interviewer
 * write it up. Kept apart from the pipeline because it reads everything it
 * needs from disk, which means it can be run a second time. The write-up is
 * the only step that talks to a model and so the only one that fails for
 * reasons that have nothing to do with the candidate — a dropped connection
 * used to cost an interview that cannot be repeated.
 */
export async function runDebrief(
  id: string,
  language: Language,
  durationMs: number,
): Promise<Analysis> {
  const problem = await readProblem(id)
  if (!problem) throw new Error(`Session ${id} has no problem on disk`)
  const metrics = await readMetrics(id)
  if (!metrics) throw new Error(`Session ${id} has no measurements to write up`)
  const narrative = (await readNarrative(id)) ?? ''
  const code = await readCode(id, LANGUAGES[language].ext)

  const began = Date.now()

  // --- Grade the code ----------------------------------------------------
  stage(id, 'tests', 'running', LANGUAGES[language].label)
  await patchMeta(id, { status: 'analysing', stage: 'Running the test suite' })
  let testSummary = 'No code was submitted.'
  if (code.trim()) {
    const run = await runTests(code, problem, language, sessionDir(id))
    if (run.error) {
      testSummary = `Runner error (${run.error}): ${run.message ?? ''}`
      stage(id, 'tests', 'failed', `${run.error}: ${(run.message ?? '').slice(0, 140)}`)
      log(id, 'warn', `The submission did not run (${run.error}). The debrief will say so.`)
    } else {
      const lines = run.results.map((r) => {
        const tag = r.passed ? 'PASS' : 'FAIL'
        const label = r.hidden ? 'hidden' : 'sample'
        const why = r.error
          ? ` — ${r.error}`
          : r.passed
            ? ''
            : ` — got ${JSON.stringify(r.got)}, expected ${JSON.stringify(r.expected)}`
        const note = r.note ? ` [${r.note}]` : ''
        return `  ${tag} (${label}) args=${JSON.stringify(r.args)}${why}${note}`
      })
      testSummary = `${run.passed}/${run.total} passing\n${lines.join('\n')}`
      stage(id, 'tests', 'done', `${run.passed}/${run.total} passing`)
    }
  } else {
    stage(id, 'tests', 'done', 'nothing was submitted')
  }

  // --- Interviewer write-up ----------------------------------------------
  stage(id, 'debrief', 'running', 'this is the slow part')
  await patchMeta(id, { status: 'analysing', stage: 'Interviewer is writing the debrief' })
  const prompt = buildPrompt(
    problem,
    metrics,
    narrative || '(no speech and no edits were recorded)',
    code || '(nothing submitted)',
    language,
    testSummary,
  )

  try {
    const analysis = await analyse(prompt)
    await writeAnalysis(id, analysis)
    stage(
      id,
      'debrief',
      'done',
      `${analysis.verdict} · ${((Date.now() - began) / 1000).toFixed(1)}s elapsed`,
    )
    await patchMeta(id, { status: 'ready', stage: undefined, durationMs, error: undefined })
    publish({ type: 'session', sessionId: id, status: 'ready', at: new Date().toISOString() })
    return analysis
  } catch (err) {
    // Transcript and metrics survive; only the write-up is missing, and
    // /reanalyse can ask for it again without redoing any of the above.
    const message = err instanceof Error ? err.message : String(err)
    stage(id, 'debrief', 'failed', message.slice(0, 200))
    log(id, 'error', message)
    await patchMeta(id, { status: 'failed', stage: undefined, durationMs, error: message })
    publish({
      type: 'session',
      sessionId: id,
      status: 'failed',
      error: message,
      at: new Date().toISOString(),
    })
    throw err
  }
}
