/**
 * The plugin's pin store: WORKSPACE pins only.
 *
 * Session pins moved to DSH's own registry, so the store's job narrowed to
 * project pins plus the one-time hand-off of legacy session ids. These pin the
 * parts that would lose user data if they regressed: the atomic write, the
 * version guard, and the fact that a failed migration keeps its rows on disk.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePinAction } from '../src/pin-state.ts'
import { changeStoredPins, readStoredPins } from '../src/pin-store.ts'

const EMPTY = { initialized: false, legacySessionPins: [], workspacePins: [] }
let home
let previousHome

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-pins-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('workspace pins survive a fresh host module with their order intact', async () => {
  assert.deepEqual(readStoredPins(), EMPTY)
  changeStoredPins({ action: 'set', workspaceId: 'a', pinned: true })
  changeStoredPins({ action: 'set', workspaceId: 'b', pinned: true })
  const restarted = await import(`../src/pin-store.ts?restart=${Math.random()}`)
  assert.deepEqual(restarted.readStoredPins().workspacePins, ['b', 'a'])
  assert.deepEqual(readdirSync(join(home, 'workspace-plus')), ['pins.json'])
})

test('per-pin writes from two windows preserve each other and never duplicate', () => {
  changeStoredPins({ action: 'set', workspaceId: 'a', pinned: true })
  changeStoredPins({ action: 'set', workspaceId: 'b', pinned: true })
  changeStoredPins({ action: 'set', workspaceId: 'b', pinned: true })
  assert.deepEqual(readStoredPins().workspacePins, ['b', 'a'])
  changeStoredPins({ action: 'set', workspaceId: 'a', pinned: false })
  assert.deepEqual(readStoredPins().workspacePins, ['b'])
})

test('legacy import runs once and an explicitly empty list stays authoritative', () => {
  changeStoredPins({ action: 'import', workspacePins: ['a', 'b'] })
  changeStoredPins({ action: 'import', workspacePins: ['stale'] })
  assert.deepEqual(readStoredPins().workspacePins, ['a', 'b'])
  changeStoredPins({ action: 'set', workspaceId: 'a', pinned: false })
  changeStoredPins({ action: 'set', workspaceId: 'b', pinned: false })
  changeStoredPins({ action: 'import', workspacePins: ['a', 'b'] })
  assert.deepEqual(readStoredPins().workspacePins, [])
})

test('an empty legacy import does not initialize the store', () => {
  assert.deepEqual(changeStoredPins({ action: 'import', workspacePins: [] }), EMPTY)
  changeStoredPins({ action: 'import', workspacePins: ['a'] })
  assert.deepEqual(readStoredPins().workspacePins, ['a'])
})

test('a v1 store keeps its workspace pins and reports its session pins for migration', () => {
  mkdirSync(join(home, 'workspace-plus'))
  writeFileSync(join(home, 'workspace-plus', 'pins.json'), JSON.stringify({
    version: 1,
    pins: [
      { kind: 'session', id: 'session-x', workspaceId: 'a' },
      { kind: 'workspace', id: 'a' },
      { kind: 'session', id: 'session-y', workspaceId: 'a' },
    ],
  }))
  const snapshot = readStoredPins()
  assert.deepEqual(snapshot.workspacePins, ['a'])
  assert.deepEqual(snapshot.legacySessionPins, ['session-x', 'session-y'])
})

test('clearing the legacy rows removes only those, keeping workspace pins', () => {
  mkdirSync(join(home, 'workspace-plus'))
  writeFileSync(join(home, 'workspace-plus', 'pins.json'), JSON.stringify({
    version: 1,
    pins: [{ kind: 'session', id: 's', workspaceId: 'a' }, { kind: 'workspace', id: 'a' }],
  }))
  const after = changeStoredPins({ action: 'clearLegacySessions' })
  assert.deepEqual(after.legacySessionPins, [])
  assert.deepEqual(after.workspacePins, ['a'])
  assert.deepEqual(readStoredPins().legacySessionPins, [])
})

test('a migration that has not finished keeps its rows on disk', () => {
  // The client clears the legacy rows only after DSH accepted every pin, so an
  // unrelated write in between must not drop them.
  mkdirSync(join(home, 'workspace-plus'))
  writeFileSync(join(home, 'workspace-plus', 'pins.json'), JSON.stringify({
    version: 1,
    pins: [{ kind: 'session', id: 's', workspaceId: 'a' }],
  }))
  changeStoredPins({ action: 'set', workspaceId: 'b', pinned: true })
  const snapshot = readStoredPins()
  assert.deepEqual(snapshot.legacySessionPins, ['s'])
  assert.deepEqual(snapshot.workspacePins, ['b'])
})

test('broken, unknown-version, or non-object disk data is reported and never overwritten', () => {
  mkdirSync(join(home, 'workspace-plus'))
  const file = join(home, 'workspace-plus', 'pins.json')
  for (const raw of ['{broken', 'null', '{"version":2,"pins":[]}']) {
    writeFileSync(file, raw)
    assert.throws(() => readStoredPins())
    assert.throws(() => changeStoredPins({ action: 'set', workspaceId: 'a', pinned: true }))
    assert.equal(readFileSync(file, 'utf8'), raw)
  }
})

test('pin storage follows DSH_HOME without leaking between profiles', () => {
  changeStoredPins({ action: 'set', workspaceId: 'a', pinned: true })
  process.env.DSH_HOME = join(home, 'other-home')
  assert.deepEqual(readStoredPins(), EMPTY)
})

test('write validation rejects malformed bodies instead of clearing the store', () => {
  for (const body of [
    null, {}, { workspacePins: [] }, { action: 'set', workspaceId: 'a' },
    { action: 'set', workspaceId: 'a', pinned: 'false' },
    { action: 'set', workspaceId: '', pinned: true },
    { action: 'import' }, { action: 'import', workspacePins: 'a' },
  ]) assert.equal(parsePinAction(body), undefined)

  assert.deepEqual(parsePinAction({ action: 'set', workspaceId: 'a', pinned: false }), {
    action: 'set', workspaceId: 'a', pinned: false,
  })
  assert.deepEqual(parsePinAction({ action: 'import', workspacePins: ['a', 'a', 'b'] }), {
    action: 'import', workspacePins: ['a', 'b'],
  })
  assert.deepEqual(parsePinAction({ action: 'clearLegacySessions' }), { action: 'clearLegacySessions' })
})
