/**
 * A side chat reads TWO snapshots, and they are not the same object:
 *
 * - the chat content (`order` / `nodes`) comes from
 *   `uiConversation.target('chat').getSnapshot()`;
 * - the control face (`running` / `queue` / `pending`) comes from
 *   `session.getSnapshot()`.
 *
 * Since DSH 0.1.2 the control snapshot carries NO `chat` field, so a feature
 * written against the old flat `snapshot.chat` reads `undefined` forever and
 * renders nothing — exactly the side chat's "消息不渲染". These helpers read
 * each source loosely, because both are composed asynchronously and a partial
 * read must degrade to empty rather than throw.
 */

import { describe, expect, it } from 'vitest'
import {
  chatRowsOf,
  contextRowsOf,
  hasQueuedWork,
  hasVisibleContent,
  queuedRowsOf,
} from '../src/client/features/side-chat/snapshot'

type Node = { kind?: string; visibility?: string; key?: string }

const node = (kind: string, visibility = 'visible', key = kind): Node =>
  ({ kind, visibility, key })

const control = (extra: Record<string, unknown> = {}): any => extra

const chatOf = (nodes: Node[]): any => ({
  order: nodes.map(n => n.key ?? ''),
  nodes: new Map(nodes.map(n => [n.key ?? '', n])),
})

describe('contextRowsOf', () => {
  it('survives an undefined chat snapshot', () => {
    expect(contextRowsOf(undefined)).toEqual([])
  })

  it('survives a chat snapshot with neither order nor nodes', () => {
    expect(contextRowsOf({})).toEqual([])
  })

  it('survives an order whose nodes map is missing', () => {
    expect(contextRowsOf({ order: ['a'] })).toEqual([])
  })

  it('keeps only visible context rows', () => {
    const rows = contextRowsOf<Node>(chatOf([
      node('context', 'visible', 'ctx'),
      node('context', 'hidden', 'hidden'),
      node('user', 'visible', 'user'),
    ]))
    expect(rows.map(row => row.key)).toEqual(['ctx'])
  })
})

describe('chatRowsOf', () => {
  it('survives an undefined chat snapshot', () => {
    expect(chatRowsOf(undefined)).toEqual([])
  })

  it('drops keys whose node has not resolved yet', () => {
    const rows = chatRowsOf<Node>({
      order: ['a', 'missing', 'b'],
      nodes: new Map([['a', node('user', 'visible', 'a')], ['b', node('user', 'visible', 'b')]]),
    })
    expect(rows.map(row => row.key)).toEqual(['a', 'b'])
  })
})

describe('queuedRowsOf', () => {
  it('survives a missing queue', () => {
    expect(queuedRowsOf(control())).toEqual([])
    expect(queuedRowsOf(undefined)).toEqual([])
  })

  it('keeps queued AND steering items — both are messages the user sent', () => {
    // Rendering only `steering` is why a sent message looked like it vanished:
    // the composer sends with mode 'queue', so the item sits in the queue as
    // `queued` and stayed invisible until its turn began.
    const items = queuedRowsOf(control({
      queue: [{ id: 'a', placement: 'queued' }, { id: 'b', placement: 'steering' }],
    }))
    expect(items).toEqual([
      { id: 'a', placement: 'queued' },
      { id: 'b', placement: 'steering' },
    ])
  })

  it('drops injected context, which is model-facing and not conversation', () => {
    const items = queuedRowsOf(control({
      queue: [{ placement: 'context' }, { placement: 'queued' }],
    }))
    expect(items).toEqual([{ placement: 'queued' }])
  })

  it('drops an item with no placement', () => {
    expect(queuedRowsOf(control({ queue: [{}] }))).toEqual([])
  })
})

describe('hasQueuedWork', () => {
  it('counts an injected digest as work in flight', () => {
    expect(hasQueuedWork(control({ queue: [{ placement: 'context' }] }))).toBe(true)
  })

  it('is false for an empty queue', () => {
    expect(hasQueuedWork(control({ queue: [] }))).toBe(false)
    expect(hasQueuedWork(undefined)).toBe(false)
  })
})

describe('hasVisibleContent', () => {
  it('is false for an empty chat target', () => {
    expect(hasVisibleContent(chatOf([]))).toBe(false)
    expect(hasVisibleContent({})).toBe(false)
  })

  it('ignores context and turn-tail rows so they cannot displace the hero', () => {
    expect(hasVisibleContent(chatOf([
      node('context', 'visible', 'ctx'),
      node('turn-tail', 'visible', 'tail'),
    ]))).toBe(false)
  })

  it('reports content for a real row', () => {
    expect(hasVisibleContent(chatOf([node('user')]))).toBe(true)
  })

  it('skips hidden rows', () => {
    expect(hasVisibleContent(chatOf([node('user', 'hidden', 'u')]))).toBe(false)
  })

  // NOTE: running / pending / queue are NOT this function's concern. They live
  // on the control face, and the panel ORs them in separately — this helper
  // reads only the chat-content snapshot it is handed.
})
