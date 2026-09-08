/**
 * Row identification: DOM node → workspace/session id.
 *
 * This is the one piece that reads host internals (the React fiber the
 * official sidebar attaches to its rows), so it is also the piece most likely
 * to break on a DSH upgrade — and it fails silently: a row that is not
 * identified simply gets no menu. These pin both row shapes and the guards
 * that keep file-tree and subagent rows (which also use `role="treeitem"`)
 * from being mistaken for sidebar rows.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { rowInfo } = await import('../src/client/rows.ts')

/** Attach a fake React fiber to an element, as React does at runtime. */
function withFiber(props, extra = {}) {
  const el = {}
  let fiber = { memoizedProps: props, ...extra }
  Object.assign(el, { __reactFiber$abc: fiber })
  return el
}

/** Build a fiber chain: the row's props sit N hops above the DOM node. */
function withFiberChain(hops) {
  const el = {}
  let fiber
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    fiber = { memoizedProps: hops[i], return: fiber }
  }
  Object.assign(el, { __reactFiber$abc: fiber })
  return el
}

test('a workspace row is identified from its group', () => {
  const el = withFiber({ group: { workspaceId: 'ws-1', label: 'My Project' } })
  assert.deepEqual(rowInfo(el), { kind: 'workspace', id: 'ws-1', title: 'My Project' })
})

test('a session row is identified from its node', () => {
  const el = withFiber({ node: { id: 's-1', title: 'Fix the bug', updatedAt: 123, blank: false } })
  assert.deepEqual(rowInfo(el), { kind: 'session', id: 's-1', title: 'Fix the bug' })
})

test('a session row falls back to displayTitle', () => {
  const el = withFiber({ node: { id: 's-2', displayTitle: 'Derived', updatedAt: 0, blank: true } })
  assert.equal(rowInfo(el)?.title, 'Derived')
})

test('the row props are found several hops up the fiber chain', () => {
  const el = withFiberChain([
    { group: { workspaceId: 'ws-2', label: 'Nested' } },
    { className: 'wrapper' },
    { children: [] },
  ])
  assert.deepEqual(rowInfo(el), { kind: 'workspace', id: 'ws-2', title: 'Nested' })
})

test('a node without a fiber is not a row', () => {
  assert.equal(rowInfo({}), undefined)
})

test('a file-tree treeitem is not mistaken for a sidebar row', () => {
  // File trees also use role="treeitem" but carry neither shape.
  const el = withFiber({ node: { name: 'src', depth: 1 } })
  assert.equal(rowInfo(el), undefined)
})

test('a session node missing updatedAt is not a session row', () => {
  const el = withFiber({ node: { id: 's-3', title: 'x', blank: false } })
  assert.equal(rowInfo(el), undefined)
})

test('a session node with a non-boolean blank is not a session row', () => {
  const el = withFiber({ node: { id: 's-4', title: 'x', updatedAt: 1, blank: 1 } })
  assert.equal(rowInfo(el), undefined)
})

test('a group without a workspaceId is skipped, not reported as empty', () => {
  const el = withFiber({ group: { label: 'Unidentified' } })
  assert.equal(rowInfo(el), undefined)
})

test('a deeply nested chain without row props gives up instead of hanging', () => {
  const chain = Array.from({ length: 40 }, () => ({ className: 'x' }))
  assert.equal(rowInfo(withFiberChain(chain)), undefined)
})

test('ids are stringified so branded ids match the stored strings', () => {
  const el = withFiber({ group: { workspaceId: { toString: () => 'ws-9' }, label: 'Branded' } })
  assert.equal(rowInfo(el)?.id, 'ws-9')
})
