import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applySessionTitleFacts,
  titleRepairLookups,
} from '../src/client/session-title-repair.ts'

function state(overrides = {}) {
  return {
    ids: ['s-1', 's-2', 's-3'],
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    byId: {
      's-1': { id: 's-1', displayTitle: 'project', cwd: '/project', running: false, blank: false, updatedAt: 10 },
      's-2': { id: 's-2', title: 'Native', displayTitle: 'Native', cwd: '/project', running: false, blank: false, updatedAt: 20 },
      's-3': { id: 's-3', displayTitle: 'child', cwd: '/project', origin: 'subagent', running: false, blank: false, updatedAt: 30 },
    },
    ...overrides,
  }
}

test('only ordinary sessions missing a durable title are requested', () => {
  assert.deepEqual(titleRepairLookups(state()), [
    { id: 's-1', cwd: '/project', updatedAt: 10, listedBlank: false },
  ])
})

test('an event title repairs title, display title and stale blank metadata', () => {
  const repaired = applySessionTitleFacts(state(), new Map([['s-1', {
    id: 's-1',
    cwd: '/project',
    updatedAt: 10,
    listedBlank: false,
    blank: true,
    title: 'Recovered title',
    source: 'event',
  }]]))
  assert.equal(repaired.byId['s-1'].title, 'Recovered title')
  assert.equal(repaired.byId['s-1'].displayTitle, 'Recovered title')
  assert.equal(repaired.byId['s-1'].blank, true)
})

test('a derived fallback changes presentation without claiming a durable title', () => {
  const repaired = applySessionTitleFacts(state(), new Map([['s-1', {
    id: 's-1',
    cwd: '/project',
    updatedAt: 10,
    listedBlank: false,
    blank: false,
    title: 'Derived title',
    source: 'fallback',
  }]]))
  assert.equal(repaired.byId['s-1'].title, undefined)
  assert.equal(repaired.byId['s-1'].displayTitle, 'Derived title')
})

test('a stale title response cannot overwrite a newer list row', () => {
  const original = state()
  assert.equal(applySessionTitleFacts(original, new Map([['s-1', {
    id: 's-1', cwd: '/project', updatedAt: 9, listedBlank: false, blank: true, title: 'Old', source: 'event',
  }]])), original)
})

test('a response from before the blank-state transition is ignored', () => {
  const original = state()
  assert.equal(applySessionTitleFacts(original, new Map([['s-1', {
    id: 's-1', cwd: '/project', updatedAt: 10, listedBlank: true, blank: true,
  }]])), original)
})
