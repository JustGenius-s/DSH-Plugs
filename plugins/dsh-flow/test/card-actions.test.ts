import { expect, test } from 'vitest'

import { actionFor, actionsFor, type NodeActionTone } from '../src/client/actions.ts'
import type { NodeStatus } from '../src/shared.ts'

/**
 * The card's action rules, without rendering a component.
 *
 * These are the whole contract behind the three hover buttons: which actions a
 * status offers, in what order, and in what colour. The canvas only places
 * them; the Host still decides what each one means.
 */
const kinds = (status: NodeStatus) => actionsFor(status).map((action) => action.kind)

test('a running node can be paused or stopped, but not skipped', () => {
  // Skipping a live child is a stop wearing a friendlier name, so the card
  // does not offer both.
  expect(kinds('running')).toEqual(['pause', 'cancel'])
})

test('a paused node can be resumed or skipped, but not paused again', () => {
  expect(kinds('paused')).toEqual(['skip', 'resume'])
})

test('a queued node can be skipped or stopped before it is dispatched', () => {
  expect(kinds('ready')).toEqual(['skip', 'cancel'])
})

test('pending and expanded nodes can only be skipped', () => {
  expect(kinds('pending')).toEqual(['skip'])
  expect(kinds('expanded')).toEqual(['skip'])
})

test('terminal nodes offer no action — retrying is the Leader\'s call', () => {
  for (const status of ['done', 'skipped', 'failed'] as const) {
    expect(kinds(status)).toEqual([])
  }
})

test('tone is a property of the action, not of its slot', () => {
  const toneOf = (status: NodeStatus, kind: string): NodeActionTone => {
    const action = actionsFor(status).find((item) => item.kind === kind)
    if (action === undefined) throw new Error(`${status} offers no ${kind}`)
    return action.tone
  }
  // Skip is light blue everywhere it appears, pause/resume white, stop red.
  expect(toneOf('ready', 'skip')).toBe('accent')
  expect(toneOf('paused', 'skip')).toBe('accent')
  expect(toneOf('running', 'pause')).toBe('neutral')
  expect(toneOf('paused', 'resume')).toBe('neutral')
  expect(toneOf('running', 'cancel')).toBe('danger')
  expect(toneOf('ready', 'cancel')).toBe('danger')
})

test('every offered action maps to a node-scoped wire action', () => {
  for (const status of ['pending', 'ready', 'running', 'paused', 'expanded'] as const) {
    for (const action of actionsFor(status)) {
      expect(actionFor('step-2', action)).toEqual({ kind: action.kind, nodeId: 'step-2' })
    }
  }
})

test('paused is not a settled status, so dependents still wait', async () => {
  const { SETTLED_STATUSES } = await import('../src/shared.ts')
  expect(SETTLED_STATUSES).not.toContain('paused')
})
