import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { FFMPEG_BIN, WHISPER_BIN, WHISPER_LANG, WHISPER_MODEL } from '../config.js'
import type { SpeechSegment } from './types.js'

const run = promisify(execFile)

/** Filler-only segments whisper emits during silence. Dropping them keeps the
 *  silence metrics honest — otherwise a cough reads as "he was explaining". */
const NOISE = /^[\s.,!?…-]*(\[.*?\]|\(.*?\)|♪+|um+|uh+|mm+|hmm+|ah+|oh+)?[\s.,!?…-]*$/i

export async function toWav(input: string, output: string): Promise<void> {
  // whisper.cpp wants 16 kHz mono 16-bit PCM.
  await run(FFMPEG_BIN, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    output,
  ])
}

interface WhisperJson {
  transcription?: Array<{
    offsets?: { from: number; to: number }
    text?: string
  }>
}

export async function transcribe(wavPath: string): Promise<SpeechSegment[]> {
  if (!existsSync(WHISPER_MODEL)) {
    throw new Error(`Whisper model missing at ${WHISPER_MODEL}. Run: npm run setup:model`)
  }

  // `-oj` writes <wavPath>.json next to the input.
  const outPrefix = wavPath.replace(/\.wav$/, '')
  await run(
    WHISPER_BIN,
    [
      '-m',
      WHISPER_MODEL,
      '-f',
      wavPath,
      '-l',
      WHISPER_LANG,
      '-oj',
      '-of',
      outPrefix,
      '-t',
      String(Math.max(2, Math.min(8, os.availableParallelism() - 2))),
      '--no-prints',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  )

  const jsonPath = `${outPrefix}.json`
  if (!existsSync(jsonPath)) throw new Error('whisper produced no JSON output')

  const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as WhisperJson
  await unlink(jsonPath).catch(() => {})

  const segments: SpeechSegment[] = []
  for (const t of parsed.transcription ?? []) {
    const text = (t.text ?? '').trim()
    if (!text || NOISE.test(text)) continue
    segments.push({
      start: t.offsets?.from ?? 0,
      end: t.offsets?.to ?? 0,
      text,
    })
  }
  return segments
}

export function whisperAvailable(): boolean {
  return existsSync(WHISPER_MODEL)
}

/**
 * True speech intervals, measured from the waveform rather than inferred from
 * the transcript.
 *
 * This exists because whisper's segment `end` timestamps routinely stretch to
 * meet the next segment, so a 25-second pause gets absorbed into the
 * surrounding speech. Deriving talk-time from those boundaries reported a
 * silence-heavy recording as 69% talking. Since "how long were you silent
 * while typing" is the whole product, the numbers have to come from the audio.
 */
export async function detectSpeechIntervals(
  wavPath: string,
  { noiseDb = -35, minSilenceS = 0.7 } = {},
): Promise<Array<[number, number]>> {
  const { stderr } = await run(
    FFMPEG_BIN,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      wavPath,
      '-af',
      `silencedetect=noise=${noiseDb}dB:d=${minSilenceS}`,
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  ).catch((err: { stderr?: string }) => ({ stderr: err.stderr ?? '' }))

  const durationMs = await audioDurationMs(wavPath)

  const silences: Array<[number, number]> = []
  let pendingStart: number | null = null
  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/)
    const end = line.match(/silence_end:\s*(-?[\d.]+)/)
    if (start?.[1] !== undefined) pendingStart = Math.max(0, Number(start[1]) * 1000)
    if (end?.[1] !== undefined && pendingStart !== null) {
      silences.push([pendingStart, Number(end[1]) * 1000])
      pendingStart = null
    }
  }
  if (pendingStart !== null) silences.push([pendingStart, durationMs])

  // Complement the silences to get speech.
  const speech: Array<[number, number]> = []
  let cursor = 0
  for (const [s, e] of silences) {
    if (s > cursor) speech.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < durationMs) speech.push([cursor, durationMs])

  return speech.filter(([s, e]) => e - s > 150)
}

export async function audioDurationMs(wavPath: string): Promise<number> {
  const { stderr } = await run(
    FFMPEG_BIN,
    ['-hide_banner', '-nostats', '-i', wavPath, '-f', 'null', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  ).catch((err: { stderr?: string }) => ({ stderr: err.stderr ?? '' }))

  const m = stderr.match(/time=\s*(\d+):(\d+):([\d.]+)/g)?.pop()
  const parts = m?.match(/(\d+):(\d+):([\d.]+)/)
  if (!parts) return 0
  return (Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])) * 1000
}
