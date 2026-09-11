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
  delete globalThis.window
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

test('legacy string session pins migrate into shortcut records', () => {
  installStorage({
    'dsh-workspace-plus:v1': JSON.stringify({ pinnedSessions: ['s-1'] }),
  })
  return import(`../src/client/features.ts?pins=${Math.random()}`).then((m) => {
    assert.deepEqual(m.getMenuState().pins, [{ kind: 'session', workspaceId: '', id: 's-1' }])
  })
})

test('turning one switch off leaves the pin and unread lists intact', () => {
  features.setPin({ kind: 'workspace', id: 'ws-1' }, true)
  features.setUnreadSessions(['s-1'])
  features.setFeature('sessionFork', false)

  assert.equal(features.isEnabled('sessionFork'), false)
  assert.deepEqual(features.getMenuState().pins, [{ kind: 'workspace', id: 'ws-1' }])
  assert.deepEqual(features.getMenuState().unreadSessions, ['s-1'])
})

test('mixed pins persist newest-first and unpinning affects only the requested entry', async () => {
  const workspace = { kind: 'workspace', id: 'ws-1' }
  const session = { kind: 'session', id: 's-1', workspaceId: 'ws-1' }
  features.setFeature('sessionFork', false)
  features.setUnreadSessions(['s-other'])
  features.setPin(workspace, true)
  features.setPin(session, true)
  const reloaded = await import(`../src/client/features.ts?ordered=${Math.random()}`)
  assert.deepEqual(reloaded.getMenuState().pins, [session, workspace])
  reloaded.setPin(workspace, false)
  const after = await import(`../src/client/features.ts?unpinned=${Math.random()}`)
  assert.deepEqual(after.getMenuState().pins, [session])
  assert.deepEqual(after.getMenuState().unreadSessions, ['s-other'])
  assert.equal(after.isEnabled('sessionFork'), false)
})

test('pin state changes notify subscribers for pin and unpin, without any host service', () => {
  let notified = 0
  const stop = features.subscribeMenuState(() => { notified += 1 })
  features.setPin({ kind: 'workspace', id: 'ws-1' }, true)
  features.setPin({ kind: 'workspace', id: 'ws-1' }, false)
  stop()
  assert.equal(notified, 2)
  assert.deepEqual(features.getMenuState().pins, [])
})

test('storage events synchronize pins across windows and disposal removes the listener', () => {
  let storageListener
  globalThis.window = {
    addEventListener: (name, listener) => {
      assert.equal(name, 'storage')
      storageListener = listener
    },
    removeEventListener: (name, listener) => {
      assert.equal(name, 'storage')
      assert.equal(listener, storageListener)
      storageListener = undefined
    },
  }
  let notified = 0
  const stopSubscription = features.subscribeMenuState(() => { notified += 1 })
  const stopStorage = features.listenForMenuStateChanges()
  const pins = [{ kind: 'workspace', id: 'other-window' }]
  localStorage.setItem(features.STORAGE_KEY, JSON.stringify({ version: 2, pins }))
  storageListener({ key: 'unrelated-key', storageArea: localStorage })
  assert.deepEqual(features.getMenuState().pins, [])
  storageListener({ key: features.STORAGE_KEY, storageArea: localStorage })
  assert.deepEqual(features.getMenuState().pins, pins)
  localStorage.clear()
  storageListener({ key: null, storageArea: localStorage })
  assert.deepEqual(features.getMenuState().pins, [])
  assert.equal(notified, 2)
  stopStorage()
  stopSubscription()
  assert.equal(storageListener, undefined)
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

test('host hydration restores pins while preserving local feature and unread preferences', async (t) => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  const pins = [{ kind: 'workspace', id: 'restored' }]
  let finish
  const restored = new Promise((resolve) => { finish = resolve })
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/dsh-workspace-plus/pins')
    assert.equal(init.method, 'GET')
    return { json: async () => ({ ok: true, value: { initialized: true, pins } }) }
  }
  features.setFeature('sessionFork', false)
  features.setUnreadSessions(['unread'])
  const unsubscribe = features.subscribeMenuState(() => {
    if (features.getMenuState().pins[0]?.id === 'restored') finish()
  })
  const dispose = features.installPinPersistence()
  t.after(dispose)
  t.after(unsubscribe)
  await restored
  assert.deepEqual(features.getMenuState().pins, pins)
  assert.deepEqual(features.getMenuState().unreadSessions, ['unread'])
  assert.equal(features.isEnabled('sessionFork'), false)
  assert.deepEqual(JSON.parse(localStorage.getItem(features.STORAGE_KEY)).pins, pins)
})

test('pin actions are acknowledged only after the keepalive host write completes', async (t) => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  const pin = { kind: 'workspace', id: 'saved' }
  const writes = []
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/dsh-workspace-plus/pins')
    if (init.method === 'GET') return { json: async () => ({ ok: true, value: { initialized: false, pins: [] } }) }
    assert.equal(init.keepalive, true)
    writes.push(JSON.parse(init.body))
    return { json: async () => ({ ok: true, value: { initialized: true, pins: [pin] } }) }
  }
  const dispose = features.installPinPersistence()
  t.after(dispose)
  await features.setPin(pin, true)
  assert.deepEqual(writes, [{ action: 'set', pin, pinned: true }])
  assert.deepEqual(features.getMenuState().pins, [pin])
})
