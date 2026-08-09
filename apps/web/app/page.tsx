'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  api,
  mmss,
  VERDICT_STYLE,
  type Health,
  type ProblemSummary,
  type SessionRow,
} from '@/lib/api'
import { Button, Chip, Empty, Panel, PanelTitle, Stat } from '@/components/ui'
import { LanguageChooser } from '@/components/LanguageChooser'
import { useLanguagePreference } from '@/lib/prefs'
import { useLiveStream } from '@/lib/useLiveStream'
import { ConnectionBadge } from '@/components/ConnectionBadge'

export default function Dashboard() {
  const router = useRouter()
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [suggested, setSuggested] = useState<string | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    language,
    setLanguage,
    loaded: prefLoaded,
    saving: savingLanguage,
    error: languageError,
  } = useLanguagePreference()
  const live = useLiveStream()

  useEffect(() => {
    api
      .problems()
      .then(setProblems)
      .catch(() => {})
    api
      .sessions()
      .then(setSessions)
      .catch(() => {})
    api
      .nextProblem()
      .then((r) => setSuggested(r.id))
      .catch(() => {})
    api
      .health()
      .then(setHealth)
      .catch(() => {})
  }, [])

  const stats = useMemo(() => {
    const done = sessions.filter((s) => s.status === 'ready')
    const scored = done.filter((s) => s.score !== null && s.maxScore)
    const avgPct = scored.length
      ? scored.reduce((acc, s) => acc + s.score! / s.maxScore!, 0) / scored.length
      : null
    const talk = done.filter((s) => s.talkRatio !== null)
    const avgTalk = talk.length ? talk.reduce((a, s) => a + s.talkRatio!, 0) / talk.length : null
    const silent = done.reduce((a, s) => a + (s.silentCodingMs ?? 0), 0)
    return { count: done.length, avgPct, avgTalk, silent }
  }, [sessions])

  async function begin(problemId: string) {
    if (!language) return setSettingsOpen(true)
    setStarting(problemId)
    try {
      const { id } = await api.createSession(problemId, language)
      router.push(`/session/${id}`)
    } catch {
      setStarting(null)
    }
  }

  const suggestedProblem = problems.find((p) => p.id === suggested)
  const current = health?.languages.find((l) => l.id === language) ?? null

  // Ask once, on first run. Waiting for both the stored preference and the
  // toolchain probe avoids flashing the chooser at a returning user.
  if (prefLoaded && health && !language) {
    return (
      <LanguageChooser
        languages={health.languages}
        selected={language}
        saving={savingLanguage}
        error={languageError}
        onSelect={setLanguage}
        variant="first-run"
      />
    )
  }

  return (
    <div className="relative min-h-screen">
      <div className="grid-field pointer-events-none absolute inset-0 h-72" />

      <div className="relative mx-auto max-w-6xl px-6 py-10">
        <header className="mb-12 flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-block size-2.5 rounded-full bg-accent" />
              <span className="font-mono text-lg font-medium tracking-tight">nod3</span>
            </div>
            <h1 className="mt-4 max-w-xl text-balance text-3xl font-medium leading-[1.15] tracking-tight">
              Think out loud. Then see exactly what you said
              <span className="text-faint"> — and what you were typing while you said it.</span>
            </h1>
          </div>

          <div className="flex flex-col items-end gap-2 text-right">
            <div className="flex items-center gap-3">
              <ConnectionBadge connection={live.connection} />
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-1.5 rounded-full bg-good" />
                Everything stays on this machine
              </span>
            </div>
            <div className="font-mono text-[11px] text-faint">
              whisper {health?.whisperReady ? 'ready' : 'missing'} · {health?.analysisEngine ?? '…'}
            </div>
            <button
              data-testid="language-setting"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:text-ink"
            >
              <span className="size-1.5 rounded-full bg-accent" />
              {current?.label ?? language ?? 'choose language'}
              <span className="text-faint">change</span>
            </button>
          </div>
        </header>

        {stats.count > 0 && (
          <div className="mb-10 grid grid-cols-2 gap-6 rounded-xl border border-line bg-surface p-5 sm:grid-cols-4">
            <Stat label="Sessions" value={stats.count} />
            <Stat
              label="Avg score"
              value={stats.avgPct === null ? '—' : Math.round(stats.avgPct * 100)}
              unit={stats.avgPct === null ? undefined : '%'}
            />
            <Stat
              label="Avg talk time"
              value={stats.avgTalk === null ? '—' : Math.round(stats.avgTalk * 100)}
              unit={stats.avgTalk === null ? undefined : '%'}
              tone="speech"
              hint="Share of the session you were speaking"
            />
            <Stat
              label="Silent coding"
              value={mmss(stats.silent)}
              tone={stats.silent > 120_000 ? 'danger' : 'good'}
              hint="Total time typing without narrating"
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-6">
            {suggestedProblem && (
              <Panel className="relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-60" />
                <PanelTitle
                  aside={
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="rounded-md px-2 py-1 font-mono text-[11px] text-faint transition-colors hover:text-muted"
                    >
                      {current?.label ?? language} ▾
                    </button>
                  }
                >
                  Up next
                </PanelTitle>

                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                      <Chip tone={suggestedProblem.difficulty}>{suggestedProblem.difficulty}</Chip>
                      <span className="font-mono text-[11px] text-faint">
                        {suggestedProblem.pattern}
                      </span>
                    </div>
                    <div className="text-xl font-medium tracking-tight">
                      {suggestedProblem.title}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {suggestedProblem.budgetMin} minutes · mic on · no hints
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => begin(suggestedProblem.id)}
                    disabled={starting !== null}
                  >
                    {starting === suggestedProblem.id ? 'Starting…' : 'Start session'}
                  </Button>
                </div>
              </Panel>
            )}

            <Panel flush>
              <div className="px-5 pt-5">
                <PanelTitle
                  aside={<span className="text-[11px] text-faint">{problems.length} problems</span>}
                >
                  Problem bank
                </PanelTitle>
              </div>
              <ul className="divide-y divide-line">
                {problems.map((p) => (
                  <li
                    key={p.id}
                    className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-raised"
                  >
                    <Chip tone={p.difficulty}>{p.difficulty}</Chip>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{p.title}</div>
                      <div className="font-mono text-[11px] text-faint">
                        {p.pattern} · {p.budgetMin}m
                      </div>
                    </div>
                    <button
                      onClick={() => begin(p.id)}
                      disabled={starting !== null}
                      className="rounded-md px-2.5 py-1 text-xs text-faint opacity-0 transition-opacity hover:bg-accent/15 hover:text-accent group-hover:opacity-100 disabled:opacity-0"
                    >
                      Start →
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel flush>
            <div className="px-5 pt-5">
              <PanelTitle>Recent sessions</PanelTitle>
            </div>
            {sessions.length === 0 ? (
              <div className="px-5 pb-5">
                <Empty>No sessions yet. Start one and talk through it.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.slice(0, 12).map((s) => {
                  const v = s.verdict ? VERDICT_STYLE[s.verdict] : null
                  const busy = s.status === 'transcribing' || s.status === 'analysing'
                  return (
                    <li key={s.id}>
                      <Link
                        href={busy ? `/session/${s.id}` : `/report/${s.id}`}
                        className="block px-5 py-3 transition-colors hover:bg-raised"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm">{s.problemTitle}</span>
                          {v ? (
                            <span
                              className="shrink-0 font-mono text-[11px]"
                              style={{ color: v.color }}
                            >
                              {s.score}/{s.maxScore}
                            </span>
                          ) : (
                            <span className="shrink-0 font-mono text-[11px] text-faint">
                              {busy ? 'processing' : s.status}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-faint">
                          <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                          {v && <span style={{ color: v.color }}>{v.label}</span>}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {settingsOpen && health && (
        <LanguageChooser
          languages={health.languages}
          selected={language}
          saving={savingLanguage}
          error={languageError}
          onSelect={async (id) => {
            // Close only on a confirmed write, so a failure stays on screen
            // with its reason instead of vanishing.
            if (await setLanguage(id)) setSettingsOpen(false)
          }}
          onDismiss={() => setSettingsOpen(false)}
          variant="modal"
        />
      )}
    </div>
  )
}
