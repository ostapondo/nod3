'use client'

import { useEffect } from 'react'
import type { LanguageInfo } from '@/lib/api'

/** A line about what picking this language actually gets you. */
const BLURB: Record<string, string> = {
  python: 'Fastest to write. What most candidates use.',
  javascript: 'No setup at all — runs on the server you already started.',
  typescript: 'Types erased at run time, so annotations cost you nothing.',
  java: 'LeetCode-style `class Solution`.',
  cpp: 'C++17 with the usual headers already included.',
  go: 'Your own import block, tabs, no generics needed.',
}

export function LanguageChooser({
  languages,
  selected,
  saving,
  error,
  onSelect,
  onDismiss,
  variant,
}: {
  languages: LanguageInfo[]
  selected: string | null
  /** The card that was clicked but is not confirmed by the server yet. */
  saving?: string | null
  error?: string | null
  onSelect: (id: string) => void
  onDismiss?: () => void
  variant: 'first-run' | 'modal'
}) {
  useEffect(() => {
    if (!onDismiss) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const grid = (
    <div className="grid gap-2 sm:grid-cols-2">
      {languages.map((l) => {
        const active = selected === l.id
        const pending = saving === l.id
        // A click has to look like it landed even while the write is in flight;
        // otherwise picking a language reads as doing nothing at all.
        const lit = active || pending
        return (
          <button
            key={l.id}
            data-language={l.id}
            data-state={pending ? 'saving' : active ? 'selected' : 'idle'}
            onClick={() => l.available && !saving && onSelect(l.id)}
            disabled={!l.available || Boolean(saving)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              lit
                ? 'border-accent/60 bg-accent/10'
                : l.available
                  ? 'border-line bg-raised hover:border-faint'
                  : 'cursor-not-allowed border-line bg-surface opacity-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm ${lit ? 'text-accent' : 'text-ink'}`}>{l.label}</span>
              {pending ? (
                <span className="font-mono text-[10px] text-accent">saving…</span>
              ) : active ? (
                <span className="font-mono text-[10px] text-accent">selected</span>
              ) : null}
            </div>
            <div className="mt-1 text-[11.5px] leading-snug text-faint">
              {l.available ? BLURB[l.id] : 'Not installed on this machine'}
            </div>
            <div className="mt-1.5 truncate font-mono text-[10px] text-faint/70">
              {l.available ? (l.version ?? '') : l.install}
            </div>
          </button>
        )
      })}
    </div>
  )

  if (variant === 'first-run') {
    return (
      <div className="relative grid min-h-screen place-items-center px-6">
        <div className="grid-field pointer-events-none absolute inset-0" />
        <div className="relative w-full max-w-2xl">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="inline-block size-2.5 rounded-full bg-accent" />
            <span className="font-mono text-sm tracking-tight">nod3</span>
          </div>

          <h1 className="text-2xl font-medium tracking-tight">
            Which language will you interview in?
          </h1>
          <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-muted">
            Pick the one you would actually use in the room. Every problem has a stub and a graded
            test suite in all six. You can change it any time from Settings.
          </p>

          <div className="my-8">{grid}</div>

          {error && (
            <div
              data-testid="settings-error"
              className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] text-danger"
            >
              {error} Your choice was not stored, so this screen will come back — check that the
              local server is running.
            </div>
          )}

          <p className="font-mono text-[11px] text-faint">
            Greyed-out entries just need their compiler installed — the command is on the card.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-canvas/80 px-6 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-line bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium tracking-tight">Interview language</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              Applies to sessions you start from now on. Past sessions keep the language they were
              recorded in.
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 rounded-md px-2 py-1 font-mono text-[11px] text-faint hover:text-ink"
          >
            esc
          </button>
        </div>
        {grid}
        {error && (
          <div
            data-testid="settings-error"
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
