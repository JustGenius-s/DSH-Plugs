/**
 * Locating the official Project row menu.
 *
 * DSH exposes no slot for that menu, so the plugin watches for it and portals
 * its rows in. The association is the fragile part: the open menu carries no
 * back-reference to its row, so the row must be recorded from the pointerdown
 * that opened it. A wrong answer would put the plugin's actions on someone
 * else's row, so the recognition rules are pinned here — the pure part only,
 * as the repo's tests take functions and interfaces and never the DOM.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { workspaceIdOfKey } = await import('../src/client/workspace-menu.ts')

test('the id comes from the workspace row key', () => {
  assert.equal(workspaceIdOfKey('workspace:w1'), 'w1')
})

test('a session row is not a workspace row', () => {
  assert.equal(workspaceIdOfKey('session:s1'), undefined)
})

test('the overflow control and the empty placeholder are not rows', () => {
  // Both are `data-row-key` values in the official markup; treating either as a
  // row would attach the plugin's actions to an unactionable element.
  assert.equal(workspaceIdOfKey('overflow:w1'), undefined)
  assert.equal(workspaceIdOfKey('empty'), undefined)
})

test('a bare prefix or an empty id is refused', () => {
  assert.equal(workspaceIdOfKey('workspace:'), undefined)
  assert.equal(workspaceIdOfKey('workspace'), undefined)
  assert.equal(workspaceIdOfKey(''), undefined)
  assert.equal(workspaceIdOfKey(null), undefined)
  assert.equal(workspaceIdOfKey(undefined), undefined)
})

test('an id containing a separator survives intact', () => {
  assert.equal(workspaceIdOfKey('workspace:2d56c856-384d-4d99'), '2d56c856-384d-4d99')
})
