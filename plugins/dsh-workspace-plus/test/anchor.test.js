/**
 * Row and slot identity from the official DOM's declared markers.
 *
 * This replaced a React-fiber scan, which guessed row shape from props and
 * broke silently on an upgrade. `data-row-key` and `data-slot` are contract:
 * declared by the owning packages, stable across the hashed class names that
 * change every build. The parse must stay strict — a key this plugin does not
 * recognize yields no row rather than a guessed identity that would put a menu
 * on the wrong row.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  parseRowKey,
  workspaceRowKey,
  sessionRowKey,
  isWorkspaceSlot,
  isBrowsingTree,
  isCollapsedRail,
} = await import('../src/client/anchor.ts')

test('the two row kinds this plugin owns are recognized', () => {
  assert.deepEqual(parseRowKey('workspace:abc'), { kind: 'workspace', id: 'abc' })
  assert.deepEqual(parseRowKey('session:session-1'), { kind: 'session', id: 'session-1' })
})

test('official keys that are not rows are refused, not guessed', () => {
  // `overflow:<group>` is the "show more" control and `empty` a placeholder.
  // Treating either as a row would attach actions to something unactionable.
  assert.equal(parseRowKey('overflow:abc'), undefined)
  assert.equal(parseRowKey('empty'), undefined)
  assert.equal(parseRowKey('workspace:'), undefined)
  assert.equal(parseRowKey('session:'), undefined)
  assert.equal(parseRowKey(''), undefined)
  assert.equal(parseRowKey(null), undefined)
  assert.equal(parseRowKey(undefined), undefined)
})

test('a prefix alone is not a row', () => {
  assert.equal(parseRowKey('workspace'), undefined)
  assert.equal(parseRowKey('session'), undefined)
})

test('ids containing the separator survive intact', () => {
  // Real session ids are `session-<uuid>`; nothing may be truncated at a colon.
  assert.deepEqual(parseRowKey('session:session-04af3522-9189'), {
    kind: 'session',
    id: 'session-04af3522-9189',
  })
})

test('the key builders round-trip with the parser', () => {
  assert.equal(workspaceRowKey('w1'), 'workspace:w1')
  assert.equal(sessionRowKey('s1'), 'session:s1')
  assert.deepEqual(parseRowKey(workspaceRowKey('w1')), { kind: 'workspace', id: 'w1' })
  assert.deepEqual(parseRowKey(sessionRowKey('s1')), { kind: 'session', id: 's1' })
})

test('only the workspace browsing hole is the mount anchor', () => {
  assert.equal(isWorkspaceSlot('sidebar.workspaces'), true)
  // The directory-flow hole is a CHILD of that browser; mounting there would
  // put the panel inside the official dialog's slot.
  assert.equal(isWorkspaceSlot('sidebar.workspaces.directoryFlow'), false)
  assert.equal(isWorkspaceSlot('sidebar'), false)
  assert.equal(isWorkspaceSlot(null), false)
  assert.equal(isWorkspaceSlot(undefined), false)
})

test('the collapsed rail is told apart from the wide column', () => {
  assert.equal(isCollapsedRail('hHd-Xa_root hHd-Xa_collapsed'), true)
  assert.equal(isCollapsedRail('hHd-Xa_root hHd-Xa_quietBars'), false)
  assert.equal(isCollapsedRail(''), false)
  assert.equal(isCollapsedRail(null), false)
  // A substring match would misfire on a class that merely contains the word.
  assert.equal(isCollapsedRail('hHd-Xa_collapsedThing'), false)
})

test('only the browsing tree may host the panel, never the search tree', () => {
  // While a search query is active the browser renders its results into a
  // DIFFERENT role=tree and replaces it on every keystroke, so anything of ours
  // mounted there is discarded — and a pinned list among search hits would be
  // meaningless anyway.
  assert.equal(isBrowsingTree('会话'), true)
  assert.equal(isBrowsingTree('Sessions'), true)
  assert.equal(isBrowsingTree('搜索结果'), false)
  assert.equal(isBrowsingTree('Search results'), false)
})

test('an unknown tree is left alone rather than adopted', () => {
  // "Anything that is not search" would silently claim a future third tree.
  assert.equal(isBrowsingTree(''), false)
  assert.equal(isBrowsingTree('something new'), false)
  assert.equal(isBrowsingTree(null), false)
  assert.equal(isBrowsingTree(undefined), false)
})
