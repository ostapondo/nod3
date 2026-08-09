import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '../../..')

export const PORT = Number(process.env.PORT ?? 4000)
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000'

/** Everything the user produces lives here. Nothing leaves this directory. */
export const DATA_DIR = process.env.NOD3_DATA ?? path.join(REPO_ROOT, 'data')
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')

export const MODELS_DIR = path.join(REPO_ROOT, 'models')

/** whisper.cpp CLI. Homebrew installs it as `whisper-cli`. */
export const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper-cli'
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? path.join(MODELS_DIR, 'ggml-small.bin')
/** `auto` lets whisper detect; pin to `en` to practise in interview language. */
export const WHISPER_LANG = process.env.WHISPER_LANG ?? 'en'

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg'

/**
 * Analysis engine.
 *   claude-code — shells out to the `claude` CLI in print mode. Uses the
 *                 subscription you already have; no API key, no extra cost
 *                 plumbing. Default because it needs zero setup.
 *   anthropic   — direct Messages API, needs ANTHROPIC_API_KEY.
 *   ollama      — fully offline, needs a local Ollama server.
 */
export type AnalysisEngine = 'claude-code' | 'anthropic' | 'ollama'
export const ANALYSIS_ENGINE = (process.env.ANALYSIS_ENGINE ?? 'claude-code') as AnalysisEngine
export const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL ?? 'sonnet'
export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b'

export const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3'

export function modelPresent(): boolean {
  return existsSync(WHISPER_MODEL)
}
