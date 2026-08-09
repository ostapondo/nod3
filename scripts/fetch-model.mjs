#!/usr/bin/env node
// Downloads a whisper.cpp GGML model into ./models. Idempotent: skips if the
// file already exists with a plausible size.
import { createWriteStream } from 'node:fs'
import { mkdir, stat, rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODELS_DIR = path.join(ROOT, 'models')

// name -> [url, approxBytes]
const MODELS = {
  'ggml-base.bin': [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    147_951_465,
  ],
  'ggml-small.bin': [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    487_601_967,
  ],
  'ggml-medium.bin': [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    1_533_763_059,
  ],
}

const wanted = process.argv[2] ?? 'ggml-small.bin'
const entry = MODELS[wanted]
if (!entry) {
  console.error(`Unknown model "${wanted}". Options: ${Object.keys(MODELS).join(', ')}`)
  process.exit(1)
}
const [url, approx] = entry
const dest = path.join(MODELS_DIR, wanted)

await mkdir(MODELS_DIR, { recursive: true })

const existing = await stat(dest).catch(() => null)
if (existing && existing.size > approx * 0.9) {
  console.log(`✓ ${wanted} already present (${(existing.size / 1e6).toFixed(0)} MB)`)
  process.exit(0)
}

console.log(`↓ downloading ${wanted} (~${(approx / 1e6).toFixed(0)} MB)…`)
const res = await fetch(url)
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}

const tmp = `${dest}.part`
let seen = 0
let lastPrint = 0
const total = Number(res.headers.get('content-length')) || approx

const progress = new TransformStream({
  transform(chunk, controller) {
    seen += chunk.byteLength
    const pct = Math.floor((seen / total) * 100)
    if (pct >= lastPrint + 5) {
      lastPrint = pct
      process.stdout.write(`  ${pct}%\r`)
    }
    controller.enqueue(chunk)
  },
})

try {
  await pipeline(res.body.pipeThrough(progress), createWriteStream(tmp))
  await rename(tmp, dest)
  console.log(`\n✓ saved to models/${wanted}`)
} catch (err) {
  await unlink(tmp).catch(() => {})
  console.error(`\nDownload failed: ${err.message}`)
  process.exit(1)
}
