import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.js'
import { isLanguage } from './runner.js'

export interface Settings {
  /** null until the first run picks one. */
  language: string | null
}

const DEFAULTS: Settings = { language: null }

const fileIn = (dir: string) => path.join(dir, 'settings.json')

/**
 * Preferences live on disk beside the sessions rather than in the browser.
 *
 * localStorage would be lost by a different browser, a cleared profile, or
 * opening the app from another machine on the network — and this app's whole
 * premise is that your data is a set of files you own.
 *
 * The directory is an explicit parameter rather than a module constant so tests
 * can point it somewhere harmless. It used to be resolved once at import time;
 * the suite therefore wrote to the real `data/settings.json`, and running tests
 * while the app was open silently reset the user's chosen language.
 */
export async function readSettings(dir: string = DATA_DIR): Promise<Settings> {
  const file = fileIn(dir)
  if (!existsSync(file)) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Settings>
    return {
      language:
        typeof parsed.language === 'string' && isLanguage(parsed.language) ? parsed.language : null,
    }
  } catch {
    // A truncated file should not brick the app; fall back to asking again.
    return { ...DEFAULTS }
  }
}

export async function writeSettings(
  patch: Partial<Settings>,
  dir: string = DATA_DIR,
): Promise<Settings> {
  const next: Settings = { ...(await readSettings(dir)), ...patch }
  if (patch.language === null) next.language = null
  if (next.language !== null && !isLanguage(next.language)) {
    throw new Error(`Unsupported language: ${next.language}`)
  }
  await mkdir(dir, { recursive: true })
  // Write-then-rename so a crash mid-write cannot leave a half-file behind.
  const file = fileIn(dir)
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await rename(tmp, file)
  return next
}
