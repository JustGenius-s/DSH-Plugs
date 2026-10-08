/**
 * The title marquee's constants and the dialogs' single-request store.
 *
 * Both are plain modules with no DOM dependency, which is why they are testable
 * at all: the crawl itself needs a laid-out element, but the thresholds that
 * decide WHETHER it crawls are the part that is easy to get subtly wrong (a
 * title that jitters for a 3px overflow, or one that never reveals at all).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { MIN_TITLE_REVEAL_PX, TITLE_MARQUEE_PX_PER_MS } = await import('../src/client/title-marquee.ts')
const { askRemove, askRename, getDialogs, subscribeDialogs } = await import('../src/client/dialogs.ts')

test('the snapshot identity changes when a dialog opens or closes', () => {
  // This is the regression that made the dialogs silently never appear: a getter
  // returning one mutated object makes useSyncExternalStore believe nothing
  // changed, so React never re-renders.
  const before = getDialogs()
  const pending = askRename({ kind: 'session', id: 's1', title: 'old' })
  const opened = getDialogs()
  assert.notEqual(opened, before, 'opening must produce a NEW snapshot object')
  assert.equal(opened.rename?.target.id, 's1')
  opened.rename?.resolve(undefined)
  const closed = getDialogs()
  assert.notEqual(closed, opened, 'closing must produce a NEW snapshot object')
  assert.equal(closed.rename, null)
  return pending
})

test('reading the snapshot repeatedly returns the SAME object', () => {
  // This is the opposite failure of the one above, and it is just as silent: a
  // fresh object per read makes React see a change on every render and die with
  // "Maximum update depth exceeded" (React #185). Identity must move only when
  // the content does.
  const first = getDialogs()
  assert.equal(getDialogs(), first)
  assert.equal(getDialogs(), first)
})

test('the reveal threshold and speed match the official rows', () => {
  // These are the official session row's own values; drifting from them would
  // make a pinned title reveal differently from the row beside it.
  assert.equal(MIN_TITLE_REVEAL_PX, 8)
  assert.equal(TITLE_MARQUEE_PX_PER_MS, 0.03)
})

test('a rename request settles with the typed title', async () => {
  const pending = askRename({ kind: 'session', id: 's1', title: 'old' })
  const request = getDialogs().rename
  assert.equal(request?.target.id, 's1')
  request?.resolve('new')
  assert.equal(await pending, 'new')
  assert.equal(getDialogs().rename, null)
})

test('dismissing a rename resolves undefined, not the old title', async () => {
  // The caller must be able to tell "cancelled" from "submitted the same name".
  const pending = askRename({ kind: 'workspace', id: 'w1', title: 'old' })
  getDialogs().rename?.resolve(undefined)
  assert.equal(await pending, undefined)
})

test('a second rename request settles the first instead of stranding it', async () => {
  // Two dialogs for one row would leave the earlier promise pending forever.
  const first = askRename({ kind: 'session', id: 's1', title: 'a' })
  const second = askRename({ kind: 'session', id: 's2', title: 'b' })
  assert.equal(await first, undefined)
  assert.equal(getDialogs().rename?.target.id, 's2')
  getDialogs().rename?.resolve('c')
  assert.equal(await second, 'c')
})

test('a removal request reports the confirmation', async () => {
  const pending = askRemove('w9', 'gamma')
  const request = getDialogs().remove
  assert.equal(request?.workspaceId, 'w9')
  assert.equal(request?.title, 'gamma')
  request?.resolve(true)
  assert.equal(await pending, true)
  assert.equal(getDialogs().remove, null)
})

test('dialog subscribers are notified on request and on settle', async () => {
  let notifications = 0
  const unsubscribe = subscribeDialogs(() => { notifications += 1 })
  const pending = askRename({ kind: 'session', id: 's1', title: 'old' })
  const opened = notifications
  getDialogs().rename?.resolve('new')
  await pending
  unsubscribe()
  // One notification to show the dialog, one to hide it.
  assert.equal(opened, 1)
  assert.equal(notifications, 2)
})

test('an unsubscribed listener stops hearing about dialogs', async () => {
  let notifications = 0
  const unsubscribe = subscribeDialogs(() => { notifications += 1 })
  unsubscribe()
  const pending = askRename({ kind: 'session', id: 's1', title: 'old' })
  getDialogs().rename?.resolve(undefined)
  await pending
  assert.equal(notifications, 0)
})
