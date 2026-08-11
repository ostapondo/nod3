'use client'

import { useEffect, useRef, useState } from 'react'
import { api, type ChatTurn } from '@/lib/api'
import { Panel, PanelTitle } from '@/components/ui'

/**
 * The debrief conversation. The report answers "how did it go"; this answers
 * the question you actually have afterwards, which is usually "so what should
 * I have done instead" — and the interviewer here is holding the same record
 * the report was written from, so it can answer with timestamps.
 */

const PROMPTS = [
  ['Where did I go wrong?', 'Walk me through where my approach diverged from the optimal one.'],
  ['Show the solution', 'Write the optimal solution as working code, and explain the key idea.'],
  ['Drill me', 'Ask me one follow-up question you would have escalated to in the real round.'],
  [
    'What should I have said?',
    'During my longest silent stretch, what should I have been saying out loud?',
  ],
] as const

// --------------------------------------------------------------- rendering ---

/** `**bold**`, `*emphasis*` and `` `code` `` — the whole of what an answer uses inline. */
function Inline({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
  return (
    <>
      {pieces.map((piece, i) => {
        if (piece.startsWith('**') && piece.endsWith('**')) {
          return (
            <strong key={i} className="font-medium text-ink">
              {piece.slice(2, -2)}
            </strong>
          )
        }
        if (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) {
          return (
            <em key={i} className="text-ink italic">
              {piece.slice(1, -1)}
            </em>
          )
        }
        if (piece.startsWith('`') && piece.endsWith('`')) {
          return (
            <code
              key={i}
              className="rounded border border-line bg-canvas px-1 py-px font-mono text-[11.5px] text-accent/90"
            >
              {piece.slice(1, -1)}
            </code>
          )
        }
        return piece
      })}
    </>
  )
}

/** Where the next token will land. Sits inline, at the end of what is written. */
function Caret() {
  return (
    <span className="caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-accent" />
  )
}

/** Paragraphs and bullet lists. Everything else is left as written. */
function Prose({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = []
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+/.test(line)
    const last = blocks.at(-1)
    if (!line.trim()) {
      if (last) blocks.push({ list: false, lines: [] })
      continue
    }
    if (last && last.lines.length > 0 && last.list === bullet) last.lines.push(line)
    else blocks.push({ list: bullet, lines: [line] })
  }

  const rendered = blocks.filter((b) => b.lines.length > 0)

  return (
    <>
      {rendered.map((block, i) => {
        const tail = caret && i === rendered.length - 1
        return block.list ? (
          // Prose is capped near 70 characters. Full panel width is close to
          // 120, which is past the point where the eye loses the next line.
          <ul key={i} className="my-2 max-w-[70ch] space-y-1.5">
            {block.lines.map((line, j) => (
              <li key={j} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent/70" />
                <span>
                  <Inline text={line.replace(/^\s*[-*]\s+/, '')} />
                  {tail && j === block.lines.length - 1 && <Caret />}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="my-2 max-w-[70ch] text-[13px] leading-relaxed first:mt-0 last:mb-0">
            <Inline text={block.lines.join('\n')} />
            {tail && <Caret />}
          </p>
        )
      })}
    </>
  )
}

/**
 * Just enough markdown for what an interviewer actually writes. A parser for
 * the rest would be a dependency earning very little.
 */
function Rendered({ text, live = false }: { text: string; live?: boolean }) {
  const parts = text.split(/```/)
  // The caret belongs at the end of the text, inside whichever block is still
  // being written — appended after them all it drops onto a line of its own.
  const last = parts.reduce((keep, part, i) => (part.trim() ? i : keep), 0)

  return (
    <div className="text-ink/90">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const language = part.match(/^([a-z+#]+)\n/i)?.[1] ?? null
          return (
            // Hugs the longest line instead of stretching across the panel:
            // a twelve-line function floating in a full-width box reads as a
            // layout accident.
            <div
              key={i}
              className="my-3 w-fit min-w-88 max-w-full overflow-hidden rounded-lg border border-line bg-canvas first:mt-0 last:mb-0"
            >
              {language && (
                <div className="border-b border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  {language}
                </div>
              )}
              <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
                <code>
                  {part.replace(/^[a-z+#]*\n/i, '').replace(/\s+$/, '')}
                  {live && i === last && <Caret />}
                </code>
              </pre>
            </div>
          )
        }
        if (!part.trim()) return null
        return <Prose key={i} text={part} caret={live && i === last} />
      })}
    </div>
  )
}

// ------------------------------------------------------------------- panel ---

export function Chat({
  sessionId,
  initial,
  draft,
  onDraft,
  model,
}: {
  sessionId: string
  initial: ChatTurn[]
  /** Held by the report page so a finding can seed the next question. */
  draft: string
  onDraft: (value: string) => void
  model: string | null
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(initial)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waited, setWaited] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)

  const busy = streaming !== null
  const empty = turns.length === 0 && !busy

  // Follow the thread when a turn is added, not on every token — chasing each
  // delta would yank the page out from under anyone trying to read.
  useEffect(() => {
    if (turns.length > initial.length) {
      tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [turns.length, initial.length])

  // A question seeded from a finding should land in a focused box, ready to be
  // edited or sent, rather than somewhere the user has to go looking for.
  useEffect(() => {
    if (draft && document.activeElement !== inputRef.current) inputRef.current?.focus()
  }, [draft])

  // Only ticks before the first token; once text is flowing it is its own
  // progress indicator.
  useEffect(() => {
    if (streaming !== '') return
    const started = Date.now()
    setWaited(0)
    const tick = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [streaming])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setError(null)
    onDraft('')
    setTurns((prev) => [...prev, { role: 'user', content: question, at: new Date().toISOString() }])
    setStreaming('')

    try {
      const answer = await api.chat(sessionId, question, (delta) =>
        setStreaming((prev) => (prev ?? '') + delta),
      )
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: answer, at: new Date().toISOString() },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreaming(null)
    }
  }

  const prompts = (
    <div className="flex flex-wrap gap-2">
      {PROMPTS.map(([label, text]) => (
        <button
          key={label}
          type="button"
          disabled={busy}
          onClick={() => void send(text)}
          className="rounded-full border border-line bg-raised px-3 py-1.5 text-[11.5px] text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Panel className="mb-6">
      <PanelTitle
        aside={
          model ? <span className="font-mono text-[10px] text-faint">{model}</span> : undefined
        }
      >
        Talk it through
      </PanelTitle>

      {empty ? (
        <div>
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted">
            The round is over, so nothing is off limits now. The interviewer still has your
            transcript, your keystrokes and the answer key — ask why a choice cost you, or ask for
            the solution outright.
          </p>
          <div className="mt-4">{prompts}</div>
        </div>
      ) : (
        <div className="space-y-5">
          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                {/* Quieter than the answer: the question is context, the
                    answer is the thing you came back to read. */}
                <p className="max-w-[52ch] whitespace-pre-wrap rounded-lg rounded-br-sm border border-line bg-raised px-3.5 py-2 text-[12.5px] leading-relaxed text-ink/75">
                  {turn.content}
                </p>
              </div>
            ) : (
              <div key={i} className="border-l-2 border-accent/40 pl-4">
                <Rendered text={turn.content} />
              </div>
            ),
          )}

          {streaming !== null && (
            <div className="border-l-2 border-accent/60 pl-4">
              {streaming ? (
                <Rendered text={streaming} live />
              ) : (
                <div className="flex items-center gap-2.5 py-0.5">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="think-dot size-1 rounded-full bg-accent"
                        style={{ animationDelay: `${d * 0.16}s` }}
                      />
                    ))}
                  </span>
                  <span className="tabular font-mono text-[11px] text-faint">{waited}s</span>
                </div>
              )}
            </div>
          )}
          <div ref={tailRef} />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {!empty && <div className="mt-5">{prompts}</div>}

      {/* One control rather than two: the box takes the focus ring, the button
          sits inside it. */}
      <div className="mt-3 rounded-lg border border-line bg-canvas transition-colors focus-within:border-accent/50">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; a newline is the rare case, so it takes the modifier.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(draft)
            }
          }}
          placeholder="Ask about anything in the round…"
          className="block max-h-52 w-full resize-y bg-transparent px-3.5 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-3 px-3.5 pb-2 pt-1.5">
          <span className="font-mono text-[10px] text-faint">
            {busy ? 'answering…' : 'enter to send · shift+enter for a newline'}
          </span>
          {/* A washed-out accent reads as a broken button; disabled should
              simply be quiet. */}
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void send(draft)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              busy || !draft.trim()
                ? 'cursor-not-allowed border border-line bg-transparent text-faint'
                : 'bg-accent text-canvas hover:bg-accent/85'
            }`}
          >
            Ask
          </button>
        </div>
      </div>
    </Panel>
  )
}
