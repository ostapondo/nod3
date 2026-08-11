import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { mkdir, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  PORT,
  WEB_ORIGIN,
  DATA_DIR,
  SESSIONS_DIR,
  WHISPER_MODEL,
  ANALYSIS_ENGINE,
  modelPresent,
} from './config.js'
import { allProblems, getProblem, publicView, chooseNext } from './lib/problems.js'
import { LANGUAGES, isLanguage, runTests, type Language } from './lib/runner.js'
import { detectToolchains } from './lib/toolchain.js'
import { readSettings, writeSettings } from './lib/settings.js'
import { attachWebSocket, stage, PIPELINE_STAGES } from './lib/bus.js'
import { processSession } from './lib/pipeline.js'
import { runDebrief } from './lib/debrief.js'
import { respond, ChatUnavailable } from './lib/chat.js'
import {
  appendEvents,
  createSession,
  files,
  listSessions,
  readAnalysis,
  readChat,
  readCode,
  readEvents,
  readMeta,
  readMetrics,
  readProblem,
  readSpeech,
  readVoiced,
  sessionDir,
  writeCode,
} from './lib/store.js'
import type { CodeEvent, SessionMeta } from './lib/types.js'

const app = express()
app.use(cors({ origin: WEB_ORIGIN }))
app.use(express.json({ limit: '8mb' }))

// Deliberately outside SESSIONS_DIR: anything in there is treated as a session
// folder when the history is listed.
const UPLOAD_TMP = path.join(DATA_DIR, 'tmp-uploads')
const upload = multer({ dest: UPLOAD_TMP, limits: { fileSize: 512 * 1024 * 1024 } })

/**
 * `req.params.x` is `string | undefined` under noUncheckedIndexedAccess. Express
 * only calls a handler when its route matched, so a missing param is a routing
 * bug — surface it loudly rather than threading undefined through the store.
 */
function param(req: express.Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`)
  return value
}

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[${req.method} ${req.path}]`, message)
      if (!res.headersSent) res.status(500).json({ error: message })
    })
  }

// ---------------------------------------------------------------- health ---

app.get(
  '/api/health',
  wrap(async (_req, res) => {
    const chains = await detectToolchains()
    res.json({
      ok: true,
      whisperModel: WHISPER_MODEL,
      whisperReady: modelPresent(),
      analysisEngine: ANALYSIS_ENGINE,
      pipelineStages: PIPELINE_STAGES,
      languages: Object.entries(LANGUAGES).map(([id, v]) => ({
        id,
        ...v,
        available: chains[id]?.available ?? false,
        version: chains[id]?.version ?? null,
        install: chains[id]?.install ?? '',
      })),
    })
  }),
)

// -------------------------------------------------------------- settings ---

app.get(
  '/api/settings',
  wrap(async (_req, res) => {
    res.json(await readSettings())
  }),
)

app.patch(
  '/api/settings',
  wrap(async (req, res) => {
    const { language } = req.body as { language?: unknown }
    if (language !== undefined && language !== null && typeof language !== 'string') {
      return res.status(400).json({ error: 'language must be a string or null' })
    }
    try {
      // null is meaningful: it clears the choice so the first-run screen returns.
      res.json(await writeSettings({ language: (language ?? null) as string | null }))
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  }),
)

// -------------------------------------------------------------- problems ---

app.get(
  '/api/problems',
  wrap(async (_req, res) => {
    const problems = await allProblems()
    res.json(
      problems.map((p) => ({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty,
        pattern: p.pattern,
        tags: p.tags,
        budgetMin: p.budgetMin,
      })),
    )
  }),
)

app.get(
  '/api/problems/next',
  wrap(async (_req, res) => {
    const problems = await allProblems()
    const sessions = await listSessions()
    const history: Array<{ problemId: string; weakPatterns: string[] }> = []
    for (const s of sessions.slice(0, 20)) {
      const a = await readAnalysis(s.id)
      history.push({ problemId: s.problemId, weakPatterns: a?.weakPatterns ?? [] })
    }
    res.json({ id: chooseNext(problems, history).id })
  }),
)

app.get(
  '/api/problems/:id',
  wrap(async (req, res) => {
    const problem = await getProblem(param(req, 'id'))
    if (!problem) return res.status(404).json({ error: 'Unknown problem' })
    res.json(publicView(problem))
  }),
)

// -------------------------------------------------------------- sessions ---

app.post(
  '/api/sessions',
  wrap(async (req, res) => {
    const { problemId, language } = req.body as { problemId?: string; language?: string }
    const problem = problemId ? await getProblem(problemId) : null
    if (!problem) return res.status(400).json({ error: 'Unknown problemId' })
    if (!language || !isLanguage(language))
      return res.status(400).json({ error: 'Unsupported language' })

    const meta: SessionMeta = {
      id: randomUUID(),
      problemId: problem.id,
      problemTitle: problem.title,
      language,
      createdAt: new Date().toISOString(),
      status: 'recording',
    }
    await createSession(meta, problem)
    res.json(meta)
  }),
)

app.get(
  '/api/sessions',
  wrap(async (_req, res) => {
    const metas = await listSessions()
    const rows = []
    for (const m of metas) {
      const a = await readAnalysis(m.id)
      const metrics = await readMetrics(m.id)
      rows.push({
        ...m,
        verdict: a?.verdict ?? null,
        headline: a?.headline ?? null,
        score: a ? a.rubric.reduce((s, r) => s + r.score, 0) : null,
        maxScore: a ? a.rubric.length * 4 : null,
        talkRatio: metrics?.talkRatio ?? null,
        silentCodingMs: metrics?.silentCodingMs ?? null,
      })
    }
    res.json(rows)
  }),
)

app.post(
  '/api/sessions/:id/events',
  wrap(async (req, res) => {
    const { events } = req.body as { events?: CodeEvent[] }
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' })
    await appendEvents(param(req, 'id'), events)
    res.json({ ok: true, stored: events.length })
  }),
)

app.post(
  '/api/sessions/:id/run',
  wrap(async (req, res) => {
    const { code, language } = req.body as { code?: string; language?: string }
    const problem = await readProblem(param(req, 'id'))
    if (!problem) return res.status(404).json({ error: 'Unknown session' })
    if (!language || !isLanguage(language))
      return res.status(400).json({ error: 'Unsupported language' })

    await writeCode(param(req, 'id'), code ?? '', LANGUAGES[language].ext)
    const result = await runTests(code ?? '', problem, language, sessionDir(param(req, 'id')))

    // Hidden cases report pass/fail only — seeing their inputs mid-session would
    // turn the exercise into fitting the tests instead of solving the problem.
    res.json({
      ...result,
      results: result.results.map((r) =>
        r.hidden
          ? {
              index: r.index,
              hidden: true,
              passed: r.passed,
              note: null,
              error: r.error ? 'failed' : undefined,
            }
          : r,
      ),
    })
  }),
)

app.post(
  '/api/sessions/:id/audio',
  upload.single('audio'),
  wrap(async (req, res) => {
    const id = param(req, 'id')
    if (!existsSync(sessionDir(id))) return res.status(404).json({ error: 'Unknown session' })
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' })
    await rename(req.file.path, files.audio(id))
    res.json({ ok: true })
  }),
)

app.post(
  '/api/sessions/:id/finish',
  wrap(async (req, res) => {
    const id = param(req, 'id')
    const { durationMs, code, language } = req.body as {
      durationMs?: number
      code?: string
      language?: string
    }
    const meta = await readMeta(id)
    if (!meta) return res.status(404).json({ error: 'Unknown session' })
    const lang: Language = isLanguage(language ?? '')
      ? (language as Language)
      : (meta.language as Language)

    if (typeof code === 'string') await writeCode(id, code, LANGUAGES[lang].ext)

    // Respond immediately; transcription plus the write-up takes minutes and the
    // UI polls /status. Blocking here would just time out the fetch.
    res.json({ ok: true, id })
    processSession(id, Math.max(0, durationMs ?? 0), lang).catch((err) =>
      console.error(`[pipeline ${id}]`, err instanceof Error ? err.message : err),
    )
  }),
)

app.post(
  '/api/sessions/:id/reanalyse',
  wrap(async (req, res) => {
    const id = param(req, 'id')
    const meta = await readMeta(id)
    if (!meta) return res.status(404).json({ error: 'Unknown session' })
    if (meta.status === 'transcribing' || meta.status === 'analysing')
      return res.status(409).json({ error: 'This session is still being processed' })
    // Transcription is what costs minutes; if it never produced measurements
    // there is nothing on disk to write up and the session has to be redone.
    if (!(await readMetrics(id)))
      return res.status(409).json({ error: 'This session never got past transcription' })

    const lang: Language = isLanguage(meta.language) ? (meta.language as Language) : 'python'

    // The stage checklist is shared with a first run, and the transcription
    // half genuinely is finished — say so rather than leaving four steps
    // looking stuck for the length of the write-up.
    for (const done of ['convert', 'detect', 'transcribe', 'align'] as const) {
      stage(id, done, 'done', 'already on disk')
    }

    // Same shape as /finish: the write-up takes minutes and the UI watches the
    // socket, so answering now is the only thing that will not time out.
    res.json({ ok: true, id })
    runDebrief(id, lang, meta.durationMs ?? 0).catch((err) =>
      console.error(`[reanalyse ${id}]`, err instanceof Error ? err.message : err),
    )
  }),
)

/**
 * The debrief conversation. Streamed as SSE rather than over the shared socket:
 * the socket broadcasts pipeline progress to every listener, while an answer
 * belongs to the one client that asked for it.
 */
app.post(
  '/api/sessions/:id/chat',
  wrap(async (req, res) => {
    const id = param(req, 'id')
    const { message } = req.body as { message?: unknown }
    if (typeof message !== 'string') return res.status(400).json({ error: 'message must be text' })
    if (!(await readMeta(id))) return res.status(404).json({ error: 'Unknown session' })

    const abort = new AbortController()
    req.on('close', () => abort.abort())

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Next's dev proxy and most reverse proxies buffer without this.
      'x-accel-buffering': 'no',
    })
    res.flushHeaders()
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    try {
      await respond(id, message, { onDelta: (text) => send({ delta: text }), signal: abort.signal })
      send({ done: true })
    } catch (err) {
      if (abort.signal.aborted) return res.end()
      const detail = err instanceof Error ? err.message : String(err)
      send({ error: err instanceof ChatUnavailable ? detail : `The interviewer failed: ${detail}` })
    }
    res.end()
  }),
)

app.get(
  '/api/sessions/:id/status',
  wrap(async (req, res) => {
    const meta = await readMeta(param(req, 'id'))
    if (!meta) return res.status(404).json({ error: 'Unknown session' })
    res.json({ status: meta.status, stage: meta.stage ?? null, error: meta.error ?? null })
  }),
)

app.get(
  '/api/sessions/:id',
  wrap(async (req, res) => {
    const id = param(req, 'id')
    const meta = await readMeta(id)
    if (!meta) return res.status(404).json({ error: 'Unknown session' })
    const problem = await readProblem(id)
    const lang = meta.language as Language

    res.json({
      meta,
      problem,
      events: await readEvents(id),
      speech: (await readSpeech(id)) ?? [],
      voiced: (await readVoiced(id)) ?? [],
      metrics: await readMetrics(id),
      analysis: await readAnalysis(id),
      chat: await readChat(id),
      finalCode: await readCode(id, LANGUAGES[lang]?.ext ?? 'py'),
    })
  }),
)

// ------------------------------------------------------------------ boot ---

await mkdir(SESSIONS_DIR, { recursive: true })
await mkdir(UPLOAD_TMP, { recursive: true })

const startedAt = new Date().toISOString()

const server = app.listen(PORT, () => {
  console.log(`  nod3 server       http://localhost:${PORT}`)
  console.log(`  live updates      ws://localhost:${PORT}/ws`)
  console.log(`  data              ${SESSIONS_DIR}`)
  console.log(
    `  whisper model     ${modelPresent() ? WHISPER_MODEL : 'MISSING — run: npm run setup:model'}`,
  )
  console.log(`  analysis engine   ${ANALYSIS_ENGINE}`)
})

// Shares the HTTP server, so there is one port and one origin to reason about.
attachWebSocket(server, startedAt)
