import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePinAction } from '../src/pin-state.ts'
import { changeStoredPins, readStoredPins } from '../src/pin-store.ts'

const workspace = { kind: 'workspace', id: 'workspace-a' }
const session = { kind: 'session', id: 'session-a', workspaceId: workspace.id }
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

test('workspace and session pins survive a fresh host module with their order intact', async () => {
  assert.deepEqual(readStoredPins(), { initialized: false, pins: [] })
  changeStoredPins({ action: 'set', pin: workspace, pinned: true })
  changeStoredPins({ action: 'set', pin: session, pinned: true })
  const restarted = await import(`../src/pin-store.ts?restart=${Math.random()}`)
  assert.deepEqual(restarted.readStoredPins(), { initialized: true, pins: [session, workspace] })
  assert.deepEqual(readdirSync(join(home, 'workspace-plus')), ['pins.json'])
})

test('per-pin operations from two windows preserve each other and do not duplicate pins', () => {
  changeStoredPins({ action: 'set', pin: workspace, pinned: true })
  changeStoredPins({ action: 'set', pin: session, pinned: true })
  changeStoredPins({ action: 'set', pin: session, pinned: true })
  assert.deepEqual(readStoredPins().pins, [session, workspace])
  changeStoredPins({ action: 'set', pin: workspace, pinned: false })
  assert.deepEqual(readStoredPins().pins, [session])
})

test('legacy import runs once and an explicitly empty pin list stays authoritative', () => {
  changeStoredPins({ action: 'import', pins: [workspace, session] })
  changeStoredPins({ action: 'import', pins: [{ kind: 'workspace', id: 'stale' }] })
  assert.deepEqual(readStoredPins().pins, [workspace, session])
  changeStoredPins({ action: 'set', pin: workspace, pinned: false })
  changeStoredPins({ action: 'set', pin: session, pinned: false })
  changeStoredPins({ action: 'import', pins: [workspace, session] })
  assert.deepEqual(readStoredPins(), { initialized: true, pins: [] })
})

test('an empty new origin does not prevent a later legacy import', () => {
  assert.deepEqual(changeStoredPins({ action: 'import', pins: [] }), { initialized: false, pins: [] })
  changeStoredPins({ action: 'import', pins: [workspace] })
  assert.deepEqual(readStoredPins().pins, [workspace])
})

test('removing an absent pin records the explicit empty state', () => {
  changeStoredPins({ action: 'set', pin: workspace, pinned: false })
  changeStoredPins({ action: 'import', pins: [workspace] })
  assert.deepEqual(readStoredPins(), { initialized: true, pins: [] })
})

test('broken or unsupported disk data is reported and never overwritten with defaults', () => {
  mkdirSync(join(home, 'workspace-plus'))
  const file = join(home, 'workspace-plus', 'pins.json')
  for (const raw of ['{broken', 'null', '{"version":2,"pins":[]}', '{"version":1,"pins":[null]}']) {
    writeFileSync(file, raw)
    assert.throws(() => readStoredPins())
    assert.throws(() => changeStoredPins({ action: 'set', pin: workspace, pinned: true }))
    assert.equal(readFileSync(file, 'utf8'), raw)
  }
})

test('pin storage follows DSH_HOME without leaking between profiles', () => {
  changeStoredPins({ action: 'set', pin: workspace, pinned: true })
  process.env.DSH_HOME = join(home, 'other-home')
  assert.deepEqual(readStoredPins(), { initialized: false, pins: [] })
})

test('write validation rejects malformed and snapshot-replacement requests', () => {
  for (const body of [
    null, {}, { pins: [] }, { action: 'set', pin: workspace },
    { action: 'set', pin: workspace, pinned: 'false' },
    { action: 'set', pin: { kind: 'session', id: 's' }, pinned: true },
    { action: 'import', pins: [null] }, { action: 'import', pins: [{ kind: 'workspace', id: '' }] },
  ]) assert.equal(parsePinAction(body), undefined)
  assert.deepEqual(parsePinAction({ action: 'import', pins: [workspace, workspace] }), { action: 'import', pins: [workspace] })
  assert.deepEqual(parsePinAction({ action: 'set', pin: session, pinned: false }), { action: 'set', pin: session, pinned: false })
})
