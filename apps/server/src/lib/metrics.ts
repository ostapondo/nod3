import type { CodeEvent, Metrics, SpeechSegment } from './types.js'

/** Speech within this window of a keystroke counts as narrating it. */
const NARRATION_PAD_MS = 3_000
/** Shorter silent stretches are normal typing rhythm, not a red flag. */
const MIN_SILENT_CODING_MS = 15_000

export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Merge overlapping intervals, assuming input sorted by start. */
function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const iv of intervals) {
    const last = out[out.length - 1]
    if (last && iv[0] <= last[1]) {
      last[1] = Math.max(last[1], iv[1])
    } else {
      out.push([iv[0], iv[1]])
    }
  }
  return out
}

export function computeMetrics(
  events: CodeEvent[],
  speech: SpeechSegment[],
  durationMs: number,
  /**
   * Speech intervals measured from the waveform. Strongly preferred over the
   * transcript's own timestamps, which stretch across pauses and would report a
   * mostly-silent session as mostly-talking. Falls back to the transcript when
   * no audio was captured.
   */
  voiced?: Array<[number, number]>,
): Metrics {
  const sortedSpeech = [...speech].sort((a, b) => a.start - b.start)
  const sortedEvents = [...events].sort((a, b) => a.t - b.t)

  const voicedSpans: Array<[number, number]> =
    voiced && voiced.length > 0
      ? mergeIntervals([...voiced].sort((a, b) => a[0] - b[0]))
      : mergeIntervals(sortedSpeech.map((s) => [s.start, s.end] as [number, number]))

  const edits = sortedEvents.filter(
    (e): e is Extract<CodeEvent, { kind: 'edit' }> => e.kind === 'edit',
  )
  const runs = sortedEvents.filter(
    (e): e is Extract<CodeEvent, { kind: 'run' }> => e.kind === 'run',
  )
  const pastes = sortedEvents.filter(
    (e): e is Extract<CodeEvent, { kind: 'paste' }> => e.kind === 'paste',
  )

  const totalAdded = edits.reduce((s, e) => s + e.added, 0)
  const totalRemoved = edits.reduce((s, e) => s + e.removed, 0)

  const firstWord = voicedSpans[0]?.[0] ?? sortedSpeech[0]?.start ?? null
  const firstKeystroke = edits[0]?.t ?? null

  const speechMs = voicedSpans.reduce((s, [a, b]) => s + Math.max(0, b - a), 0)
  const words = sortedSpeech.reduce(
    (s, seg) => s + seg.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  )

  // Longest stretch with nobody talking, including the head and tail of the session.
  let longestSilenceMs = 0
  let longestSilenceAtMs: number | null = null
  let cursor = 0
  for (const [start, end] of voicedSpans) {
    const gap = start - cursor
    if (gap > longestSilenceMs) {
      longestSilenceMs = gap
      longestSilenceAtMs = cursor
    }
    cursor = Math.max(cursor, end)
  }
  if (durationMs - cursor > longestSilenceMs) {
    longestSilenceMs = durationMs - cursor
    longestSilenceAtMs = cursor
  }

  // "Dark coding": you were typing but not explaining. This is the single most
  // common thing that sinks an otherwise correct Google interview, and it is
  // invisible unless you line the two tracks up.
  const narrated = mergeIntervals(
    voicedSpans.map(
      ([a, b]) => [Math.max(0, a - NARRATION_PAD_MS), b + NARRATION_PAD_MS] as [number, number],
    ),
  )
  // Take the gaps between narrated stretches, then keep the ones where the
  // editor was busy. Measuring the silence itself — rather than the distance
  // between the first and last keystroke inside it — is what makes the number
  // match what the candidate experienced: "you went quiet for 25 seconds".
  const silentCodingSpans: Metrics['silentCodingSpans'] = []
  let gapStart = 0
  const gaps: Array<[number, number]> = []
  for (const [a, b] of narrated) {
    if (a > gapStart) gaps.push([gapStart, a])
    gapStart = Math.max(gapStart, b)
  }
  if (gapStart < durationMs) gaps.push([gapStart, durationMs])

  for (const [start, end] of gaps) {
    if (end - start < MIN_SILENT_CODING_MS) continue
    const inside = edits.filter((e) => e.t >= start && e.t <= end)
    // Silence with no typing is being stuck, not silent coding. `longestSilenceMs`
    // already reports that; this metric is specifically about writing unnarrated code.
    if (inside.length === 0) continue
    silentCodingSpans.push({
      start,
      end,
      added: inside.reduce((s, e) => s + e.added, 0),
      removed: inside.reduce((s, e) => s + e.removed, 0),
    })
  }

  const silentCodingMs = silentCodingSpans.reduce((s, sp) => s + (sp.end - sp.start), 0)
  const lastRun = runs[runs.length - 1]

  return {
    durationMs,
    timeToFirstWordMs: firstWord,
    timeToFirstKeystrokeMs: firstKeystroke,
    planningWindowMs:
      firstWord !== null && firstKeystroke !== null ? firstKeystroke - firstWord : null,
    talkRatio: durationMs > 0 ? speechMs / durationMs : 0,
    wordsPerMinute: speechMs > 0 ? words / (speechMs / 60_000) : 0,
    longestSilenceMs,
    longestSilenceAtMs,
    silentCodingMs,
    silentCodingSpans,
    runCount: runs.length,
    firstRunAtMs: runs[0]?.t ?? null,
    finalPassed: lastRun?.passed ?? null,
    finalTotal: lastRun?.total ?? null,
    churnRatio: totalAdded > 0 ? totalRemoved / totalAdded : 0,
    totalAdded,
    totalRemoved,
    speechSegments: sortedSpeech.length,
    pasteCount: pastes.length,
    pastedChars: pastes.reduce((s, p) => s + p.chars, 0),
  }
}

/**
 * Render both tracks as one chronological script. This is what the analyser
 * reads — it can only judge "he said X while writing Y" if X and Y arrive
 * interleaved on a single clock.
 */
export function renderNarrative(
  events: CodeEvent[],
  speech: SpeechSegment[],
  metrics: Metrics,
): string {
  // Ties on timestamp are broken by `order` so the story reads correctly: the
  // phase marker opens, a silence banner frames what follows, then what was
  // said, then what was typed, then the outcome.
  type Row = { t: number; order: number; line: string }
  const ORDER = { phase: -2, silent: -1, said: 0, typed: 1, event: 2 } as const
  const rows: Row[] = []

  for (const s of speech) {
    rows.push({ t: s.start, order: ORDER.said, line: `SAID    ${s.text.trim()}` })
  }

  // Collapse edit spam into 15s buckets, otherwise the narrative is unreadable
  // and the signal (what he said) drowns in keystroke noise.
  const BUCKET = 15_000
  const buckets = new Map<number, { added: number; removed: number; lines: number }>()
  for (const e of events) {
    if (e.kind !== 'edit') continue
    const k = Math.floor(e.t / BUCKET)
    const b = buckets.get(k) ?? { added: 0, removed: 0, lines: e.lines }
    b.added += e.added
    b.removed += e.removed
    b.lines = e.lines
    buckets.set(k, b)
  }
  for (const [k, b] of buckets) {
    rows.push({
      t: k * BUCKET,
      order: ORDER.typed,
      line: `TYPED   +${b.added} −${b.removed} chars (file now ${b.lines} lines)`,
    })
  }

  for (const e of events) {
    if (e.kind === 'run') {
      rows.push({
        t: e.t,
        order: ORDER.event,
        line: `RAN     tests ${e.passed}/${e.total} passing${e.ok ? '' : ' — FAILING'}`,
      })
    } else if (e.kind === 'paste') {
      rows.push({ t: e.t, order: ORDER.event, line: `PASTED  ${e.chars} chars` })
    } else if (e.kind === 'reveal') {
      rows.push({ t: e.t, order: ORDER.event, line: `REVEALED ${e.what}` })
    } else if (e.kind === 'phase') {
      rows.push({ t: e.t, order: ORDER.phase, line: `--- ${e.phase.toUpperCase()} ---` })
    }
  }

  for (const span of metrics.silentCodingSpans) {
    rows.push({
      t: span.start,
      order: ORDER.silent,
      line: `SILENT  coded for ${Math.round((span.end - span.start) / 1000)}s without saying anything (+${span.added} −${span.removed} chars)`,
    })
  }

  rows.sort((a, b) => a.t - b.t || a.order - b.order)
  return rows.map((r) => `[${mmss(r.t)}] ${r.line}`).join('\n')
}
