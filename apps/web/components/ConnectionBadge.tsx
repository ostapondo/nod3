'use client'

import type { Connection } from '@/lib/useLiveStream'

const STYLE: Record<Connection, { label: string; color: string; pulse: boolean }> = {
  connecting: { label: 'connecting', color: 'var(--color-muted)', pulse: true },
  live: { label: 'live', color: 'var(--color-good)', pulse: false },
  reconnecting: { label: 'reconnecting', color: 'var(--color-warn)', pulse: true },
  offline: { label: 'backend offline', color: 'var(--color-danger)', pulse: true },
}

/**
 * Small on purpose while healthy, impossible to miss when not. A dead backend
 * used to be invisible: the session kept recording and only failed at the end.
 */
export function ConnectionBadge({ connection }: { connection: Connection }) {
  const s = STYLE[connection]
  return (
    <span
      data-testid="connection-badge"
      data-connection={connection}
      title={
        connection === 'live'
          ? 'Receiving live updates from the local server'
          : 'The page is not receiving updates from the local server'
      }
      className="inline-flex items-center gap-1.5 font-mono text-[11px]"
      style={{ color: s.color }}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${s.pulse ? 'rec-dot' : ''}`}
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  )
}

/** A full-width bar for when the connection is genuinely broken mid-session. */
export function ConnectionAlert({
  connection,
  serverRestarted,
}: {
  connection: Connection
  serverRestarted: boolean
}) {
  if (connection === 'live' && !serverRestarted) return null

  const broken = connection === 'offline'
  const tone = broken ? 'danger' : serverRestarted ? 'warn' : 'muted'

  return (
    <div
      data-testid="connection-alert"
      className="flex items-center justify-center gap-2 border-b py-1.5 text-[11.5px]"
      style={{
        borderColor: `color-mix(in oklab, var(--color-${tone}) 30%, transparent)`,
        background: `color-mix(in oklab, var(--color-${tone}) 10%, transparent)`,
        color: `var(--color-${tone})`,
      }}
    >
      <span
        className="rec-dot inline-block size-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {serverRestarted
        ? 'The server restarted. Anything it was doing for this session was interrupted.'
        : broken
          ? 'Lost the local server. Your recording continues in this tab, but nothing can be saved until it is back.'
          : 'Reconnecting to the local server…'}
    </div>
  )
}
