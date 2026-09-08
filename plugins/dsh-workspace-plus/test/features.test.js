/**
 * Feature switches for the row menus.
 *
 * The contract that matters: an unknown or corrupt stored flag must never
 * disable a feature the user has not explicitly turned off, and toggling one
 * switch must not disturb the pin/unread lists or any other switch.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// `features.ts` is browser code (localStorage), so it is imported after the
// stub below is installed.
let features

const installStorage = (initial) => {
  const store = new Map(Object.entries(initial ?? {}))
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  return store
}

beforeEach(async () => {
  installStorage()
  // Fresh module instance per test: the module caches `state` at load.
  features = await import(`../src/client/features.ts?t=${Date.now()}${Math.random()}`)
})

afterEach(() => {
  delete globalThis.localStorage
})

test('every feature is on by default', () => {
  for (const key of features.FEATURE_KEYS) {
    assert.equal(features.isEnabled(key), true, `${key} defaults on`)
  }
})

test('the destructive delete actions are not offered at all', () => {
  assert.equal(
    features.FEATURE_KEYS.includes('workspaceDeleteDisk'),
    false,
    'the disk-deleting workspace action is gone',
  )
  assert.equal(
    features.FEATURE_KEYS.includes('sessionDelete'),
    false,
    'the disk-deleting session action is gone',
  )
})

test('a corrupt stored blob falls back to all-on instead of all-off', () => {
  installStorage({ 'dsh-workspace-plus:v1': '{not json' })
  return import(`../src/client/features.ts?corrupt=${Math.random()}`).then((m) => {
    for (const key of m.FEATURE_KEYS) {
      assert.equal(m.isEnabled(key), true, `${key} survives corrupt storage`)
    }
  })
})

test('a stored partial flag set keeps unlisted features on', () => {
  installStorage({
    'dsh-workspace-plus:v1': JSON.stringify({ features: { contextmenu: false } }),
  })
  return import(`../src/client/features.ts?partial=${Math.random()}`).then((m) => {
    assert.equal(m.isEnabled('contextmenu'), false, 'the stored off wins')
    assert.equal(m.isEnabled('dblclick'), true, 'unstored features stay on')
    assert.equal(m.isEnabled('sessionFork'), true, 'unstored session features stay on')
  })
})

test('turning one switch off leaves the pin and unread lists intact', () => {
  features.setPinnedWorkspaces(['ws-1'])
  features.setUnreadSessions(['s-1'])
  features.setFeature('sessionFork', false)

  assert.equal(features.isEnabled('sessionFork'), false)
  assert.deepEqual(features.getMenuState().pinnedWorkspaces, ['ws-1'])
  assert.deepEqual(features.getMenuState().unreadSessions, ['s-1'])
})

test('toggling a switch persists across a reload', () => {
  features.setFeature('dblclick', false)
  return import(`../src/client/features.ts?reload=${Math.random()}`).then((m) => {
    assert.equal(m.isEnabled('dblclick'), false, 'the off state is reloaded')
  })
})

test('toggleId adds then removes, never duplicates', () => {
  assert.deepEqual(features.toggleId([], 'a'), ['a'])
  assert.deepEqual(features.toggleId(['a'], 'a'), [])
  assert.deepEqual(features.toggleId(['a', 'b'], 'c'), ['a', 'b', 'c'])
})

test('subscribers are notified when a feature changes', () => {
  let calls = 0
  const stop = features.subscribeMenuState(() => { calls += 1 })
  features.setFeature('sessionRename', false)
  stop()
  assert.equal(calls, 1, 'one change fires one notification')

  features.setFeature('sessionRename', true)
  assert.equal(calls, 1, 'an unsubscribed listener is not called')
})
