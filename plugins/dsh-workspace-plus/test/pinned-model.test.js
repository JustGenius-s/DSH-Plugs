/**
 * The pinned area's rows.
 *
 * Projects are nested GROUPS: a pinned project carries every session of that
 * workspace, and a session already showing inside a pinned project is not
 * repeated as a stand-alone row. Those two rules are what the panel's shape
 * depends on, and getting either wrong shows up as missing or duplicated rows
 * rather than as a crash.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildPinnedRows, hasPinnedRows } = await import('../src/client/pinned-model.ts')

const workspaces = [
  { id: 'w1', title: 'alpha', path: '/a', sessionIds: ['s1', 's2', 's3'] },
  { id: 'w2', title: 'beta', path: '/b', sessionIds: ['s4'] },
]
const sessions = {
  s1: { id: 's1', title: 'first', updatedAt: 10 },
  s2: { id: 's2', title: 'second', updatedAt: 30 },
  s3: { id: 's3', title: 'third', updatedAt: 20 },
  s4: { id: 's4', title: 'fourth', updatedAt: 5 },
}

function build(overrides = {}) {
  return buildPinnedRows({
    projectPins: [],
    workspaces,
    pinnedSessionIds: [],
    sessions,
    archivedSessionIds: [],
    ...overrides,
  })
}

test('a pinned project carries EVERY session in the workspace, not just pinned ones', () => {
  // The regression this guards: a pinned project used to show only the sessions
  // that were themselves pinned, so most of the workspace was missing.
  const rows = build({ projectPins: ['w1'] })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'workspace')
  assert.deepEqual(rows[0].sessions.map((s) => s.id).sort(), ['s1', 's2', 's3'])
})

test('sessions inside a pinned project are ordered pinned-first, then newest', () => {
  const rows = build({ projectPins: ['w1'], pinnedSessionIds: ['s3'] })
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ['s3', 's2', 's1'])
  assert.deepEqual(rows[0].sessions.map((s) => s.pinned), [true, false, false])
})

test('a session of a pinned project is NOT repeated as a stand-alone row', () => {
  const rows = build({ projectPins: ['w1'], pinnedSessionIds: ['s2'] })
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ['workspace:w1'])
  assert.equal(rows[0].sessions.find((s) => s.id === 's2').pinned, true)
})

test('a pinned session of an UNPINNED project still stands alone, with its owner', () => {
  // Its workspace is not pinned, so it has no group to nest under.
  const rows = build({ pinnedSessionIds: ['s4'] })
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ['session:s4'])
  assert.equal(rows[0].workspaceTitle, 'beta')
})

test('projects lead and stand-alone sessions follow, in Host pin order', () => {
  const rows = build({ projectPins: ['w1'], pinnedSessionIds: ['s4'] })
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ['workspace:w1', 'session:s4'])
})

test('a session outside every workspace still shows, without an owner', () => {
  const rows = build({
    pinnedSessionIds: ['s9'],
    sessions: { ...sessions, s9: { id: 's9', title: 'orphan', updatedAt: 1 } },
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].workspaceTitle, undefined)
})

test('blank and subagent sessions never appear, matching the sidebar', () => {
  // A provisional New Session is a placeholder and a subagent session is hidden
  // by the official browser; neither belongs in a pinned group.
  const rows = build({
    projectPins: ['w1'],
    sessions: {
      ...sessions,
      s1: { ...sessions.s1, blank: true },
      s2: { ...sessions.s2, subagent: true },
    },
  })
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ['s3'])
})

test('archived sessions are hidden but stay pinned', () => {
  const rows = build({ projectPins: ['w1'], archivedSessionIds: ['s1'], pinnedSessionIds: ['s1'] })
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ['s2', 's3'])
})

test('a pin whose row has not loaded is omitted, not forgotten', () => {
  // A reconnecting host must not erase the user's pin; the row simply has no
  // summary yet and reappears when the snapshot arrives.
  const rows = build({ projectPins: ['w-gone'], pinnedSessionIds: ['s-missing'] })
  assert.deepEqual(rows, [])
})

test('a project with no visible sessions still renders, so the pin is reachable', () => {
  const rows = build({
    projectPins: ['w2'],
    sessions: { s4: { ...sessions.s4, blank: true } },
  })
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].sessions, [])
})

test('the current session is marked wherever it appears', () => {
  const rows = build({ projectPins: ['w1'], currentSessionId: 's2' })
  assert.equal(rows[0].sessions.find((s) => s.id === 's2').current, true)
  assert.equal(rows[0].sessions.find((s) => s.id === 's1').current, undefined)
})

test('a duplicated id renders once', () => {
  const rows = build({ projectPins: ['w1', 'w1'], pinnedSessionIds: ['s4', 's4'] })
  assert.deepEqual(rows.map((r) => r.id), ['w1', 's4'])
})

test('ordering is stable when two sessions share a timestamp', () => {
  // Without a tie-break the two rows can swap between renders.
  const same = {
    s1: { id: 's1', title: 'a', updatedAt: 7 },
    s2: { id: 's2', title: 'b', updatedAt: 7 },
  }
  const first = build({ projectPins: ['w1'], sessions: { ...sessions, ...same } })
  const second = build({ projectPins: ['w1'], sessions: { ...sessions, ...same } })
  assert.deepEqual(first[0].sessions.map((s) => s.id), second[0].sessions.map((s) => s.id))
})

test('an empty result reports nothing to show', () => {
  assert.equal(hasPinnedRows([]), false)
  assert.equal(hasPinnedRows(build({ projectPins: ['w1'] })), true)
})

test('a stored arrangement reorders a project’s sessions over the default sort', () => {
  // The bug this pins, proved before the override existed: the default order is
  // pinned-first then newest, so dragging the PINNED session to the bottom
  // wrote the right host order and the row still snapped back to the top.
  const rows = build({
    projectPins: ['w1'],
    pinnedSessionIds: ['s3'],
    order: { 'project:w1': ['s2', 's1', 's3'] },
  })
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ['s2', 's1', 's3'])
  // `pinned` describes MEMBERSHIP (it is in the host pin set), not position, so
  // it must survive being moved down.
  assert.equal(rows[0].sessions.find((s) => s.id === 's3').pinned, true)
})

test('a stored arrangement reorders the top level across both row kinds', () => {
  // Projects and stand-alone pinned sessions share one list, so a drag can put
  // a session above a project.
  const rows = build({
    projectPins: ['w1', 'w2'],
    pinnedSessionIds: ['s4'],
    order: { top: ['session:s4', 'workspace:w2', 'workspace:w1'] },
  })
  // s4 belongs to w2, which is pinned, so it nests instead of standing alone;
  // that hides it from the top level and the remaining rows keep the stored order.
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ['workspace:w2', 'workspace:w1'])
})

test('rows a stored arrangement does not name keep the default order', () => {
  // An arrangement made earlier must survive a project being pinned later.
  const rows = build({ projectPins: ['w2', 'w1'], order: { top: ['workspace:w2'] } })
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ['workspace:w2', 'workspace:w1'])
})

test('a stored arrangement cannot resurrect a hidden session', () => {
  // The arrangement is applied AFTER `visible()` filtering, so an archived id
  // left in storage stays hidden rather than reappearing.
  const rows = build({
    projectPins: ['w1'],
    archivedSessionIds: ['s2'],
    order: { 'project:w1': ['s2', 's1', 's3'] },
  })
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ['s1', 's3'])
})
