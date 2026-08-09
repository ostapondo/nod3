'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useLiveStream, type StageState } from '@/lib/useLiveStream'
import { ConnectionBadge } from '@/components/ConnectionBadge'

/** Mirrors PIPELINE_STAGES on the server; /api/health carries the live list. */
const FALLBACK_STAGES = [
  { id: 'convert', label: 'Converting audio' },
  { id: 'detect', label: 'Measuring when you spoke' },
  { id: 'transcribe', label: 'Transcribing speech locally' },
  { id: 'align', label: 'Aligning speech with keystrokes' },
  { id: 'tests', label: 'Running the test suite' },
  { id: 'debrief', label: 'Interviewer is writing the debrief' },
]

export function Processing({ id, onReady }: { id: string; onReady: () => void }) {
  const live = useLiveStream(id)
  const [stages, setStages] = useState(FALLBACK_STAGES)
  const [pollError, setPollError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    api
      .health()
      .then((h) => h.pipelineStages && setStages(h.pipelineStages))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (live.sessionStatus === 'ready') onReady()
  }, [live.sessionStatus, onReady])

  // The socket is the fast path, not the only one: if it cannot connect at all,
  // fall back to asking, so a proxy that blocks websockets does not strand you.
  useEffect(() => {
    if (live.connection !== 'offline') return
    const poll = setInterval(() => {
      api
        .status(id)
        .then((s) => {
          setPollError(null)
          if (s.status === 'ready') onReady()
          if (s.status === 'failed') setPollError(s.error ?? 'Processing failed')
        })
        .catch(() => setPollError('The local server is not responding.'))
    }, 3000)
    return () => clearInterval(poll)
  }, [live.connection, id, onReady])

  const failure = live.sessionError ?? pollError
  const stageState = (stageId: string): StageState => live.stages.get(stageId)?.state ?? 'pending'
  const activeIndex = stages.findIndex((s) => stageState(s.id) === 'running')

  return (
    <div className="relative grid min-h-screen place-items-center px-6">
      <div className="grid-field pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-block size-2.5 rounded-full bg-accent" />
            <span className="font-mono text-sm tracking-tight">nod3</span>
          </div>
          <ConnectionBadge connection={live.connection} />
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-medium tracking-tight">Reviewing your session</h1>
          <span className="tabular font-mono text-[12px] text-faint">
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Your speech is transcribed on this machine, then lined up against every edit you made.
          Expect roughly a third of the session length.
        </p>

        <ol className="mt-7 space-y-1">
          {stages.map((s, i) => (
            <StageRow
              key={s.id}
              index={i}
              label={s.label}
              state={stageState(s.id)}
              detail={live.stages.get(s.id)?.detail}
              isLast={i === stages.length - 1}
              dimmed={activeIndex >= 0 && i > activeIndex}
            />
          ))}
        </ol>

        {live.logs.length > 0 && (
          <div className="mt-6 space-y-1.5 rounded-lg border border-line bg-surface px-3 py-2.5">
            {live.logs.slice(-4).map((entry, i) => (
              <div
                key={i}
                className="flex gap-2 font-mono text-[11px] leading-relaxed"
                style={{
                  color:
                    entry.level === 'error'
                      ? 'var(--color-danger)'
                      : entry.level === 'warn'
                        ? 'var(--color-warn)'
                        : 'var(--color-faint)',
                }}
              >
                <span className="shrink-0 opacity-60">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        )}

        {failure && (
          <div className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] text-danger">
            <div className="mb-1 font-medium">The write-up failed</div>
            <div className="text-danger/80">{failure}</div>
            <Link
              href={`/report/${id}`}
              className="mt-2 inline-block underline decoration-dotted underline-offset-4"
            >
              Open the report anyway — your transcript and measurements were saved
            </Link>
          </div>
        )}

        {live.connection === 'offline' && !failure && (
          <div className="mt-6 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-[12.5px] text-warn">
            Lost the live connection to the local server. Falling back to polling — the work itself
            is still running, or will resume when the server is back.
          </div>
        )}
      </div>
    </div>
  )
}

function StageRow({
  index,
  label,
  state,
  detail,
  isLast,
  dimmed,
}: {
  index: number
  label: string
  state: StageState
  detail?: string
  isLast: boolean
  dimmed: boolean
}) {
  const running = state === 'running'
  const done = state === 'done'
  const failed = state === 'failed'

  const colour = failed
    ? 'var(--color-danger)'
    : running
      ? 'var(--color-accent)'
      : done
        ? 'var(--color-good)'
        : 'var(--color-faint)'

  return (
    <li
      data-stage-state={state}
      className={`relative flex gap-3 rounded-lg px-3 py-2.5 transition-colors ${
        running
          ? 'bg-accent/8 ring-1 ring-accent/25'
          : failed
            ? 'bg-danger/8 ring-1 ring-danger/25'
            : ''
      }`}
      style={{ opacity: dimmed && !running ? 0.4 : 1 }}
    >
      <div className="flex flex-col items-center">
        <span
          className={`grid size-5 shrink-0 place-items-center rounded-full border text-[9px] font-medium ${
            running ? 'rec-dot' : ''
          }`}
          style={{
            borderColor: colour,
            color: failed || running ? colour : done ? colour : 'var(--color-faint)',
            background:
              done || running || failed
                ? `color-mix(in oklab, ${colour} 15%, transparent)`
                : 'transparent',
          }}
        >
          {done ? '✓' : failed ? '✕' : index + 1}
        </span>
        {/* A rail joins the steps so the list reads as a sequence, not a menu. */}
        {!isLast && (
          <span
            className="mt-1 w-px flex-1"
            style={{ background: done ? 'var(--color-good)' : 'var(--color-line)', opacity: 0.5 }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-0.5">
        <div
          className="text-[13px] leading-5"
          style={{
            color:
              running || failed
                ? 'var(--color-ink)'
                : done
                  ? 'var(--color-muted)'
                  : 'var(--color-faint)',
          }}
        >
          {label}
        </div>
        {detail && (
          <div
            className="mt-0.5 truncate font-mono text-[11px]"
            style={{ color: colour, opacity: 0.85 }}
          >
            {detail}
          </div>
        )}
      </div>

      {running && (
        <span className="relative mt-2 h-px w-12 shrink-0 overflow-hidden bg-line">
          <span className="sweep absolute inset-0" />
        </span>
      )}
    </li>
  )
}
