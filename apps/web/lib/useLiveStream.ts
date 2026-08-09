'use client'

import { useEffect, useRef, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API ?? 'http://localhost:4000'
export const WS_URL = `${API.replace(/^http/, 'ws')}/ws`

export type StageState = 'pending' | 'running' | 'done' | 'failed'

export interface StageEvent {
  type: 'stage'
  sessionId: string
  stage: string
  state: 'running' | 'done' | 'failed'
  detail?: string
  at: string
}

export type ServerEvent =
  | { type: 'hello'; sessions: string[]; serverStartedAt: string }
  | { type: 'ping'; at: string }
  | StageEvent
  | { type: 'session'; sessionId: string; status: string; error?: string; at: string }
  | {
      type: 'log'
      sessionId: string
      level: 'info' | 'warn' | 'error'
      message: string
      at: string
    }

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface LiveStream {
  connection: Connection
  /** Latest state per stage id, in arrival order. */
  stages: Map<string, { state: StageState; detail?: string; at: string }>
  logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; at: string }>
  sessionStatus: string | null
  sessionError: string | null
  /** Set when the server process restarted while we were watching. */
  serverRestarted: boolean
}

const MAX_BACKOFF_MS = 10_000
/**
 * A socket whose network vanished without a close frame still reports OPEN, so
 * the badge would keep claiming "live" against a backend that is gone. Silence
 * for longer than this means the link is dead regardless of what the socket
 * object thinks.
 */
const STALE_AFTER_MS = 13_000

/**
 * A live view of what the backend is doing.
 *
 * Polling could only ever answer "which stage", once every couple of seconds,
 * and said nothing at all when the server went away — a session could be
 * recording against a dead API with the UI looking perfectly healthy. The
 * socket carries progress detail, failures with their reason, and its own
 * liveness.
 */
export function useLiveStream(sessionId?: string): LiveStream {
  const [connection, setConnection] = useState<Connection>('connecting')
  const [stages, setStages] = useState<LiveStream['stages']>(new Map())
  const [logs, setLogs] = useState<LiveStream['logs']>([])
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [serverRestarted, setServerRestarted] = useState(false)

  const attempt = useRef(0)
  const startedAt = useRef<string | null>(null)
  const closed = useRef(false)
  const lastHeard = useRef(Date.now())

  useEffect(() => {
    closed.current = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed.current) return
      const url = sessionId ? `${WS_URL}?session=${encodeURIComponent(sessionId)}` : WS_URL
      setConnection(attempt.current === 0 ? 'connecting' : 'reconnecting')

      try {
        socket = new WebSocket(url)
      } catch {
        return schedule()
      }

      socket.onopen = () => {
        attempt.current = 0
        lastHeard.current = Date.now()
        setConnection('live')
      }

      socket.onmessage = (raw) => {
        lastHeard.current = Date.now()
        let event: ServerEvent
        try {
          event = JSON.parse(String(raw.data))
        } catch {
          return
        }

        if (event.type === 'ping') return
        if (event.type === 'hello') {
          // A different start time means the process died and came back, so
          // anything held only in its memory is gone.
          if (startedAt.current && startedAt.current !== event.serverStartedAt) {
            setServerRestarted(true)
          }
          startedAt.current = event.serverStartedAt
          return
        }
        if (event.type === 'stage') {
          setStages((prev) => {
            const next = new Map(prev)
            next.set(event.stage, { state: event.state, detail: event.detail, at: event.at })
            return next
          })
          return
        }
        if (event.type === 'session') {
          setSessionStatus(event.status)
          if (event.error) setSessionError(event.error)
          return
        }
        if (event.type === 'log') {
          setLogs((prev) => [
            ...prev.slice(-49),
            { level: event.level, message: event.message, at: event.at },
          ])
        }
      }

      socket.onclose = () => schedule()
      socket.onerror = () => socket?.close()
    }

    const schedule = () => {
      if (closed.current) return
      attempt.current += 1
      setConnection(attempt.current > 3 ? 'offline' : 'reconnecting')
      const delay = Math.min(MAX_BACKOFF_MS, 400 * 2 ** (attempt.current - 1))
      retry = setTimeout(connect, delay)
    }

    connect()

    // Watchdog: force a reconnect when the server has gone quiet, which is the
    // only way to notice a link that died without closing.
    const watchdog = setInterval(() => {
      if (closed.current) return
      if (Date.now() - lastHeard.current < STALE_AFTER_MS) return
      setConnection('offline')
      socket?.close()
    }, 2_000)

    return () => {
      closed.current = true
      clearInterval(watchdog)
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [sessionId])

  return { connection, stages, logs, sessionStatus, sessionError, serverRestarted }
}
