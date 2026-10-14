/**
 * Drag-ordering for the pinned area.
 *
 * The rules worth pinning are the boundary ones, because they are what the
 * requirement is actually about: a project's session can be reordered INSIDE its
 * project and must not be droppable anywhere else, while top-level rows (projects
 * and stand-alone pinned sessions) share one list and can be interleaved.
 *
 * The scope comparison is the whole enforcement, so these tests attack it from
 * both directions rather than only asserting the happy path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  TOP_SCOPE,
  DRAG_MIME,
  canDrop,
  decodeDragPayload,
  dragIdInScope,
  dropPositionAt,
  encodeDragPayload,
  moveBeside,
  orderAfterDrop,
  orderByStored,
  projectScope,
  reorderRequestFor,
  rowOrderKey,
  workspaceIdOfScope,
} = await import('../src/client/pinned-order.ts')

test('a project scope is distinguishable from the top level', () => {
  // The rule is one equality test, so these must never collide — including for
  // a workspace id that is literally the word used by the top-level scope.
  assert.equal(TOP_SCOPE, 'top')
  assert.equal(projectScope('w1'), 'project:w1')
  assert.notEqual(projectScope('w1'), TOP_SCOPE)
  assert.equal(workspaceIdOfScope(TOP_SCOPE), undefined)
  assert.equal(workspaceIdOfScope(projectScope('w1')), 'w1')
})

test('a row key names its kind, so a session and a project cannot collide', () => {
  // Both are plain ids in different lists; without the kind prefix an id that
  // appeared as both would occupy one slot and displace the other.
  assert.equal(rowOrderKey({ kind: 'workspace', id: 'x' }), 'workspace:x')
  assert.equal(rowOrderKey({ kind: 'session', id: 'x' }), 'session:x')
})

test('the drag id and the scope list agree — the duplication bug', () => {
  // MEASURED regression: the top-level session rows were dragged under a BARE id
  // while `idsInScope` listed them as `session:<id>`. `moveBeside` then missed
  // the lookup and inserted a second copy, so the stored list grew from 9 to 10
  // entries with the dragged row present twice.
  const session = { kind: 'session', id: 's1' }
  const project = { kind: 'workspace', id: 'w1' }

  // Top level: kind-qualified, matching how the list is keyed.
  assert.equal(dragIdInScope(TOP_SCOPE, session), 'session:s1')
  assert.equal(dragIdInScope(TOP_SCOPE, project), 'workspace:w1')
  assert.equal(dragIdInScope(TOP_SCOPE, session), rowOrderKey(session))

  // A project's children: the bare id, because that order goes to the host.
  assert.equal(dragIdInScope(projectScope('w1'), session), 's1')

  // The property that actually matters: moving a row within its own scope list
  // never changes the list's LENGTH. This is what the shipped bug violated.
  for (const [scope, entry] of [[TOP_SCOPE, session], [TOP_SCOPE, project], [projectScope('w1'), session]]) {
    const list = ['a', 'b', dragIdInScope(scope, entry), 'c']
    const after = moveBeside(list, dragIdInScope(scope, entry), 'a', 'before')
    assert.equal(after.length, list.length, `scope ${scope} duplicated a row`)
    assert.deepEqual([...after].sort(), [...list].sort())
  }
})

test('a drop is allowed only in the drag’s own scope', () => {
  const child = { scope: projectScope('p1'), id: 's1' }

  // Inside its own project: allowed.
  assert.equal(canDrop(child, { scope: projectScope('p1'), id: 's2', position: 'after' }), true)
  // "项目内会话行只能在项目内排" — every other list is refused, including the
  // top level and a DIFFERENT project.
  assert.equal(canDrop(child, { scope: TOP_SCOPE, id: 's2', position: 'before' }), false)
  assert.equal(canDrop(child, { scope: projectScope('p2'), id: 's2', position: 'before' }), false)
  // And a top-level row cannot be dropped into a project.
  assert.equal(canDrop({ scope: TOP_SCOPE, id: 's9' }, { scope: projectScope('p1'), id: 's1', position: 'before' }), false)
})

test('a row cannot be dropped on itself', () => {
  // A self-drop is a no-op that would still rewrite storage and, for a child,
  // issue a host call.
  const one = { scope: TOP_SCOPE, id: 'a' }
  assert.equal(canDrop(one, { scope: TOP_SCOPE, id: 'a', position: 'before' }), false)
})

test('moveBeside places a row before and after its target', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveBeside(list, 'd', 'a', 'before'), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveBeside(list, 'a', 'c', 'after'), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveBeside(list, 'a', 'd', 'after'), ['b', 'c', 'd', 'a'])
  assert.deepEqual(moveBeside(list, 'c', 'a', 'before'), ['c', 'a', 'b', 'd'])
})

test('moveBeside never mutates or loses a row', () => {
  const list = ['a', 'b', 'c']
  const out = moveBeside(list, 'a', 'c', 'after')
  assert.deepEqual(list, ['a', 'b', 'c'], 'the input must be left alone')
  assert.deepEqual([...out].sort(), [...list].sort(), 'no row may be gained or lost')
})

test('moveBeside is a no-op for an unknown target instead of throwing', () => {
  // The visible list can lag a click by a frame; a drag started against a stale
  // row must not break the surface.
  const list = ['a', 'b']
  assert.deepEqual(moveBeside(list, 'a', 'zzz', 'before'), ['a', 'b'])
  assert.deepEqual(moveBeside(list, 'a', 'a', 'before'), ['a', 'b'])
})

test('a stored order wins over the default ordering', () => {
  // The reason the override exists: the panel sorts pinned-first then by
  // recency, so a host write alone is invisible until a stored order beats it.
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(
    orderByStored(items, ['c', 'a', 'b'], (item) => item.id).map((item) => item.id),
    ['c', 'a', 'b'],
  )
})

test('rows the stored order does not name keep their default order and follow', () => {
  // This is what lets an arrangement survive a pin appearing elsewhere.
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(
    orderByStored(items, ['c', 'a'], (item) => item.id).map((item) => item.id),
    ['c', 'a', 'b', 'd'],
  )
})

test('an empty stored order leaves the list exactly as it was', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(orderByStored(items, [], (item) => item.id).map((item) => item.id), ['a', 'b'])
})

test('the drop stores the complete list, not just the moved row', () => {
  // Naming every visible row is what makes the next render reproduce the
  // arrangement rather than letting unnamed rows drift.
  assert.deepEqual(orderAfterDrop(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
})

test('dropPositionAt splits the row at its midpoint, as the host does', () => {
  const rect = { top: 100, height: 32 }
  assert.equal(dropPositionAt(rect, 100), 'before')
  assert.equal(dropPositionAt(rect, 115), 'before')   // 116 is the midpoint
  assert.equal(dropPositionAt(rect, 116), 'after')
  assert.equal(dropPositionAt(rect, 131), 'after')
})

test('a drag payload round-trips through its scope', () => {
  const payload = encodeDragPayload({ scope: projectScope('w1'), id: 's1' })
  assert.deepEqual(decodeDragPayload(payload), { scope: 'project:w1', id: 's1' })
})

test('a drag payload that is not ours decodes to undefined instead of throwing', () => {
  // Any drag on the page reaches the handler, including a file drag, so a bad
  // payload must read as "not a row" rather than blow up inside a DOM event.
  for (const raw of ['', 'not json', 'null', '[]', '"str"', '{}', '{"scope":"top"}', '{"id":"x"}', '{"scope":1,"id":"x"}']) {
    assert.equal(decodeDragPayload(raw), undefined, `should reject ${JSON.stringify(raw)}`)
  }
})

test('the drag MIME is private to this plugin', () => {
  // A generic type would make our rows indistinguishable from other drags.
  assert.match(DRAG_MIME, /^application\/x-dsh-workspace-plus-/)
})

test('a top-level drop becomes a stored arrangement, not a host call', () => {
  // The top level has no host API: `insertBefore` orders the workspace REGISTRY
  // (reshuffling the whole official sidebar) and `pinnedSessionIds` has no
  // reorder call at all.
  assert.deepEqual(reorderRequestFor(TOP_SCOPE, ['a', 'b'], 'a'), { kind: 'top', order: ['a', 'b'] })
})

test('a child drop carries the workspace and the moved row for the host', () => {
  // Children are written through with `insertSessionBefore`, which is
  // insertBefore-shaped and so needs the moved id as well as the target order.
  assert.deepEqual(
    reorderRequestFor(projectScope('w1'), ['s2', 's1'], 's1'),
    { kind: 'children', workspaceId: 'w1', order: ['s2', 's1'], movedId: 's1' },
  )
})
