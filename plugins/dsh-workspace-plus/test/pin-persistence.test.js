/**
 * Client pin persistence and the legacy session-pin migration.
 *
 * The migration is the one operation in this plugin that can LOSE user data, so
 * these cover it directly: rows are handed to DSH one at a time, the old
 * records are cleared only after every one was accepted, and an interrupted run
 * leaves them on disk for the next attempt.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPinPersistence } from '../src/client/pin-persistence.ts'
import { changeStoredPins, readStoredPins } from '../src/pin-store.ts'

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

/** Write a v1 store holding session pins, as an older plugin version left it. */
function seedLegacyPins(sessionIds) {
  mkdirSync(join(home, 'workspace-plus'))
  writeFileSync(join(home, 'workspace-plus', 'pins.json'), JSON.stringify({
    version: 1,
    pins: sessionIds.map((id) => ({ kind: 'session', id, workspaceId: 'w' })),
  }))
}

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-pins-'))
  process.env.DSH_HOME = home
  clients = []
})

afterEach(() => {
  for (const sync of clients) sync.dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('a cold client restores the host project pins', async () => {
  changeStoredPins({ action: 'set', workspaceId: 'w1', pinned: true })
  changeStoredPins({ action: 'set', workspaceId: 'w2', pinned: true })
  const cold = client([])
  await cold.flush()
  assert.deepEqual(cold.snapshot(), ['w2', 'w1'])
})

test('legacy session pins are handed to DSH, then cleared from disk', async () => {
  seedLegacyPins(['s1', 's2'])
  const adopted = []
  const sync = client([], { adoptSessionPin: async (id) => { adopted.push(id) } })
  await sync.flush()
  assert.deepEqual(adopted, ['s1', 's2'])
  const after = readStoredPins()
  assert.deepEqual(after.legacySessionPins, [])
  assert.deepEqual(after.workspacePins, [])
})

test('an interrupted migration keeps the un-adopted rows for the next attempt', async () => {
  seedLegacyPins(['s1', 's2'])
  const sync = client([], {
    adoptSessionPin: async (id) => {
      if (id === 's2') throw new Error('host rejected the pin')
    },
  })
  await assert.rejects(() => sync.flush())
  // The first pin was accepted, the second was not, so the store must NOT have
  // been cleared — otherwise s2 would be lost with nothing holding it.
  assert.deepEqual(readStoredPins().legacySessionPins, ['s1', 's2'])
})

test('a migration without an adopter leaves the rows alone', async () => {
  // A host whose DSH lacks pinning must not silently drop the user's pins.
  seedLegacyPins(['s1'])
  const sync = client([])
  await sync.flush()
  assert.deepEqual(readStoredPins().legacySessionPins, ['s1'])
})

test('a cold client adopts legacy browser pins once', async () => {
  const first = client(['w1'])
  await first.flush()
  assert.deepEqual(readStoredPins().workspacePins, ['w1'])
  // A later window with a stale cache must not overwrite durable state.
  const second = client(['stale'])
  await second.flush()
  assert.deepEqual(second.snapshot(), ['w1'])
  assert.deepEqual(readStoredPins().workspacePins, ['w1'])
})

test('queued writes survive a failure and replay in order', async () => {
  let failNext = true
  const sync = client([], {
    transport: {
      load: async () => readStoredPins(),
      change: async (action) => {
        if (failNext && action.action !== 'import') {
          failNext = false
          throw new Error('transient')
        }
        return changeStoredPins(action)
      },
    },
  })
  const first = sync.set('w1', true)
  await assert.rejects(() => first)
  // The write stays queued; the retry timer is what eventually lands it.
  await sync.set('w2', true).catch(() => undefined)
  assert.deepEqual(sync.snapshot(), ['w2', 'w1'])
})

test('a disposed client stops writing', async () => {
  const sync = client([])
  sync.dispose()
  await sync.set('w1', true)
  assert.deepEqual(readStoredPins().workspacePins, [])
})
