import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMetrics, renderNarrative } from './metrics.js'
import type { CodeEvent, SpeechSegment } from './types.js'

const edit = (t: number, added = 20, removed = 0, lines = 5): CodeEvent => ({
  t,
  kind: 'edit',
  added,
  removed,
  lines,
})

test('silent coding: flags a long unnarrated typing stretch', () => {
  // Talks 0-15s, silent 15-40s while typing, talks again 40-48s.
  const voiced: Array<[number, number]> = [
    [0, 15_000],
    [40_000, 48_000],
  ]
  const speech: SpeechSegment[] = [
    { start: 0, end: 15_000, text: 'let me think about the approach here' },
    { start: 40_000, end: 48_000, text: 'so this is linear time' },
  ]
  const events = [edit(21_000), edit(26_000), edit(31_000, 60, 30), edit(36_000)]

  const m = computeMetrics(events, speech, 48_000, voiced)

  assert.equal(m.silentCodingSpans.length, 1, 'expected exactly one silent-coding span')
  assert.ok(m.silentCodingMs > 15_000, `silentCodingMs was ${m.silentCodingMs}`)
  assert.equal(m.silentCodingSpans[0]!.added, 120)
  assert.equal(m.silentCodingSpans[0]!.removed, 30)
})

test('silence with no typing is not silent coding — that is being stuck', () => {
  const voiced: Array<[number, number]> = [
    [0, 5_000],
    [40_000, 48_000],
  ]
  const speech: SpeechSegment[] = [{ start: 0, end: 5_000, text: 'hmm' }]

  const m = computeMetrics([], speech, 48_000, voiced)

  assert.equal(m.silentCodingSpans.length, 0)
  assert.ok(m.longestSilenceMs > 30_000, 'the long pause should still show up as silence')
})

test('talk ratio comes from measured audio, not transcript boundaries', () => {
  // Whisper would report one segment spanning the whole session; the waveform
  // says only 10 of 60 seconds had speech in it.
  const speech: SpeechSegment[] = [{ start: 0, end: 60_000, text: 'a b c' }]
  const voiced: Array<[number, number]> = [[0, 10_000]]

  const withAudio = computeMetrics([], speech, 60_000, voiced)
  assert.ok(Math.abs(withAudio.talkRatio - 1 / 6) < 0.01, `got ${withAudio.talkRatio}`)

  // With no audio measurement available we fall back to the transcript.
  const fallback = computeMetrics([], speech, 60_000, [])
  assert.equal(fallback.talkRatio, 1)
})

test('planning window is negative when coding starts before speaking', () => {
  const speech: SpeechSegment[] = [{ start: 30_000, end: 35_000, text: 'right so' }]
  const m = computeMetrics([edit(5_000)], speech, 60_000, [[30_000, 35_000]])
  assert.equal(m.planningWindowMs, -25_000)
})

test('churn ratio reflects rewritten work', () => {
  const m = computeMetrics([edit(1_000, 100, 0), edit(2_000, 0, 80)], [], 10_000, [])
  assert.equal(m.totalAdded, 100)
  assert.equal(m.totalRemoved, 80)
  assert.ok(Math.abs(m.churnRatio - 0.8) < 1e-9)
})

test('narrative interleaves both tracks on one clock', () => {
  const speech: SpeechSegment[] = [{ start: 1_000, end: 3_000, text: 'using a hash map' }]
  const events: CodeEvent[] = [
    { t: 0, kind: 'phase', phase: 'start' },
    edit(2_000, 30, 0, 4),
    { t: 5_000, kind: 'run', passed: 2, total: 6, ok: false },
  ]
  const m = computeMetrics(events, speech, 10_000, [[1_000, 3_000]])
  const lines = renderNarrative(events, speech, m).split('\n')

  assert.match(lines[0]!, /\[00:00\] --- START ---/)
  assert.ok(lines.some((l) => /SAID.*hash map/.test(l)))
  assert.ok(lines.some((l) => /RAN.*2\/6.*FAILING/.test(l)))
  // Timestamps must be non-decreasing or the analyser reads the story out of order.
  const stamps = lines.map((l) => l.slice(1, 6))
  assert.deepEqual(stamps, [...stamps].sort())
})

test('empty session does not blow up', () => {
  const m = computeMetrics([], [], 0, [])
  assert.equal(m.talkRatio, 0)
  assert.equal(m.timeToFirstWordMs, null)
  assert.equal(m.churnRatio, 0)
})
