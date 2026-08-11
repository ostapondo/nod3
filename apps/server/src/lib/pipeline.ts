import { existsSync, statSync } from 'node:fs'
import { computeMetrics, mmss, renderNarrative } from './metrics.js'
import { runDebrief } from './debrief.js'
import { detectSpeechIntervals, toWav, transcribe } from './stt.js'
import { type Language } from './runner.js'
import {
  files,
  patchMeta,
  readEvents,
  readProblem,
  writeMetrics,
  writeNarrative,
  writeSpeech,
  writeVoiced,
} from './store.js'
import type { SpeechSegment } from './types.js'
import { log, stage } from './bus.js'

/**
 * Runs after the candidate hits Finish. Each stage writes its own artefact, so
 * a failure late in the chain still leaves the earlier work on disk — a failed
 * analysis should never cost you the transcript of a session you cannot redo.
 */
export async function processSession(id: string, durationMs: number, language: Language) {
  const problem = await readProblem(id)
  if (!problem) throw new Error(`Session ${id} has no problem on disk`)

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

  // --- 3. Tests and the interviewer write-up ------------------------------
  // Lives in its own module because it reads its inputs back off disk, which is
  // what lets /reanalyse re-run just this half after a model failure.
  await runDebrief(id, language, durationMs)
  log(id, 'info', `Session written up in ${took()}.`)

  return { metrics, durationMs: mmss(durationMs) }
}
