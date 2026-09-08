/**
 * A side chat is built asynchronously, so its conversation snapshot is not
 * fully composed the first time the panel renders.
 *
 * Reading `snapshot.chat.order` (or `pending` / `queue`) directly crashed the
 * panel with "Cannot read properties of undefined (reading 'length')" on open,
 * which made the side chat impossible to use. Every one of these reads must
 * tolerate a partially composed snapshot; the other conversation surfaces in
 * this repo already guard them with `?.` (see full-session-load and the sticky
 * bubble).
 */

import { describe, expect, it } from 'vitest'
import {
  chatRowsOf,
  contextRowsOf,
  hasVisibleContent,
  pendingSteeringOf,
} from '../src/client/features/side-chat/snapshot'

type Node = { kind?: string; visibility?: string; key?: string }

const node = (kind: string, visibility = 'visible', key = kind): Node =>
  ({ kind, visibility, key })

const snapshot = (chat: unknown, extra: Record<string, unknown> = {}): any => ({ chat, ...extra })

const chatOf = (nodes: Node[]): any => ({
  order: nodes.map(n => n.key ?? ''),
  nodes: new Map(nodes.map(n => [n.key ?? '', n])),
})

describe('contextRowsOf', () => {
  it('survives an undefined snapshot', () => {
    expect(contextRowsOf(undefined)).toEqual([])
  })

  it('survives a snapshot with no chat slice', () => {
    expect(contextRowsOf(snapshot(undefined))).toEqual([])
  })

  it('survives a chat slice with neither order nor nodes', () => {
    expect(contextRowsOf(snapshot({}))).toEqual([])
  })

  it('survives an order whose nodes map is missing', () => {
    expect(contextRowsOf(snapshot({ order: ['a'] }))).toEqual([])
  })

  it('keeps only visible context rows', () => {
    const rows = contextRowsOf<Node>(snapshot(chatOf([
      node('context', 'visible', 'ctx'),
      node('context', 'hidden', 'hidden'),
      node('user', 'visible', 'user'),
    ])))
    expect(rows.map(row => row.key)).toEqual(['ctx'])
  })
})

describe('chatRowsOf', () => {
  it('survives a snapshot with no chat slice', () => {
    expect(chatRowsOf(undefined)).toEqual([])
    expect(chatRowsOf(snapshot(undefined))).toEqual([])
  })

  it('drops keys whose node has not resolved yet', () => {
    const rows = chatRowsOf<Node>(snapshot({
      order: ['a', 'missing', 'b'],
      nodes: new Map([['a', node('user', 'visible', 'a')], ['b', node('user', 'visible', 'b')]]),
    }))
    expect(rows.map(row => row.key)).toEqual(['a', 'b'])
  })
})

describe('pendingSteeringOf', () => {
  it('survives a missing queue', () => {
    expect(pendingSteeringOf(snapshot(undefined))).toEqual([])
  })

  it('keeps only steering-placed items', () => {
    const items = pendingSteeringOf(snapshot(undefined, {
      queue: [{ placement: 'steering' }, { placement: 'queued' }],
    }))
    expect(items.length).toBe(1)
  })
})

describe('hasVisibleContent', () => {
  it('survives a snapshot with no chat slice', () => {
    expect(hasVisibleContent(snapshot(undefined))).toBe(false)
  })

  it('survives a snapshot with no pending or queue', () => {
    expect(hasVisibleContent(snapshot(chatOf([])))).toBe(false)
  })

  it('ignores context and turn-tail rows so they cannot displace the hero', () => {
    expect(hasVisibleContent(snapshot(chatOf([
      node('context', 'visible', 'ctx'),
      node('turn-tail', 'visible', 'tail'),
    ])))).toBe(false)
  })

  it('reports content for a real row', () => {
    expect(hasVisibleContent(snapshot(chatOf([node('user')])))).toBe(true)
  })

  it('honours running, pending, and steering queue as content', () => {
    expect(hasVisibleContent(snapshot(chatOf([]), { running: true }))).toBe(true)
    expect(hasVisibleContent(snapshot(chatOf([]), { pending: [{}] }))).toBe(true)
    expect(hasVisibleContent(snapshot(chatOf([]), { queue: [{ placement: 'steering' }] }))).toBe(true)
    expect(hasVisibleContent(snapshot(chatOf([]), { queue: [{ placement: 'queued' }] }))).toBe(false)
  })

  it('skips hidden rows', () => {
    expect(hasVisibleContent(snapshot(chatOf([node('user', 'hidden', 'u')])))).toBe(false)
  })
})
