import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isPinned, pinKey, pinLayout, pinnedItems, readPins, updatePin } from '../src/client/pins.ts'

const workspaces = Object.freeze([
  Object.freeze({ workspaceId: 'a', title: 'Alpha', path: '/a', sessionIds: Object.freeze(['a1', 'a2']) }),
  Object.freeze({ workspaceId: 'b', title: 'Beta', path: '/b', sessionIds: Object.freeze(['b1']) }),
  Object.freeze({ workspaceId: 'c', title: 'Gamma', path: '/c', sessionIds: Object.freeze([]) }),
])
const session = (id, title, extra = {}) => Object.freeze({
  id, title, displayTitle: title, updatedAt: 1, blank: false, running: false, ...extra,
})
const sessions = Object.freeze({
  a1: session('a1', 'First task'),
  a2: session('a2', 'Second task'),
  b1: session('b1', 'Third task'),
})
const project = (id) => ({ kind: 'workspace', id })
const chat = (id, workspaceId = 'a') => ({ kind: 'session', id, workspaceId })
const section = (pins) => pinnedItems(pins, workspaces, sessions, [])

function displayedProjects(pins) {
  const layout = pinLayout(section(pins))
  const order = new Map(layout.entries.map(({ item, order }) => [pinKey(item.pin), order]))
  return workspaces.map((workspace) => workspace.workspaceId)
    .sort((a, b) => (order.get(`workspace:${a}`) ?? 0) - (order.get(`workspace:${b}`) ?? 0))
}

test('later project pins lead and unpinning restores the unchanged source position', () => {
  let pins = updatePin([], project('b'), true)
  assert.deepEqual(displayedProjects(pins), ['b', 'a', 'c'])
  pins = updatePin(pins, project('c'), true)
  assert.deepEqual(displayedProjects(pins), ['c', 'b', 'a'])
  pins = updatePin(pins, project('b'), false)
  assert.deepEqual(displayedProjects(pins), ['c', 'a', 'b'])
  pins = updatePin(pins, project('c'), false)
  assert.deepEqual(displayedProjects(pins), ['a', 'b', 'c'])
  assert.deepEqual(workspaces.map((workspace) => workspace.workspaceId), ['a', 'b', 'c'])
})

test('unpinning projects in the opposite order still restores their original positions', () => {
  let pins = updatePin(updatePin([], project('b'), true), project('c'), true)
  pins = updatePin(pins, project('c'), false)
  assert.deepEqual(displayedProjects(pins), ['b', 'a', 'c'])
  pins = updatePin(pins, project('b'), false)
  assert.deepEqual(displayedProjects(pins), ['a', 'b', 'c'])
})

test('mixed pins share one newest-first section, independent of activity and titles', () => {
  let pins = updatePin([], project('b'), true)
  pins = updatePin(pins, chat('a1'), true)
  pins = updatePin(pins, project('a'), true)
  assert.deepEqual(section(pins).map((item) => pinKey(item.pin)), ['workspace:a', 'session:a1', 'workspace:b'])
  const changed = { ...sessions, a1: session('a1', 'Renamed', { updatedAt: 999, running: true }) }
  assert.deepEqual(pinnedItems(pins, workspaces, changed, []).map((item) => pinKey(item.pin)),
    ['workspace:a', 'session:a1', 'workspace:b'])
})

test('a session shortcut carries the workspace name without leaving its original list', () => {
  const pins = updatePin([], chat('a2'), true)
  const [item] = section(pins)
  assert.equal(item.workspace.title, 'Alpha')
  assert.equal(item.session, sessions.a2)
  assert.deepEqual(workspaces[0].sessionIds, ['a1', 'a2'])
  assert.equal(section(updatePin(pins, chat('a2'), false)).length, 0)
  assert.deepEqual(workspaces[0].sessionIds, ['a1', 'a2'])
})

test('pinning a project and its session keeps both entries and the nested session', () => {
  const pins = updatePin(updatePin([], project('a'), true), chat('a1'), true)
  const items = section(pins)
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'session')
  assert.equal(items[1].kind, 'workspace')
  assert.equal(items[1].workspace.sessionIds.includes('a1'), true)
})

test('re-pinning moves an entry to the front without duplicating it', () => {
  const pins = updatePin(updatePin(updatePin([], project('a'), true), project('b'), true), project('a'), true)
  assert.deepEqual(pins, [project('a'), project('b')])
})

test('a session id identifies the pin after a workspace move', () => {
  const pins = updatePin([chat('a1', 'old')], chat('a1', 'a'), true)
  assert.deepEqual(pins, [chat('a1', 'a')])
  assert.equal(isPinned(pins, chat('a1', 'different')), true)
  assert.equal(section([chat('a1', 'old')])[0].workspace.title, 'Alpha')
})

test('workspace and session identities do not collide', () => {
  const pins = updatePin([project('a')], chat('a'), true)
  assert.equal(pins.length, 2)
  assert.deepEqual(updatePin(pins, chat('a'), false), [project('a')])
})

test('missing, archived, blank and subagent sessions are not rendered or destructively pruned', () => {
  const pins = [chat('a1'), chat('a2'), chat('b1', 'b'), chat('missing'), project('gone')]
  const current = { ...sessions, a2: session('a2', '', { blank: true }), b1: session('b1', 'Child', { origin: 'subagent' }) }
  assert.deepEqual(pinnedItems(pins, workspaces, current, ['a1']), [])
  assert.equal(pins.length, 5)
  assert.equal(section(pins).length, 3)
})

test('removing a workspace leaves its still-listed shortcut available for unpinning', () => {
  const items = pinnedItems([chat('a1')], [], sessions, [])
  assert.equal(items.length, 1)
  assert.equal(items[0].workspace, undefined)
})

test('workspace renames update shortcut labels by identity', () => {
  const changed = workspaces.map((workspace) => workspace.workspaceId === 'a' ? { ...workspace, title: 'Renamed Alpha' } : workspace)
  assert.equal(pinnedItems([chat('a1')], changed, sessions, [])[0].workspace.title, 'Renamed Alpha')
})

test('the section header, entries and divider all precede ordinary order zero', () => {
  const layout = pinLayout(section([chat('a1'), project('b')]))
  assert.ok(layout.headerOrder < layout.entries[0].order)
  assert.ok(layout.entries[0].order < layout.entries[1].order)
  assert.ok(layout.entries[1].order < layout.dividerOrder)
  assert.ok(layout.dividerOrder < 0)
  assert.deepEqual(pinLayout([]).entries, [])
})

test('newest-first ordering survives serialization and legacy arrays cannot revive removed pins', () => {
  const pins = [chat('a1'), project('b'), project('a')]
  assert.deepEqual(readPins(JSON.parse(JSON.stringify({ pins }))), pins)
  assert.deepEqual(readPins({ pins: [], pinnedWorkspaces: ['a'], pinnedSessions: ['a1'] }), [])
})

test('legacy project and scoped session pins migrate deterministically without mutating the input', () => {
  const old = { pinnedWorkspaces: ['a', 'b'], pinnedSessions: ['a1', { workspaceId: 'b', sessionId: 'b1' }] }
  assert.deepEqual(readPins(old), [project('b'), project('a'), chat('b1', 'b'), chat('a1', '')])
  assert.deepEqual(old.pinnedWorkspaces, ['a', 'b'])
  assert.deepEqual(readPins({ pinnedSessions: [{ workspaceId: '', sessionId: 'a1' }] }), [chat('a1', '')])
})

test('malformed and duplicate persisted pins are ignored', () => {
  assert.deepEqual(readPins({ pins: [null, {}, 4, { kind: 'workspace', id: '' }, project('a'), project('a'), chat('a1')] }),
    [project('a'), chat('a1')])
})
