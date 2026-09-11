import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPinPersistence } from '../src/client/pin-persistence.ts'
import { changeStoredPins, readStoredPins } from '../src/pin-store.ts'

const workspace = { kind: 'workspace', id: 'workspace-a' }
const session = { kind: 'session', id: 'session-a', workspaceId: workspace.id }
let home
let previousHome
let clients

const transport = {
  load: async () => readStoredPins(),
  change: async (action) => changeStoredPins(action),
}

function client(initial = [], extra = {}) {
  let pins = initial
  const states = []
  const sync = createPinPersistence({
    initial,
    apply: (next) => { pins = next; states.push(next) },
    transport,
    retryMs: 60_000,
    ...extra,
  })
  clients.push(sync)
  return { ...sync, snapshot: () => pins, states }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-pin-sync-'))
  process.env.DSH_HOME = home
  clients = []
})

afterEach(() => {
  for (const sync of clients) sync.dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('a cold client on a different origin restores pins with empty localStorage', async () => {
  const oldOrigin = client([workspace, session])
  await oldOrigin.flush()
  oldOrigin.dispose()
  const newOrigin = client([])
  await newOrigin.flush()
  assert.deepEqual(newOrigin.snapshot(), [workspace, session])
  assert.deepEqual(readStoredPins().pins, [workspace, session])
})

test('stale localStorage cannot revive a pin explicitly removed on disk', async () => {
  changeStoredPins({ action: 'set', pin: workspace, pinned: false })
  const sync = client([workspace])
  await sync.flush()
  assert.deepEqual(sync.snapshot(), [])
  assert.deepEqual(readStoredPins().pins, [])
})

test('cold startup never writes the empty local default over host pins', async () => {
  let changes = 0
  const sync = client([], { transport: {
    load: async () => ({ initialized: true, pins: [workspace, session] }),
    change: async () => { changes += 1; throw new Error('unexpected write') },
  } })
  await sync.flush()
  assert.equal(changes, 0)
  assert.deepEqual(sync.snapshot(), [workspace, session])
})

test('pin and unpin during hydration are replayed over the restored list', async () => {
  changeStoredPins({ action: 'import', pins: [workspace, session] })
  const loading = deferred()
  const sync = client([], { transport: { ...transport, load: () => loading.promise } })
  const ready = sync.flush()
  const removed = sync.set(workspace, false)
  const added = { kind: 'workspace', id: 'new-workspace' }
  const adding = sync.set(added, true)
  loading.resolve(readStoredPins())
  await Promise.all([ready, removed, adding])
  assert.deepEqual(sync.snapshot(), [added, session])
  assert.deepEqual(readStoredPins().pins, [added, session])
  assert.ok(sync.states.every((pins) => !pins.some((pin) => pin.id === workspace.id)))
})

test('a delayed save response cannot erase a newer optimistic pin action', async () => {
  const saving = deferred()
  let first = true
  const sync = client([], { transport: {
    ...transport,
    change: async (action) => {
      const result = changeStoredPins(action)
      if (first) { first = false; await saving.promise }
      return result
    },
  } })
  await sync.flush()
  const addingWorkspace = sync.set(workspace, true)
  const addingSession = sync.set(session, true)
  const removingWorkspace = sync.set(workspace, false)
  saving.resolve()
  await Promise.all([addingWorkspace, addingSession, removingWorkspace])
  assert.deepEqual(sync.snapshot(), [session])
  assert.deepEqual(readStoredPins().pins, [session])
})

test('two clients send operations without overwriting each others pins', async () => {
  const first = client()
  const second = client()
  await Promise.all([first.flush(), second.flush()])
  await Promise.all([first.set(workspace, true), second.set(session, true)])
  assert.deepEqual(readStoredPins().pins, [session, workspace])
  await first.set(workspace, false)
  assert.deepEqual(readStoredPins().pins, [session])
})

test('a failed hydration retains local pins and retries before importing or saving', async () => {
  let offline = true
  let changes = 0
  const sync = client([workspace], { transport: {
    load: async () => {
      if (offline) throw new Error('offline')
      return readStoredPins()
    },
    change: async (action) => { changes += 1; return changeStoredPins(action) },
  } })
  await assert.rejects(sync.set(session, true), /offline/)
  assert.equal(changes, 0)
  assert.deepEqual(sync.snapshot(), [workspace])
  offline = false
  await sync.flush()
  assert.deepEqual(readStoredPins().pins, [session, workspace])
})

test('a write failure is observable and retains the operation for retry', async () => {
  let failing = true
  const sync = client([], { transport: {
    ...transport,
    change: async (action) => {
      if (failing) throw new Error('disk full')
      return changeStoredPins(action)
    },
  } })
  await sync.flush()
  await assert.rejects(sync.set(workspace, true), /disk full/)
  assert.deepEqual(readStoredPins().pins, [])
  failing = false
  await sync.flush()
  assert.deepEqual(readStoredPins().pins, [workspace])
})

test('failed saves automatically retry while the plugin remains active', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let failing = true
  const sync = client([], { retryMs: 1000, transport: {
    ...transport,
    change: async (action) => {
      if (failing) throw new Error('offline')
      return changeStoredPins(action)
    },
  } })
  await sync.flush()
  await assert.rejects(sync.set(session, true), /offline/)
  failing = false
  t.mock.timers.tick(1000)
  await sync.flush()
  assert.deepEqual(readStoredPins().pins, [session])
})

test('disposing a loading plugin stops late hydration and migration', async () => {
  const loading = deferred()
  let changes = 0
  const sync = client([workspace], { transport: {
    load: () => loading.promise,
    change: async () => { changes += 1; throw new Error('unexpected write') },
  } })
  const ready = sync.flush()
  sync.dispose()
  loading.resolve({ initialized: false, pins: [] })
  await ready
  assert.equal(changes, 0)
  assert.deepEqual(sync.states, [])
})
