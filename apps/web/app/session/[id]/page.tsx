'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  api,
  mmss,
  type CaseResult,
  type CodeEvent,
  type ProblemDetail,
  type RunResponse,
} from '@/lib/api'
import { useRecorder } from '@/lib/useRecorder'
import { useLiveStream } from '@/lib/useLiveStream'
import { ConnectionAlert, ConnectionBadge } from '@/components/ConnectionBadge'
import { Button, Chip } from '@/components/ui'
import { Processing } from '@/components/Processing'

/** Editor grammar per language id. Kept here so the editor never has to wait
 *  on /api/health before it can highlight anything. */
/** Java, C++ and Go stubs are camelCase, so the worked examples should match
 *  the name the candidate is actually looking at in the editor. */
function entryName(entry: string, language: string): string {
  if (language === 'python' || language === 'javascript') return entry
  return entry.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

const MONACO_LANGUAGE: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  go: 'go',
}

const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-faint">
      Loading editor…
    </div>
  ),
})

/** How long you can be quiet before the UI starts nudging. */
const NUDGE_AT_MS = 20_000
const FLUSH_EVERY_MS = 5_000
const SNAPSHOT_EVERY_MS = 30_000

export default function SessionRoom() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const recorder = useRecorder()
  const live = useLiveStream(id)

  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [language, setLanguage] = useState('python')
  const [code, setCode] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [phase, setPhase] = useState<'briefing' | 'live' | 'processing'>('briefing')
  const [run, setRun] = useState<RunResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const startedAt = useRef<number>(0)
  const queue = useRef<CodeEvent[]>([])
  const lastCode = useRef('')
  const codeRef = useRef('')

  const now = useCallback(() => Date.now() - startedAt.current, [])

  const push = useCallback((e: CodeEvent) => {
    queue.current.push(e)
  }, [])

  // ---------------------------------------------------------------- setup ---

  useEffect(() => {
    let cancelled = false
    api.session(id).then((s) => {
      if (cancelled) return
      setLanguage(s.meta.language)
      api.problem(s.meta.problemId).then((p) => {
        if (cancelled) return
        setProblem(p)
        const starter = p.starter[s.meta.language] ?? ''
        setCode(starter)
        lastCode.current = starter
        codeRef.current = starter
      })
    })
    return () => {
      cancelled = true
    }
  }, [id])

  // ------------------------------------------------------------- the clock ---

  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed(now()), 250)
    return () => clearInterval(t)
  }, [phase, now])

  // Flush queued events on a timer so a crash costs at most a few seconds.
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => {
      if (queue.current.length === 0) return
      const batch = queue.current
      queue.current = []
      api.sendEvents(id, batch).catch(() => queue.current.unshift(...batch))
    }, FLUSH_EVERY_MS)
    return () => clearInterval(t)
  }, [id, phase])

  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => {
      push({
        t: now(),
        kind: 'snapshot',
        code: codeRef.current,
        lines: codeRef.current.split('\n').length,
      })
    }, SNAPSHOT_EVERY_MS)
    return () => clearInterval(t)
  }, [phase, now, push])

  // Leaving mid-session would silently lose the recording.
  useEffect(() => {
    if (phase !== 'live') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  useEffect(() => {
    if (phase !== 'live') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void execute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, language, id, running])

  // ------------------------------------------------------------- controls ---

  async function begin() {
    const ok = await recorder.start()
    if (!ok) return
    startedAt.current = Date.now()
    push({ t: 0, kind: 'phase', phase: 'start' })
    setPhase('live')
  }

  const onCodeChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? ''
      const prev = lastCode.current
      setCode(next)
      codeRef.current = next

      if (phase !== 'live' || next === prev) return
      // Character-level delta is enough to reconstruct effort and churn without
      // storing every keystroke.
      const added = Math.max(0, next.length - prev.length)
      const removed = Math.max(0, prev.length - next.length)
      lastCode.current = next
      push({ t: now(), kind: 'edit', added, removed, lines: next.split('\n').length })
    },
    [phase, now, push],
  )

  async function execute() {
    if (!problem || running) return
    setRunning(true)
    try {
      const result = await api.run(id, codeRef.current, language)
      setRun(result)
      push({
        t: now(),
        kind: 'run',
        passed: result.passed,
        total: result.total,
        ok: result.error === null && result.passed === result.total,
      })
    } finally {
      setRunning(false)
    }
  }

  async function finish() {
    setPhase('processing')
    push({ t: now(), kind: 'phase', phase: 'submit' })

    const duration = now()
    const pending = queue.current
    queue.current = []
    if (pending.length) await api.sendEvents(id, pending).catch(() => {})

    const blob = await recorder.stop()
    if (blob && blob.size > 0) await api.uploadAudio(id, blob).catch(() => {})
    await api.finish(id, duration, codeRef.current, language).catch(() => {})
  }

  function reveal() {
    setRevealed(true)
    push({ t: now(), kind: 'reveal', what: 'the ambiguity checklist' })
  }

  // ---------------------------------------------------------------- render ---

  if (phase === 'processing')
    return <Processing id={id} onReady={() => router.push(`/report/${id}`)} />

  if (!problem) {
    return <div className="grid min-h-screen place-items-center text-sm text-faint">Loading…</div>
  }

  if (phase === 'briefing') {
    return <Briefing problem={problem} language={language} error={recorder.error} onBegin={begin} />
  }

  const budgetMs = problem.budgetMin * 60_000
  const overBudget = elapsed > budgetMs
  const nudge = phase === 'live' && recorder.silentForMs > NUDGE_AT_MS

  return (
    <div className="flex h-screen flex-col">
      <ConnectionAlert connection={live.connection} serverRestarted={live.serverRestarted} />
      <TopBar
        problem={problem}
        connection={live.connection}
        elapsed={elapsed}
        overBudget={overBudget}
        phase={phase}
        level={recorder.level}
        silentForMs={recorder.silentForMs}
        running={running}
        onRun={execute}
        onFinish={finish}
      />

      {nudge && (
        <div className="flex items-center justify-center gap-2 border-b border-warn/20 bg-warn/10 py-1.5 text-[11px] text-warn">
          <span className="size-1.5 rounded-full bg-warn" />
          Silent for {Math.round(recorder.silentForMs / 1000)}s — say what you are trying
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[38%] min-w-[340px] max-w-[560px] flex-col border-r border-line bg-surface">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <Chip tone={problem.difficulty}>{problem.difficulty}</Chip>
              <span className="font-mono text-[11px] text-faint">{problem.pattern}</span>
            </div>
            <h1 className="mb-4 text-lg font-medium tracking-tight">{problem.title}</h1>

            <div className="space-y-3 text-[13.5px] leading-relaxed text-ink/85">
              {problem.statement.split('\n\n').map((para, i) => (
                <p key={i}>
                  {para.split('`').map((part, j) =>
                    j % 2 === 1 ? (
                      <code
                        key={j}
                        className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-accent"
                      >
                        {part}
                      </code>
                    ) : (
                      part
                    ),
                  )}
                </p>
              ))}
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                Examples
              </div>
              <div className="space-y-1.5 font-mono text-[11.5px]">
                {problem.sampleTests.map((t, i) => (
                  <div key={i} className="rounded-md border border-line bg-raised px-2.5 py-1.5">
                    <span className="text-muted">{entryName(problem.entry, language)}(</span>
                    <span className="text-speech">
                      {t.args.map((a) => JSON.stringify(a)).join(', ')}
                    </span>
                    <span className="text-muted">) → </span>
                    <span className="text-accent">{JSON.stringify(t.expected)}</span>
                  </div>
                ))}
                <div className="pt-1 text-[11px] text-faint">
                  + {problem.hiddenTestCount} hidden cases you will not see until the report.
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-line pt-4">
              {revealed ? (
                <div className="text-[12px] leading-relaxed text-muted">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-warn">
                    Revealed — this is logged
                  </div>
                  A real interviewer will not hand you this list. Ask about input bounds, types,
                  duplicates, empty input, and what to return when there is no answer — out loud,
                  before you write anything.
                </div>
              ) : (
                <button
                  onClick={reveal}
                  className="text-[12px] text-faint underline decoration-dotted underline-offset-4 transition-colors hover:text-muted"
                >
                  Stuck on what to ask? Reveal a nudge (logged in your report)
                </button>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Monaco
              height="100%"
              language={MONACO_LANGUAGE[language] ?? 'plaintext'}
              theme="vs-dark"
              value={code}
              onChange={onCodeChange}
              onMount={(editor) => {
                editor.onDidPaste((e) => {
                  const model = editor.getModel()
                  if (!model || phase !== 'live') return
                  push({ t: now(), kind: 'paste', chars: model.getValueInRange(e.range).length })
                })
              }}
              options={{
                fontSize: 13.5,
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                fontLigatures: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                padding: { top: 18, bottom: 18 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'none',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                // No autocomplete: an interviewer's shared doc does not have it,
                // and leaning on it hides whether you know the API.
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                parameterHints: { enabled: false },
                tabSize: language === 'go' ? 4 : language === 'cpp' ? 2 : 4,
                insertSpaces: language !== 'go',
              }}
            />
          </div>
          <ResultsDrawer run={run} running={running} />
        </main>
      </div>
    </div>
  )
}

const LANGUAGE_LABEL: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  go: 'Go',
}

function Briefing({
  problem,
  language,
  error,
  onBegin,
}: {
  problem: ProblemDetail
  language: string
  error: string | null
  onBegin: () => void
}) {
  const rules = [
    [
      'Talk the whole way through',
      'Restate the problem, ask about the input, say what you are trying before you type it.',
    ],
    [
      'State complexity out loud',
      'Time and space, unprompted. Silence here caps that score at 1 no matter how good the code is.',
    ],
    [
      'No autocomplete, no internet',
      'The editor has suggestions turned off. It is you and the problem.',
    ],
    ['Nothing is uploaded', 'Audio, code and the write-up stay in this repo on your disk.'],
  ]

  return (
    <div className="relative grid min-h-screen place-items-center px-6">
      <div className="grid-field pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="inline-block size-2.5 rounded-full bg-accent" />
          <span className="font-mono text-sm tracking-tight">nod3</span>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <Chip tone={problem.difficulty}>{problem.difficulty}</Chip>
          <span className="font-mono text-[11px] text-faint">{problem.pattern}</span>
        </div>
        <h1 className="text-2xl font-medium tracking-tight">{problem.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {problem.budgetMin} minutes in {LANGUAGE_LABEL[language] ?? language}. The clock starts
          when you allow the microphone.
        </p>

        <ul className="my-8 space-y-4 border-y border-line py-7">
          {rules.map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-1.75 size-1 shrink-0 rounded-full bg-accent" />
              <div>
                <div className="text-[13px]">{title}</div>
                <div className="text-[12.5px] leading-relaxed text-faint">{body}</div>
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
            {error} — the session still works without audio, but the speech half of the report will
            be empty.
          </div>
        )}

        <Button variant="primary" onClick={onBegin} className="w-full py-2.5">
          Allow microphone and begin
        </Button>
      </div>
    </div>
  )
}

function TopBar({
  problem,
  connection,
  elapsed,
  overBudget,
  phase,
  level,
  silentForMs,
  running,
  onRun,
  onFinish,
}: {
  problem: ProblemDetail
  connection: Parameters<typeof ConnectionBadge>[0]['connection']
  elapsed: number
  overBudget: boolean
  phase: 'briefing' | 'live' | 'processing'
  level: number
  silentForMs: number
  running: boolean
  onRun: () => void
  onFinish: () => void
}) {
  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface px-5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-accent" />
        <span className="font-mono text-[13px] tracking-tight">nod3</span>
      </div>

      <div className="h-4 w-px bg-line" />

      {phase === 'live' ? (
        <>
          <div className="flex items-center gap-2">
            <span className="rec-dot inline-block size-2 rounded-full bg-danger" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-danger">rec</span>
          </div>
          <MicMeter level={level} silentForMs={silentForMs} />
        </>
      ) : (
        <span className="text-[13px] text-muted">Ready when you are</span>
      )}

      <div className="ml-auto flex items-center gap-4">
        <ConnectionBadge connection={connection} />
        <div className="text-right">
          <div
            className={`tabular font-mono text-lg leading-none ${overBudget ? 'text-danger' : 'text-ink'}`}
          >
            {mmss(elapsed)}
          </div>
          <div className="font-mono text-[10px] text-faint">of {problem.budgetMin}:00</div>
        </div>

        {phase === 'live' && (
          <>
            <Button onClick={onRun} disabled={running}>
              {running ? 'Running…' : 'Run tests'}
              <kbd className="rounded border border-line px-1 font-mono text-[10px] text-faint">
                ⌘⏎
              </kbd>
            </Button>
            <Button variant="danger" onClick={onFinish}>
              Finish
            </Button>
          </>
        )}
      </div>
    </header>
  )
}

function MicMeter({ level, silentForMs }: { level: number; silentForMs: number }) {
  const bars = 14
  const active = Math.round(level * bars)
  const quiet = silentForMs > NUDGE_AT_MS
  return (
    <div
      className="flex items-center gap-2"
      title={`Silent for ${Math.round(silentForMs / 1000)}s`}
    >
      <div className="flex h-4 items-end gap-[2px]">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm transition-all duration-75"
            style={{
              height: `${20 + (i / bars) * 80}%`,
              background:
                i < active
                  ? quiet
                    ? 'var(--color-warn)'
                    : 'var(--color-speech)'
                  : 'var(--color-line)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ResultsDrawer({ run, running }: { run: RunResponse | null; running: boolean }) {
  if (running) {
    return (
      <div className="relative h-11 shrink-0 overflow-hidden border-t border-line bg-surface">
        <div className="sweep absolute inset-0" />
        <div className="relative flex h-full items-center px-5 font-mono text-[11px] text-muted">
          running tests…
        </div>
      </div>
    )
  }
  if (!run) {
    return (
      <div className="flex h-11 shrink-0 items-center border-t border-line bg-surface px-5 font-mono text-[11px] text-faint">
        Run the tests when you have something worth checking.
      </div>
    )
  }

  if (run.error) {
    return (
      <div className="max-h-56 shrink-0 overflow-y-auto border-t border-danger/30 bg-danger/5 px-5 py-3">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-danger">
          {run.error}
        </div>
        <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink/80">
          {run.message}
        </pre>
      </div>
    )
  }

  const allPass = run.passed === run.total
  return (
    <div className="max-h-56 shrink-0 overflow-y-auto border-t border-line bg-surface">
      <div className="sticky top-0 flex items-center gap-3 border-b border-line bg-surface px-5 py-2">
        <span
          className="tabular font-mono text-[13px]"
          style={{ color: allPass ? 'var(--color-good)' : 'var(--color-danger)' }}
        >
          {run.passed}/{run.total}
        </span>
        <span className="font-mono text-[11px] text-faint">
          {allPass ? 'all passing — now argue why it is correct' : 'failing cases below'}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {run.results.map((r) => (
          <CaseRow key={r.index} result={r} />
        ))}
      </ul>
    </div>
  )
}

function CaseRow({ result }: { result: CaseResult }) {
  const color = result.passed ? 'var(--color-good)' : 'var(--color-danger)'
  return (
    <li className="flex items-start gap-3 px-5 py-2 font-mono text-[11.5px]">
      <span style={{ color }}>{result.passed ? '✓' : '✕'}</span>
      {result.hidden ? (
        <span className="text-faint">hidden case #{result.index + 1}</span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="text-muted">{JSON.stringify(result.args)}</span>
          {!result.passed && (
            <span className="text-danger">
              {result.error
                ? ` — ${result.error}`
                : ` → got ${JSON.stringify(result.got)}, want ${JSON.stringify(result.expected)}`}
            </span>
          )}
        </span>
      )}
    </li>
  )
}
