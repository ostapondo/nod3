import { existsSync, statSync } from 'node:fs'
import { computeMetrics, mmss, renderNarrative } from './metrics.js'
import { buildPrompt } from './prompt.js'
import { analyse } from './analyze.js'
import { detectSpeechIntervals, toWav, transcribe } from './stt.js'
import { runTests, LANGUAGES, type Language } from './runner.js'
import {
  files,
  patchMeta,
  readCode,
  readEvents,
  readProblem,
  sessionDir,
  writeMetrics,
  writeNarrative,
  writeAnalysis,
  writeSpeech,
  writeVoiced,
} from './store.js'
import type { SpeechSegment } from './types.js'
import { log, publish, stage } from './bus.js'

/**
 * Runs after the candidate hits Finish. Each stage writes its own artefact, so
 * a failure late in the chain still leaves the earlier work on disk — a failed
 * analysis should never cost you the transcript of a session you cannot redo.
 */
export async function processSession(id: string, durationMs: number, language: Language) {
  const problem = await readProblem(id)
  if (!problem) throw new Error(`Session ${id} has no problem on disk`)

  const dir = sessionDir(id)
  const code = await readCode(id, LANGUAGES[language].ext)

  // Every step reports start and finish over the socket. `patchMeta` still runs
  // so a client that reloads (or cannot hold a socket) can recover the state
  // from disk — the stream is the fast path, not the only path.
  const began = Date.now()
  const took = () => `${((Date.now() - began) / 1000).toFixed(1)}s elapsed`

  // --- 1. Speech ---------------------------------------------------------
  let speech: SpeechSegment[] = []
  let voiced: Array<[number, number]> = []
  const audioPath = files.audio(id)
  if (existsSync(audioPath)) {
    const audioMb = statSync(audioPath).size / 1e6

    stage(id, 'convert', 'running', `${audioMb.toFixed(1)} MB of audio`)
    await patchMeta(id, { status: 'transcribing', stage: 'Converting audio' })
    const wavPath = files.wav(id)
    await toWav(audioPath, wavPath)
    stage(id, 'convert', 'done', '16 kHz mono')

    // Measure where speech actually is before transcribing what it says.
    stage(id, 'detect', 'running')
    voiced = await detectSpeechIntervals(wavPath)
    const voicedMs = voiced.reduce((total, [a, b]) => total + (b - a), 0)
    stage(
      id,
      'detect',
      'done',
      `${voiced.length} passages, ${Math.round(voicedMs / 1000)}s of speech`,
    )

    stage(id, 'transcribe', 'running', 'whisper.cpp, no network')
    await patchMeta(id, { status: 'transcribing', stage: 'Transcribing speech locally' })
    speech = await transcribe(wavPath)
    stage(id, 'transcribe', 'done', `${speech.length} segments · ${took()}`)
  } else {
    stage(id, 'convert', 'done', 'no audio was recorded')
    stage(id, 'detect', 'done', 'skipped')
    stage(id, 'transcribe', 'done', 'skipped')
    log(id, 'warn', 'No audio reached the server, so the speech half of the report is empty.')
  }
  await writeSpeech(id, speech)
  await writeVoiced(id, voiced)

  // --- 2. Metrics --------------------------------------------------------
  stage(id, 'align', 'running')
  await patchMeta(id, { status: 'analysing', stage: 'Aligning speech with keystrokes' })
  const events = await readEvents(id)
  const metrics = computeMetrics(events, speech, durationMs, voiced)
  await writeMetrics(id, metrics)

  const narrative = renderNarrative(events, speech, metrics)
  await writeNarrative(id, narrative)
  stage(
    id,
    'align',
    'done',
    `${Math.round(metrics.talkRatio * 100)}% talking · ${Math.round(metrics.silentCodingMs / 1000)}s silent coding`,
  )

  // --- 3. Grade the code -------------------------------------------------
  stage(id, 'tests', 'running', LANGUAGES[language].label)
  await patchMeta(id, { status: 'analysing', stage: 'Running the test suite' })
  let testSummary = 'No code was submitted.'
  if (code.trim()) {
    const run = await runTests(code, problem, language, dir)
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

  // --- 4. Interviewer write-up -------------------------------------------
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
    stage(id, 'debrief', 'done', `${analysis.verdict} · ${took()}`)
    await patchMeta(id, { status: 'ready', stage: undefined, durationMs, error: undefined })
    publish({ type: 'session', sessionId: id, status: 'ready', at: new Date().toISOString() })
  } catch (err) {
    // Transcript and metrics survive; only the write-up is missing.
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

  return { metrics, durationMs: mmss(durationMs) }
}
