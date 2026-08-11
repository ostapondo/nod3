import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { SESSIONS_DIR } from '../config.js'
import type {
  Analysis,
  ChatTurn,
  CodeEvent,
  Metrics,
  Problem,
  SessionMeta,
  SpeechSegment,
} from './types.js'

const SESSION_ID = /^[A-Za-z0-9_-]+$/

export function isSessionId(id: string): boolean {
  return SESSION_ID.test(id)
}

export function sessionDir(id: string): string {
  // Guard against path traversal from a crafted :id param.
  if (!isSessionId(id)) throw new Error(`Invalid session id: ${id}`)
  return path.join(SESSIONS_DIR, id)
}

const f = {
  meta: (id: string) => path.join(sessionDir(id), 'meta.json'),
  problem: (id: string) => path.join(sessionDir(id), 'problem.json'),
  events: (id: string) => path.join(sessionDir(id), 'events.jsonl'),
  speech: (id: string) => path.join(sessionDir(id), 'speech.json'),
  voiced: (id: string) => path.join(sessionDir(id), 'voiced.json'),
  metrics: (id: string) => path.join(sessionDir(id), 'metrics.json'),
  analysis: (id: string) => path.join(sessionDir(id), 'analysis.json'),
  narrative: (id: string) => path.join(sessionDir(id), 'narrative.txt'),
  chat: (id: string) => path.join(sessionDir(id), 'chat.jsonl'),
  audio: (id: string) => path.join(sessionDir(id), 'audio.webm'),
  wav: (id: string) => path.join(sessionDir(id), 'audio.wav'),
  code: (id: string, ext: string) => path.join(sessionDir(id), `solution.${ext}`),
}
export const files = f

async function readJson<T>(p: string): Promise<T | null> {
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await writeFile(p, JSON.stringify(value, null, 2), 'utf8')
}

export async function createSession(meta: SessionMeta, problem: Problem): Promise<void> {
  await mkdir(sessionDir(meta.id), { recursive: true })
  await writeJson(f.meta(meta.id), meta)
  await writeJson(f.problem(meta.id), problem)
}

export const readMeta = (id: string) => readJson<SessionMeta>(f.meta(id))
export const readProblem = (id: string) => readJson<Problem>(f.problem(id))
export const readSpeech = (id: string) => readJson<SpeechSegment[]>(f.speech(id))
export const readVoiced = (id: string) => readJson<Array<[number, number]>>(f.voiced(id))
export const writeVoiced = (id: string, v: Array<[number, number]>) => writeJson(f.voiced(id), v)
export const readMetrics = (id: string) => readJson<Metrics>(f.metrics(id))
export const readAnalysis = (id: string) => readJson<Analysis>(f.analysis(id))

export const readNarrative = (id: string) =>
  existsSync(f.narrative(id)) ? readFile(f.narrative(id), 'utf8') : Promise.resolve(null)

export const writeSpeech = (id: string, s: SpeechSegment[]) => writeJson(f.speech(id), s)
export const writeMetrics = (id: string, m: Metrics) => writeJson(f.metrics(id), m)
export const writeAnalysis = (id: string, a: Analysis) => writeJson(f.analysis(id), a)
export const writeNarrative = (id: string, n: string) => writeFile(f.narrative(id), n, 'utf8')

export async function patchMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta> {
  const current = await readMeta(id)
  if (!current) throw new Error(`No such session: ${id}`)
  const next = { ...current, ...patch }
  await writeJson(f.meta(id), next)
  return next
}

export async function appendEvents(id: string, events: CodeEvent[]): Promise<void> {
  if (events.length === 0) return
  await appendFile(f.events(id), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

export async function readEvents(id: string): Promise<CodeEvent[]> {
  const p = f.events(id)
  if (!existsSync(p)) return []
  const raw = await readFile(p, 'utf8')
  const out: CodeEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as CodeEvent)
    } catch {
      // A torn last line can happen if the process died mid-append. Skip it.
    }
  }
  return out
}

/**
 * The debrief conversation. Append-only like `events.jsonl` for the same
 * reason: a stream that is only ever added to cannot be corrupted by two
 * writers, and a torn last line costs one message rather than the thread.
 */
export async function appendChat(id: string, turns: ChatTurn[]): Promise<void> {
  if (turns.length === 0) return
  await appendFile(f.chat(id), turns.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8')
}

export async function readChat(id: string): Promise<ChatTurn[]> {
  const p = f.chat(id)
  if (!existsSync(p)) return []
  const out: ChatTurn[] = []
  for (const line of (await readFile(p, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as ChatTurn)
    } catch {
      // Same tolerance as events: skip a half-written line, keep the rest.
    }
  }
  return out
}

export async function writeCode(id: string, code: string, ext: string): Promise<string> {
  const p = f.code(id, ext)
  await writeFile(p, code, 'utf8')
  return p
}

export async function readCode(id: string, ext: string): Promise<string> {
  const p = f.code(id, ext)
  return existsSync(p) ? readFile(p, 'utf8') : ''
}

export async function listSessions(): Promise<SessionMeta[]> {
  if (!existsSync(SESSIONS_DIR)) return []
  const dirs = await readdir(SESSIONS_DIR, { withFileTypes: true })
  const metas: SessionMeta[] = []
  for (const d of dirs) {
    // Anything that is not a well-formed session folder is somebody else's
    // business — scratch dirs, .DS_Store, a half-written upload.
    if (!d.isDirectory() || !isSessionId(d.name)) continue
    const m = await readJson<SessionMeta>(f.meta(d.name))
    if (m) metas.push(m)
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
