/**
 * Parent context digest for a freshly created side chat.
 *
 * A side chat never loads the parent's history — its transcript starts empty.
 * What it DOES inherit is a bounded recall digest of the parent's recent
 * turns, injected as a NON-WAKING model-facing context message so the side
 * agent answers with the main task in mind. The digest is context, not
 * history: nothing is written back to the parent, and the side chat's own
 * log stays a fresh session.
 *
 * Recovered from its one call site (`server.ts`'s `inheritParentContext`) —
 * the original file was destroyed with the uncommitted tree; the digest
 * shape below follows the CONTEXT.md domain language (side chat / context
 * digest): surface events only, latest turns first, character-capped, marked
 * as plugin-formed context rather than user speech.
 */

import { createUserMessage } from '@just-genius/dsh-plugin-runtime/host'
import type { Session, SessionEvent, UserMessage } from '@just-genius/dsh-plugin-runtime/host'

/** Soft cap on the digest, in characters of rendered text. */
const DIGEST_MAX_CHARS = 4_000
/** Hard cap on one turn's contribution, so a huge reply cannot eat the budget. */
const TURN_MAX_CHARS = 600
/** How many recent turns the digest keeps. */
const DIGEST_MAX_TURNS = 6

/** One quotable parent turn. */
interface DigestTurn {
  question: string
  answer: string
}

/**
 * Build the parent-context message injected into a new side chat.
 *
 * @returns the message to inject, or `undefined` when the parent has no
 *   quotable turns — the side chat then opens with no digest at all rather
 *   than an empty one.
 */
export function buildParentContextMessage(
  parent: Session,
  title?: string,
): UserMessage | undefined {
  const turns = recentTurns(parent)
  if (turns.length === 0) return undefined

  const header = typeof title === 'string' && title.trim().length > 0
    ? `这是主对话「${title.trim()}」的上下文摘要，供你参考。不要把它当作历史回复。\n\n`
    : '这是主对话的上下文摘要，供你参考。不要把它当作历史回复。\n\n'

  const body = turns
    .map(turn => {
      const question = clamp(turn.question, TURN_MAX_CHARS)
      const answer = clamp(turn.answer, TURN_MAX_CHARS)
      return answer.length === 0 ? `问：${question}` : `问：${question}\n答：${answer}`
    })
    .join('\n\n')

  const text = (header + body).slice(0, DIGEST_MAX_CHARS)

  // `kind: 'plugin'` authors the digest as harness-formed context, so the
  // model reads it as background rather than as the user speaking; the digest
  // is injected (not appended), so no turn opens until the user asks.
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-codex' },
  })
}

/**
 * The parent's recent turns, latest first.
 *
 * Reads surface events only (user questions and assistant answers);
 * runtime-context snapshots, system reminders, and tool traffic never enter a
 * digest — they are mechanics, not context.
 */
function recentTurns(parent: Session): DigestTurn[] {
  const events = sessionEventsOf(parent)
  const turns: DigestTurn[] = []
  let question: string | undefined
  for (const raw of events) {
    const event = raw as SessionEvent
    if (event.type === 'user/message') {
      const text = textOf(event)
      if (text.length === 0 || isRuntimeContext(text)) continue
      if (question !== undefined && question.length > 0) turns.push({ question, answer: '' })
      question = text
      continue
    }
    if (event.type === 'assistant/message' && question !== undefined) {
      const text = textOf(event)
      if (text.length === 0) continue
      turns.push({ question, answer: text })
      question = undefined
    }
  }
  if (question !== undefined && question.length > 0) turns.push({ question, answer: '' })
  return turns.slice(-DIGEST_MAX_TURNS).reverse()
}

/** The parent's committed events, read defensively across session shapes. */
function sessionEventsOf(parent: Session): readonly unknown[] {
  const candidate = parent as unknown as { events?: unknown; log?: { events?: unknown } }
  const events = candidate.events ?? candidate.log?.events
  return Array.isArray(events) ? events : []
}

function textOf(event: SessionEvent): string {
  const data = (event as { data?: { content?: unknown } }).data
  const content = data?.content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : '')
    .join('')
    .trim()
}

/** DSH emits runtime-context snapshots and reminders as user messages too. */
function isRuntimeContext(text: string): boolean {
  return text.startsWith('<system-reminder>')
    || text.startsWith('# runtime context')
    || text.startsWith('# Current runtime context')
}

function clamp(text: string, max: number): string {
  const value = text.trim()
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
