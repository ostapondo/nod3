import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'

/**
 * Everything the UI needs to know while work is happening, pushed rather than
 * polled. Polling could only ever answer "which stage are you on"; a stream can
 * carry progress inside a stage, the reason a step failed, and — because the
 * socket itself is observable — whether the backend is still there at all.
 */

/** Ordered so the UI can render a checklist without hard-coding the pipeline. */
export const PIPELINE_STAGES = [
  { id: 'convert', label: 'Converting audio' },
  { id: 'detect', label: 'Measuring when you spoke' },
  { id: 'transcribe', label: 'Transcribing speech locally' },
  { id: 'align', label: 'Aligning speech with keystrokes' },
  { id: 'tests', label: 'Running the test suite' },
  { id: 'debrief', label: 'Interviewer is writing the debrief' },
] as const

export type StageId = (typeof PIPELINE_STAGES)[number]['id']

export type ServerEvent =
  | { type: 'hello'; sessions: string[]; serverStartedAt: string }
  /** Application-level keepalive: a protocol ping is invisible to browser JS,
   *  so the client cannot use it to tell a live socket from a half-open one. */
  | { type: 'ping'; at: string }
  | {
      type: 'stage'
      sessionId: string
      stage: StageId
      state: 'running' | 'done' | 'failed'
      /** Free text under the stage: a file size, a model name, a test tally. */
      detail?: string
      /** 0..1 within the stage, when it is knowable. */
      progress?: number
      at: string
    }
  | { type: 'session'; sessionId: string; status: string; error?: string; at: string }
  | {
      type: 'log'
      sessionId: string
      level: 'info' | 'warn' | 'error'
      message: string
      at: string
    }

type Listener = (event: ServerEvent) => void

const listeners = new Set<Listener>()
/** Replayed to anyone who connects mid-pipeline, so a reload never loses context. */
const recent = new Map<string, ServerEvent[]>()
const RECENT_PER_SESSION = 60

/** Client marks the link stale at roughly 2.5x this. */
export const HEARTBEAT_MS = 5_000

export function publish(event: ServerEvent): void {
  if ('sessionId' in event) {
    const log = recent.get(event.sessionId) ?? []
    log.push(event)
    if (log.length > RECENT_PER_SESSION) log.shift()
    recent.set(event.sessionId, log)
  }
  for (const listener of listeners) listener(event)
}

export function history(sessionId: string): ServerEvent[] {
  return recent.get(sessionId) ?? []
}

export function stage(
  sessionId: string,
  id: StageId,
  state: 'running' | 'done' | 'failed',
  detail?: string,
): void {
  publish({ type: 'stage', sessionId, stage: id, state, detail, at: new Date().toISOString() })
}

export function log(sessionId: string, level: 'info' | 'warn' | 'error', message: string): void {
  publish({ type: 'log', sessionId, level, message, at: new Date().toISOString() })
}

export function attachWebSocket(server: Server, startedAt: string): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/ws', 'http://localhost')
    const watching = url.searchParams.get('session')

    const send = (event: ServerEvent) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
    }

    send({ type: 'hello', sessions: watching ? [watching] : [], serverStartedAt: startedAt })
    // A client that connects after a stage finished still needs to see it.
    if (watching) for (const event of history(watching)) send(event)

    const listener: Listener = (event) => {
      if (watching && 'sessionId' in event && event.sessionId !== watching) return
      send(event)
    }
    listeners.add(listener)

    // A half-open socket looks alive to the OS but delivers nothing; ping so the
    // UI's "connected" light means something.
    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.ping()
      send({ type: 'ping', at: new Date().toISOString() })
    }, HEARTBEAT_MS)
    // Never a reason to keep the process alive on its own: the HTTP server owns
    // the lifetime. Without this a lingering socket blocks shutdown entirely.
    heartbeat.unref()

    const cleanup = () => {
      clearInterval(heartbeat)
      listeners.delete(listener)
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  })

  return wss
}
