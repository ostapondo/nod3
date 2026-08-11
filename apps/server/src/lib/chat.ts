import { complete, type ChatMessage } from './engines.js'
import { buildChatSystem } from './prompt.js'
import { isLanguage, LANGUAGES, type Language } from './runner.js'
import {
  appendChat,
  readAnalysis,
  readChat,
  readCode,
  readMeta,
  readMetrics,
  readNarrative,
  readProblem,
} from './store.js'
import type { ChatTurn } from './types.js'

/**
 * Talking the round through once the report exists. The written debrief is a
 * verdict; this is the part where you get to ask why, and to see the solution
 * you did not reach.
 */

/**
 * How much of the conversation to replay. The session dossier dwarfs any of
 * these turns, so the cap is about keeping a long thread from crowding out the
 * record rather than about saving tokens.
 */
const HISTORY_TURNS = 24

/** The session cannot support a conversation — a 409, not a crash. */
export class ChatUnavailable extends Error {}

/**
 * The stable half of the prompt: everything the session produced. Identical on
 * every turn, which is what makes it worth caching upstream.
 */
async function dossier(id: string): Promise<string> {
  const [problem, metrics, meta] = await Promise.all([
    readProblem(id),
    readMetrics(id),
    readMeta(id),
  ])
  // Before the pipeline runs there is nothing to discuss: no transcript, no
  // measurements, no code that has been graded.
  if (!problem || !metrics) throw new ChatUnavailable('This session has not been written up yet.')

  const language: Language = isLanguage(meta?.language ?? '')
    ? (meta!.language as Language)
    : 'python'

  return buildChatSystem(
    problem,
    metrics,
    (await readNarrative(id)) || '(no speech and no edits were recorded)',
    (await readCode(id, LANGUAGES[language].ext)) || '(nothing submitted)',
    language,
    await readAnalysis(id),
  )
}

export async function respond(
  id: string,
  message: string,
  opts: { onDelta: (text: string) => void; signal?: AbortSignal },
): Promise<string> {
  const question = message.trim()
  if (!question) throw new ChatUnavailable('Ask something first.')

  const system = await dossier(id)
  const history = await readChat(id)

  const asked: ChatTurn = { role: 'user', content: question, at: new Date().toISOString() }
  // Persist the question before asking, so an interrupted answer still leaves a
  // readable thread rather than losing what was asked.
  await appendChat(id, [asked])

  const messages: ChatMessage[] = [...history, asked]
    .slice(-HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content }))

  let answer = ''
  try {
    await complete({
      system,
      messages,
      onDelta: (chunk) => {
        answer += chunk
        opts.onDelta(chunk)
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } finally {
    // Whatever came back — including an answer cut short by the client
    // navigating away — belongs in the thread. An empty one does not.
    if (answer.trim()) {
      await appendChat(id, [{ role: 'assistant', content: answer, at: new Date().toISOString() }])
    }
  }

  return answer
}
