import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachWebSocket, history, log, publish, stage, PIPELINE_STAGES } from './bus.js'

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const http = createServer()
  const wss = attachWebSocket(http, '2026-01-01T00:00:00.000Z')
  http.listen(0)
  await once(http, 'listening')
  const { port } = http.address() as { port: number }
  try {
    return await fn(port)
  } finally {
    // Sockets must be torn down explicitly: `http.close()` waits for open
    // connections and would otherwise hang the run.
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}

/**
 * Attach BEFORE the socket opens: the server sends `hello` from its connection
 * handler, so a listener added after `await once(socket, 'open')` can miss it.
 */
function collect(socket: WebSocket, until: (events: unknown[]) => boolean, timeoutMs = 3000) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const events: Record<string, unknown>[] = []
    const timer = setTimeout(
      () => reject(new Error(`timed out with ${JSON.stringify(events)}`)),
      timeoutMs,
    )
    socket.on('message', (data) => {
      events.push(JSON.parse(String(data)))
      if (until(events)) {
        clearTimeout(timer)
        resolve(events)
      }
    })
  })
}

test('a subscriber only receives its own session', async () => {
  await withServer(async (port) => {
    const socket = new WebSocket(`ws://localhost:${port}/ws?session=mine`)
    const collected = collect(socket, (e) => e.length >= 2)
    await once(socket, 'open')

    stage('theirs', 'convert', 'running')
    stage('mine', 'convert', 'running', 'only this one')

    const events = await collected
    assert.equal(events[0]!.type, 'hello')
    assert.equal(events[1]!.sessionId, 'mine')
    assert.equal(events[1]!.detail, 'only this one')
    socket.close()
  })
})

test('a client that connects late still sees what already happened', async () => {
  await withServer(async (port) => {
    // The pipeline can finish two stages before the browser has even opened the
    // socket; without replay the UI would show them as pending forever.
    stage('late', 'convert', 'done', 'already finished')
    log('late', 'warn', 'something worth knowing')

    const socket = new WebSocket(`ws://localhost:${port}/ws?session=late`)
    const events = await collect(socket, (e) => e.length >= 3)

    assert.equal(events[0]!.type, 'hello')
    assert.equal(events[1]!.type, 'stage')
    assert.equal(events[1]!.detail, 'already finished')
    assert.equal(events[2]!.type, 'log')
    socket.close()
  })
})

test('hello carries the server start time so a restart is detectable', async () => {
  await withServer(async (port) => {
    const socket = new WebSocket(`ws://localhost:${port}/ws`)
    const [hello] = await collect(socket, (e) => e.length >= 1)
    assert.equal(hello!.serverStartedAt, '2026-01-01T00:00:00.000Z')
    socket.close()
  })
})

test('history is bounded so a long session cannot grow without limit', () => {
  for (let i = 0; i < 200; i++) stage('bounded', 'align', 'running', `tick ${i}`)
  const kept = history('bounded')
  assert.ok(kept.length <= 60, `kept ${kept.length}`)
  // The most recent events are the ones that survive.
  assert.equal((kept[kept.length - 1] as { detail: string }).detail, 'tick 199')
})

test('the stage list the UI renders is the one the pipeline reports', () => {
  // A stage emitted by the pipeline but missing from PIPELINE_STAGES would
  // never appear in the checklist.
  const declared = new Set(PIPELINE_STAGES.map((s) => s.id))
  for (const id of ['convert', 'detect', 'transcribe', 'align', 'tests', 'debrief']) {
    assert.ok(declared.has(id as never), `${id} is emitted but not declared`)
  }
})

test('a dead subscriber does not break publishing for everyone else', async () => {
  await withServer(async (port) => {
    const alive = new WebSocket(`ws://localhost:${port}/ws?session=shared`)
    const doomed = new WebSocket(`ws://localhost:${port}/ws?session=shared`)
    const collected = collect(alive, (e) => e.some((x) => (x as { type: string }).type === 'stage'))
    await Promise.all([once(alive, 'open'), once(doomed, 'open')])

    doomed.terminate()
    await new Promise((r) => setTimeout(r, 100))

    assert.doesNotThrow(() =>
      publish({
        type: 'stage',
        sessionId: 'shared',
        stage: 'tests',
        state: 'done',
        at: new Date().toISOString(),
      }),
    )
    const events = await collected
    assert.ok(events.some((e) => e.type === 'stage'))
    alive.close()
  })
})
