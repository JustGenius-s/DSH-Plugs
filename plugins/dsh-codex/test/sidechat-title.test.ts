/**
 * Side-chat titles are derived from the side session's OWN first user message.
 *
 * A freshly forked side session has no event log yet — `session.events` is
 * undefined until the host materializes it. Reading `.find` on it threw
 * "Cannot read properties of undefined", which failed the whole LIST route
 * (the panel enumerates every side chat through it), so the panel could not
 * list its side chats at all.
 *
 * These are the session shapes the host actually hands over.
 */

import { describe, expect, it } from 'vitest'
import { sideChatTitleOf } from '../src/host/side-chat/server'

const userEvent = (text: string) => ({
  type: 'user/message' as const,
  data: { source: { kind: 'user' }, content: [{ type: 'text' as const, text }] },
})

const contextEvent = (text: string) => ({
  type: 'user/message' as const,
  // Injected context is user-role but NOT a user turn: it must not title the
  // side chat, or every tab is named after its parent's digest.
  data: { source: { kind: 'plugin' }, content: [{ type: 'text' as const, text }] },
})

describe('sideChatTitleOf', () => {
  it('titles from the first user message asked inside the side chat', () => {
    const session = { events: [userEvent('这个报错是什么意思')] }
    expect(sideChatTitleOf(session as never)).toBe('这个报错是什么意思')
  })

  it('returns undefined for a session whose log has not materialized', () => {
    // The crash: `events` is undefined on a just-created side session.
    expect(sideChatTitleOf({} as never)).toBeUndefined()
    expect(sideChatTitleOf({ events: undefined } as never)).toBeUndefined()
  })

  it('survives a log that is not an array', () => {
    expect(sideChatTitleOf({ events: null } as never)).toBeUndefined()
    expect(sideChatTitleOf({ events: 'nope' } as never)).toBeUndefined()
  })

  it('skips injected context, which is user-role but not a user turn', () => {
    const session = {
      events: [contextEvent('parent digest'), userEvent('真正的问题')],
    }
    expect(sideChatTitleOf(session as never)).toBe('真正的问题')
  })

  it('returns undefined when only injected context exists', () => {
    expect(sideChatTitleOf({ events: [contextEvent('digest')] } as never)).toBeUndefined()
  })

  it('returns undefined for an empty log', () => {
    expect(sideChatTitleOf({ events: [] } as never)).toBeUndefined()
  })

  it('collapses whitespace and truncates a long question', () => {
    const long = '很长的提问'.repeat(20)
    const title = sideChatTitleOf({ events: [userEvent(long)] } as never)
    expect(title).toBeDefined()
    expect((title ?? '').length).toBeLessThan(long.length)
    expect(title?.endsWith('…')).toBe(true)
    expect(sideChatTitleOf({ events: [userEvent('  前面   后面  ')] } as never)).toBe('前面 后面')
  })

  it('ignores a message whose blocks carry no text', () => {
    const session = { events: [{ type: 'user/message', data: { source: { kind: 'user' }, content: [] } }] }
    expect(sideChatTitleOf(session as never)).toBeUndefined()
  })
})
