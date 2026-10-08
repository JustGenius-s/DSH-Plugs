import { describe, expect, it, vi } from 'vitest'
import {
  buildParentLinkMessage,
  buildParentContextMessage,
  readParentContextMessage,
} from '../src/host/side-chat/context'

function user(text: string, kind = 'user') {
  return { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } }
}

function assistant(text: string) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

function digest(events: readonly unknown[], title?: string): string {
  const message = buildParentContextMessage({ events }, title)
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
}

describe('parent context digest', () => {
  it('links the parent without smuggling its task into a greeting', () => {
    const link = buildParentLinkMessage('session-parent')
    const text = JSON.stringify(link)
    expect(text).toContain('session-parent')
    expect(text).toContain('问候')
    expect(text).toContain('side_chat_read_main_session')
    expect(text).not.toContain('第一轮问题')
    expect(link.source).toMatchObject({ kind: 'dsh-codex' })
  })

  it('includes real user questions and nested assistant answers', () => {
    const text = digest([user('Define VibeFlow'), assistant('An AI workflow control center')], 'VibeFlow')
    expect(text).toContain('VibeFlow')
    expect(text).toContain('Define VibeFlow')
    expect(text).toContain('An AI workflow control center')
    const message = buildParentContextMessage({ events: [user('Q')] })
    expect(message?.source).toMatchObject({ kind: 'dsh-codex' })
  })

  it('does not let runtime context replace the real user question', () => {
    const text = digest([
      user('Define the audience'),
      user('Current runtime context. Snapshot', 'plugin'),
      user('workspace policy', 'agent-instructions'),
      user('available skills', 'skill-catalog'),
      user('subagent result', 'subagent'),
      assistant('Requesters, orchestrators and reviewers'),
    ])
    expect(text).toContain('Define the audience')
    expect(text).toContain('Requesters, orchestrators and reviewers')
    expect(text).not.toContain('Snapshot')
    expect(text).not.toContain('workspace policy')
    expect(text).not.toContain('available skills')
    expect(text).not.toContain('subagent result')
  })

  it('keeps the final answer of a multi-step turn and excludes tool traffic', () => {
    const text = digest([
      user('Architecture?'), assistant('Let me inspect'),
      { type: 'tool/result', data: { content: [{ type: 'text', text: 'tool bytes' }] } },
      assistant('Final architecture decision'),
      { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'private reasoning' }] } } },
    ])
    expect(text).toContain('Final architecture decision')
    expect(text).not.toContain('Let me inspect')
    expect(text).not.toContain('tool bytes')
    expect(text).not.toContain('private reasoning')
  })

  it('reports tool activity while the main session is still working', () => {
    const text = digest([
      user('Check the repository'),
      { type: 'assistant/message', data: { message: { content: [
        { type: 'text', text: 'I will inspect it' },
        { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"pwd"}' },
      ] } } },
      { type: 'tool/result', data: { message: { source: { callId: 'call-1' }, content: [
        { type: 'text', text: 'private raw output' },
      ] } } },
    ])
    expect(text).toContain('bash（已完成）')
    expect(text).toContain('pwd')
    expect(text).not.toContain('private raw output')
  })

  it('supports legacy flat assistant content and filters legacy reminders', () => {
    expect(digest([
      { type: 'user/message', data: { content: [{ type: 'text', text: 'Q' }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'Current runtime context. noise' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: 'A' }] } },
    ])).toContain('问：Q\n答：A')
  })

  it('keeps unanswered questions and orders recent turns first', () => {
    const text = digest([user('First'), assistant('Answer'), user('Still working')])
    expect(text.indexOf('Still working')).toBeLessThan(text.indexOf('First'))
    expect(text).toContain('Answer')
  })

  it('bounds both turn count and total text size', () => {
    const events = Array.from({ length: 10 }, (_, i) => [
      user(`question-${i}`), assistant(`answer-${i}`),
    ]).flat()
    const text = digest(events)
    expect(text).not.toContain('question-3')
    expect(text).toContain('question-4')
    expect(text).toContain('question-9')
    expect(text.indexOf('question-9')).toBeLessThan(text.indexOf('question-4'))
    const long = digest(Array.from({ length: 10 }, () => [
      user('Q'.repeat(10000)), assistant('A'.repeat(10000)),
    ]).flat(), 'T'.repeat(100))
    expect(long.length).toBeLessThanOrEqual(4000)
    expect(long).not.toContain('Q'.repeat(601))
    expect(long).not.toContain('A'.repeat(601))
  })

  it('does not invent context for blank or system-only conversations', () => {
    expect(digest([])).toBe('')
    expect(digest([null, {}, user('policy', 'plugin'), assistant('orphan')])).toBe('')
  })
})

describe('parent context history access', () => {
  it('reads the modern effective surface when Session.events no longer exists', async () => {
    const readSurface = vi.fn(async () => ({
      events: [user('VibeFlow audience'), assistant('Requesters and reviewers')],
    }))
    const message = await readParentContextMessage({ id: 'parent' }, { readSurface })
    expect(readSurface).toHaveBeenCalledExactlyOnceWith('parent')
    expect(JSON.stringify(message)).toContain('Requesters and reviewers')
  })

  it('uses the explicit parent ID when the live session has no ID property', async () => {
    const readSurface = vi.fn(async () => ({ events: [user('Current work')] }))
    await readParentContextMessage({ events: [] }, { readSurface }, undefined, 'session-parent')
    expect(readSurface).toHaveBeenCalledExactlyOnceWith('session-parent')
  })

  it('prefers the effective surface over obsolete raw history', async () => {
    const message = await readParentContextMessage({
      id: 'parent', events: [user('replaced text')],
    }, { readSurface: async () => ({ events: [user('current text')] }) })
    expect(JSON.stringify(message)).toContain('current text')
    expect(JSON.stringify(message)).not.toContain('replaced text')
  })

  it('supports older hosts without the query service', async () => {
    const events = [user('legacy question'), assistant('legacy answer')]
    const direct = await readParentContextMessage({ events }, undefined)
    const legacy = { id: 'parent', log: { events } }
    const nested = await readParentContextMessage(legacy, undefined)
    expect(JSON.stringify(direct)).toContain('legacy answer')
    expect(JSON.stringify(nested)).toContain('legacy answer')
  })

  it('distinguishes an unavailable history source from an empty conversation', async () => {
    await expect(readParentContextMessage({ id: 'parent' }, undefined)).rejects.toThrow('history is unavailable')
    await expect(readParentContextMessage({ events: [] }, undefined)).resolves.toBeUndefined()
    await expect(readParentContextMessage({ id: 'parent' }, {
      readSurface: async () => { throw new Error('query failed') },
    })).rejects.toThrow('query failed')
  })
})
