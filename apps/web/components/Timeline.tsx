'use client'

import { useMemo, useRef, useState } from 'react'
import { mmss, type Analysis, type CodeEvent, type Metrics } from '@/lib/api'

interface Props {
  durationMs: number
  voiced: Array<[number, number]>
  speech: Array<{ start: number; end: number; text: string }>
  events: CodeEvent[]
  metrics: Metrics
  findings: Analysis['findings']
  activeMs: number | null
  onScrub: (ms: number | null) => void
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--color-danger)',
  major: 'var(--color-warn)',
  minor: 'var(--color-muted)',
  positive: 'var(--color-good)',
}

/**
 * One bar per ~3 seconds, clamped. At 220 fixed buckets a bar was ~4px wide, so
 * a session with sparse edits rendered as unreadable hairlines.
 */
function bucketCount(durationMs: number): number {
  return Math.max(40, Math.min(150, Math.round(durationMs / 3_000)))
}

/**
 * The two tracks on one clock — the thing the whole app exists to show.
 *
 * Top: when you were actually speaking, measured from the waveform.
 * Bottom: how hard the editor was working.
 * Where the top is empty and the bottom is busy, you were coding in silence.
 */
export function Timeline({
  durationMs,
  voiced,
  speech,
  events,
  metrics,
  findings,
  activeMs,
  onScrub,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / Math.max(1, durationMs)) * 100))}%`

  const codeBars = useMemo(() => {
    const count = bucketCount(durationMs)
    const size = Math.max(1, durationMs / count)
    const bins = new Array<number>(count).fill(0)
    for (const e of events) {
      if (e.kind !== 'edit') continue
      const i = Math.min(count - 1, Math.floor(e.t / size))
      bins[i] = (bins[i] ?? 0) + e.added + e.removed
    }
    const max = Math.max(1, ...bins)
    return bins.map((v) => v / max)
  }, [events, durationMs])

  const runs = events.filter((e): e is Extract<CodeEvent, { kind: 'run' }> => e.kind === 'run')

  const cursorMs = hover ?? activeMs

  /**
   * Only ever reports words that were actually being spoken at the cursor.
   *
   * An earlier version fell back to the most recent passage when the cursor sat
   * in a gap, which made a four-minute silence read as though you were still
   * talking — hiding the exact failure this view exists to expose. Silence is
   * reported as silence; the last thing said is offered separately, as context.
   */
  const spokenAtCursor = useMemo(
    () =>
      cursorMs === null
        ? null
        : (speech.find((s) => cursorMs >= s.start && cursorMs <= s.end) ?? null),
    [cursorMs, speech],
  )

  const lastSpokenBefore = useMemo(
    () =>
      cursorMs === null || spokenAtCursor
        ? null
        : ([...speech].reverse().find((s) => s.end <= cursorMs) ?? null),
    [cursorMs, speech, spokenAtCursor],
  )

  function move(clientX: number) {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setHover(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * durationMs)
  }

  const ticks = useMemo(() => {
    const targetCount = 6
    const rawStep = durationMs / targetCount
    const nice = [15, 30, 60, 120, 300, 600, 900].find((s) => s * 1000 >= rawStep) ?? 1800
    const step = nice * 1000
    const out: number[] = []
    for (let t = 0; t <= durationMs; t += step) out.push(t)
    return out
  }, [durationMs])

  return (
    <div className="select-none">
      <div className="mb-2.5 flex items-center gap-5 font-mono text-[10px] uppercase tracking-wider">
        <span className="flex items-center gap-1.5" style={{ color: 'var(--color-speech)' }}>
          <span className="inline-block h-2 w-3 rounded-sm bg-speech" /> speaking
        </span>
        <span className="flex items-center gap-1.5" style={{ color: 'var(--color-code)' }}>
          <span className="inline-block h-2 w-3 rounded-sm bg-code" /> editing
        </span>
        <span className="flex items-center gap-1.5 text-danger">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{
              background:
                'repeating-linear-gradient(45deg, var(--color-danger) 0 2px, transparent 2px 4px)',
            }}
          />
          silent coding
        </span>
      </div>

      <div
        ref={ref}
        className="relative h-[124px] cursor-crosshair overflow-hidden rounded-lg border border-line bg-canvas"
        onMouseMove={(e) => move(e.clientX)}
        onMouseLeave={() => {
          setHover(null)
          onScrub(null)
        }}
        onClick={() => onScrub(hover)}
      >
        {/* Silent-coding bands sit behind everything: they are the headline. */}
        {metrics.silentCodingSpans.map((s, i) => {
          const seconds = Math.round((s.end - s.start) / 1000)
          const share = (s.end - s.start) / Math.max(1, durationMs)
          return (
            <div
              key={i}
              className="absolute inset-y-0 flex items-center justify-center"
              style={{
                left: pct(s.start),
                width: pct(s.end - s.start),
                // Faint on purpose: these bands often cover most of the session,
                // and they are meant to frame the two tracks, not bury them.
                background:
                  'repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-danger) 9%, transparent) 0 2px, transparent 2px 9px)',
                borderLeft: '1px solid color-mix(in oklab, var(--color-danger) 40%, transparent)',
                borderRight: '1px solid color-mix(in oklab, var(--color-danger) 40%, transparent)',
              }}
              title={`${seconds}s of unnarrated coding (+${s.added} −${s.removed} chars)`}
            >
              {share > 0.12 && (
                <span className="tabular pointer-events-none rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] text-danger">
                  {seconds}s silent
                </span>
              )}
            </div>
          )
        })}

        {/* Speech track */}
        <div className="absolute inset-x-0 top-0 h-[52px]">
          <div className="absolute left-2 top-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">
            said
          </div>
          {voiced.map(([a, b], i) => (
            <div
              key={i}
              className="absolute bottom-2 rounded-[2px] bg-speech"
              style={{ left: pct(a), width: `max(2px, ${pct(b - a)})`, height: 22, opacity: 0.85 }}
            />
          ))}
        </div>

        <div className="absolute inset-x-0 top-[54px] h-px bg-line" />

        {/* Code track */}
        <div className="absolute inset-x-0 bottom-0 top-[55px]">
          <div className="absolute left-2 top-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">
            wrote
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-[44px] items-end">
            {codeBars.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[1px] bg-code"
                style={{ height: v === 0 ? 0 : `${Math.max(8, v * 100)}%`, opacity: 0.8 }}
              />
            ))}
          </div>
        </div>

        {/* Test runs */}
        {runs.map((r, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-px"
            style={{
              left: pct(r.t),
              background: r.ok ? 'var(--color-good)' : 'var(--color-danger)',
              opacity: 0.55,
            }}
            title={`Ran tests: ${r.passed}/${r.total}`}
          />
        ))}

        {/* Finding pins */}
        {findings
          .filter((f) => f.atMs !== null)
          .map((f, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                onScrub(f.atMs)
              }}
              className="absolute top-0 z-10 -translate-x-1/2 p-1"
              style={{ left: pct(f.atMs!) }}
              title={f.title}
            >
              <span
                className="block size-1.5 rounded-full ring-2 ring-canvas"
                style={{ background: SEVERITY_COLOR[f.severity] }}
              />
            </button>
          ))}

        {/* Cursor */}
        {cursorMs !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-ink/60"
            style={{ left: pct(cursorMs) }}
          />
        )}
      </div>

      {/* Axis */}
      <div className="relative mt-1.5 h-4">
        {ticks.map((t) => (
          <span
            key={t}
            className="tabular absolute font-mono text-[10px] text-faint"
            style={{ left: pct(t), transform: 'translateX(-50%)' }}
          >
            {mmss(t)}
          </span>
        ))}
      </div>

      {/* Scrub readout */}
      <div className="mt-2 flex min-h-[34px] items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        {cursorMs === null ? (
          <span className="text-[12px] text-faint">
            Hover the timeline to hear yourself back. Click a dot to jump to a finding.
          </span>
        ) : (
          <>
            <span className="tabular shrink-0 font-mono text-[12px] text-accent">
              {mmss(cursorMs)}
            </span>
            <span className="text-[12.5px] leading-snug text-ink/85">
              {spokenAtCursor ? (
                `“${spokenAtCursor.text}”`
              ) : (
                <>
                  <span className="text-faint">— silence —</span>
                  {lastSpokenBefore && (
                    <span className="ml-2 text-faint/70">
                      last said {Math.round((cursorMs - lastSpokenBefore.end) / 1000)}s earlier: “
                      {lastSpokenBefore.text}”
                    </span>
                  )}
                </>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
