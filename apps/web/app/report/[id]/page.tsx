'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { api, mmss, VERDICT_STYLE, type SessionDetail } from '@/lib/api'
import { Button, Panel, PanelTitle, Stat, Chip } from '@/components/ui'
import { Timeline } from '@/components/Timeline'
import { Chat } from '@/components/Chat'
import { Processing } from '@/components/Processing'

const SEVERITY: Record<string, { color: string; label: string }> = {
  critical: { color: 'var(--color-danger)', label: 'critical' },
  major: { color: 'var(--color-warn)', label: 'major' },
  minor: { color: 'var(--color-muted)', label: 'minor' },
  positive: { color: 'var(--color-good)', label: 'good' },
}

const DIMENSION_LABEL: Record<string, string> = {
  clarification: 'Clarifying questions',
  approach: 'Approach & tradeoffs',
  complexity: 'Complexity analysis',
  correctness: 'Correctness',
  edge_cases: 'Edge cases',
  code_quality: 'Code quality',
  communication: 'Communication',
}

export default function Report() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeMs, setActiveMs] = useState<number | null>(null)
  // Lives here rather than in <Chat> so a finding can seed the next question.
  const [draft, setDraft] = useState('')
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    api
      .session(id)
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [id])

  const totals = useMemo(() => {
    if (!data?.analysis) return null
    const score = data.analysis.rubric.reduce((s, r) => s + r.score, 0)
    const max = data.analysis.rubric.length * 4
    return { score, max, pct: score / max }
  }, [data])

  if (error) return <Centered>{error}</Centered>
  if (!data) return <Centered>Loading…</Centered>

  // Re-running the write-up goes through the same stages and the same socket as
  // the original, so it gets the same screen rather than a second progress UI.
  if (retrying)
    return (
      <Processing
        id={id}
        onReady={() => {
          setRetrying(false)
          api
            .session(id)
            .then(setData)
            .catch((e) => setError(String(e)))
        }}
      />
    )

  const { meta, metrics, analysis, speech, voiced, events, finalCode, problem, chat } = data

  /** Puts a finding in the chat box, phrased the way you would actually ask. */
  const discuss = (title: string, atMs: number | null) => {
    setDraft(
      `About "${title}"${atMs === null ? '' : ` at ${mmss(atMs)}`} — what should I have done instead?`,
    )
    document.getElementById('debrief-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const retryDebrief = () => {
    setRetrying(true)
    api.reanalyse(id).catch((e) => {
      setError(String(e))
      setRetrying(false)
    })
  }
  const duration = metrics?.durationMs ?? meta.durationMs ?? 0
  const verdict = analysis ? VERDICT_STYLE[analysis.verdict] : null

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="font-mono text-[11px] text-faint transition-colors hover:text-muted"
          >
            ← nod3
          </Link>
          <h1 className="mt-3 text-2xl font-medium tracking-tight">{meta.problemTitle}</h1>
          <div className="mt-1.5 flex items-center gap-2.5 font-mono text-[11px] text-faint">
            <Chip tone={problem.difficulty}>{problem.difficulty}</Chip>
            <span>{problem.pattern}</span>
            <span>·</span>
            <span>{mmss(duration)}</span>
            <span>·</span>
            <span>{new Date(meta.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {analysis && totals && verdict && (
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
              Verdict
            </div>
            <div
              className="mt-1 text-2xl font-medium tracking-tight"
              style={{ color: verdict.color }}
            >
              {verdict.label}
            </div>
            <div className="tabular mt-0.5 font-mono text-[12px] text-muted">
              {totals.score}/{totals.max} · {Math.round(totals.pct * 100)}%
            </div>
          </div>
        )}
      </header>

      {analysis && (
        <p
          className="mb-8 border-l-2 pl-4 text-[15px] leading-relaxed text-ink/90"
          style={{ borderColor: verdict?.color }}
        >
          {analysis.headline}
        </p>
      )}

      {meta.status === 'failed' && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] text-warn">
          <span>
            The interviewer write-up failed for this session, but the recording, transcript and
            measurements below were saved.
          </span>
          {/* Everything the write-up needs is on disk, so this costs a model
              call rather than another 40 minutes of your life. */}
          <Button onClick={retryDebrief}>Write it up again</Button>
        </div>
      )}

      {metrics && duration > 0 && (
        <Panel className="mb-6">
          <PanelTitle>Speech against keystrokes</PanelTitle>
          <Timeline
            durationMs={duration}
            voiced={voiced}
            speech={speech}
            events={events}
            metrics={metrics}
            findings={analysis?.findings ?? []}
            activeMs={activeMs}
            onScrub={setActiveMs}
          />
        </Panel>
      )}

      {metrics && (
        <div className="mb-6 grid grid-cols-2 gap-6 rounded-xl border border-line bg-surface p-5 md:grid-cols-4">
          <Stat
            label="Talk time"
            value={Math.round(metrics.talkRatio * 100)}
            unit="%"
            tone="speech"
            hint={`${metrics.speechSegments} spoken passages`}
          />
          <Stat
            label="Silent coding"
            value={mmss(metrics.silentCodingMs)}
            tone={metrics.silentCodingMs > 60_000 ? 'danger' : 'good'}
            hint={
              metrics.silentCodingSpans.length
                ? `${metrics.silentCodingSpans.length} stretch(es) over 15s`
                : 'You narrated while you typed'
            }
          />
          <Stat
            label="Planning window"
            value={
              metrics.planningWindowMs === null
                ? '—'
                : `${metrics.planningWindowMs < 0 ? '−' : ''}${Math.abs(Math.round(metrics.planningWindowMs / 1000))}`
            }
            unit={metrics.planningWindowMs === null ? undefined : 's'}
            tone={
              metrics.planningWindowMs === null
                ? undefined
                : metrics.planningWindowMs < 15_000
                  ? 'warn'
                  : 'good'
            }
            hint="Talking before typing"
          />
          <Stat
            label="Churn"
            value={metrics.churnRatio.toFixed(2)}
            tone={metrics.churnRatio > 0.6 ? 'warn' : 'good'}
            hint={`+${metrics.totalAdded} −${metrics.totalRemoved} chars`}
          />
          <Stat
            label="Longest silence"
            value={`${Math.round(metrics.longestSilenceMs / 1000)}s`}
            hint={
              metrics.longestSilenceAtMs !== null
                ? `at ${mmss(metrics.longestSilenceAtMs)}`
                : undefined
            }
          />
          <Stat label="Pace" value={Math.round(metrics.wordsPerMinute)} unit="wpm" />
          <Stat
            label="Test runs"
            value={metrics.runCount}
            hint={
              metrics.firstRunAtMs !== null ? `first at ${mmss(metrics.firstRunAtMs)}` : 'never ran'
            }
          />
          <Stat
            label="Final tests"
            value={metrics.finalTotal ? `${metrics.finalPassed}/${metrics.finalTotal}` : '—'}
            tone={
              metrics.finalTotal && metrics.finalPassed === metrics.finalTotal ? 'good' : 'danger'
            }
          />
        </div>
      )}

      {analysis && (
        <div className="mb-6 grid gap-6 md:grid-cols-[1fr_1.25fr]">
          <Panel>
            <PanelTitle>Scorecard</PanelTitle>
            <ul className="space-y-3.5">
              {analysis.rubric.map((r) => (
                <li key={r.dimension}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px]">
                      {DIMENSION_LABEL[r.dimension] ?? r.dimension}
                    </span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-muted">
                      {r.score}/{r.max}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {Array.from({ length: r.max }, (_, i) => (
                      <span
                        key={i}
                        className="h-1 flex-1 rounded-full"
                        style={{
                          background:
                            i < r.score
                              ? r.score <= 1
                                ? 'var(--color-danger)'
                                : r.score === 2
                                  ? 'var(--color-warn)'
                                  : 'var(--color-good)'
                              : 'var(--color-line)',
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{r.evidence}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelTitle
              aside={<span className="font-mono text-[10px] text-faint">click to jump</span>}
            >
              What decided it
            </PanelTitle>
            <ul className="space-y-3">
              {analysis.findings.map((f, i) => {
                const s = SEVERITY[f.severity] ?? SEVERITY.minor!
                return (
                  <li key={i}>
                    <button
                      onClick={() => f.atMs !== null && setActiveMs(f.atMs)}
                      className="group w-full text-left"
                      disabled={f.atMs === null}
                    >
                      <div className="flex items-baseline gap-2">
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full"
                          style={{ background: s.color }}
                        />
                        {f.atMs !== null && (
                          <span className="tabular shrink-0 font-mono text-[11px] text-accent group-hover:underline">
                            {mmss(f.atMs)}
                          </span>
                        )}
                        <span className="text-[13px] leading-snug">{f.title}</span>
                      </div>
                      <p className="ml-[14px] mt-1 text-[12px] leading-relaxed text-muted">
                        {f.detail}
                      </p>
                    </button>
                    <button
                      onClick={() => discuss(f.title, f.atMs)}
                      className="ml-[14px] mt-1 text-[11px] text-faint transition-colors hover:text-accent"
                    >
                      Ask about this →
                    </button>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      )}

      {analysis && (analysis.drills.length > 0 || analysis.weakPatterns.length > 0) && (
        <Panel className="mb-6">
          <PanelTitle>Do this next</PanelTitle>
          <ul className="space-y-2">
            {analysis.drills.map((d, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                {d}
              </li>
            ))}
          </ul>
          {analysis.weakPatterns.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="text-[11px] text-faint">Practise these patterns:</span>
              {analysis.weakPatterns.map((p) => (
                <Chip key={p} tone="accent">
                  {p}
                </Chip>
              ))}
            </div>
          )}
        </Panel>
      )}

      {metrics && (
        <div id="debrief-chat" className="scroll-mt-6">
          <Chat
            sessionId={id}
            initial={chat ?? []}
            draft={draft}
            onDraft={setDraft}
            model={analysis?.model ?? null}
          />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel flush>
          <div className="px-5 pt-5">
            <PanelTitle
              aside={
                <span className="font-mono text-[10px] text-faint">{speech.length} passages</span>
              }
            >
              What you said
            </PanelTitle>
          </div>
          <div className="max-h-[420px] overflow-y-auto px-5 pb-5">
            {speech.length === 0 ? (
              <p className="text-[12.5px] text-faint">No speech was captured for this session.</p>
            ) : (
              <ul className="space-y-2">
                {speech.map((s, i) => {
                  const active =
                    activeMs !== null && activeMs >= s.start - 1500 && activeMs <= s.end + 1500
                  return (
                    <li
                      key={i}
                      className={`flex gap-3 rounded-md px-2 py-1 transition-colors ${
                        active ? 'bg-accent/10' : ''
                      }`}
                    >
                      <button
                        onClick={() => setActiveMs(s.start)}
                        className="tabular shrink-0 font-mono text-[11px] text-faint hover:text-accent"
                      >
                        {mmss(s.start)}
                      </button>
                      <span className="text-[12.5px] leading-relaxed text-ink/85">{s.text}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Panel>

        <Panel flush>
          <div className="px-5 pt-5">
            <PanelTitle
              aside={<span className="font-mono text-[10px] text-faint">{meta.language}</span>}
            >
              What you submitted
            </PanelTitle>
          </div>
          <pre className="max-h-[420px] overflow-auto px-5 pb-5 font-mono text-[12px] leading-relaxed text-ink/85">
            {finalCode || '(nothing submitted)'}
          </pre>
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelTitle>The reference answer</PanelTitle>
        <p className="text-[13px] leading-relaxed text-ink/85">{problem.optimal.approach}</p>
        <div className="mt-2 font-mono text-[12px] text-muted">
          time {problem.optimal.time} · space {problem.optimal.space}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
            Follow-ups a real interviewer would have asked next
          </div>
          <ul className="space-y-1.5">
            {problem.followUps.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] text-muted">
                <span className="text-faint">{i + 1}.</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {analysis && (
        <p className="mt-8 text-center font-mono text-[10px] text-faint">
          written by {analysis.engine} / {analysis.model} ·{' '}
          {new Date(analysis.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center text-sm text-faint">{children}</div>
}
