import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSessionTitleFacts, sessionTitleFactFromEvents } from '../src/session-titles.ts'

const lookup = { id: 's-1', cwd: '/project', updatedAt: 10, listedBlank: false }

function event(seq, type, data = {}) {
  return { seq, time: seq, type, data }
}

test('the latest durable session title wins', () => {
  const fact = sessionTitleFactFromEvents(lookup, [
    event(0, 'turn/start'),
    event(1, 'session/title', { title: 'First' }),
    event(2, 'session/title', { title: 'Latest' }),
  ])
  assert.deepEqual(fact, { ...lookup, blank: false, title: 'Latest', source: 'event' })
})

test('legacy sessions derive the official bounded fallback from the first user message', () => {
  const fact = sessionTitleFactFromEvents(lookup, [
    event(0, 'turn/start'),
    event(1, 'user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Fix the broken workspace title now please' }],
    }),
  ])
  assert.equal(fact.title, 'Fix the broken workspace title')
  assert.equal(fact.source, 'fallback')
})

test('an untouched session remains blank and receives no fake title', () => {
  assert.deepEqual(sessionTitleFactFromEvents(lookup, []), { ...lookup, blank: true })
})

test('plugin context messages do not become a user-facing title', () => {
  const fact = sessionTitleFactFromEvents(lookup, [
    event(0, 'user/message', {
      source: { kind: 'plugin' },
      content: [{ type: 'text', text: 'internal context' }],
    }),
  ])
  assert.equal(fact.title, undefined)
})

test('cold title lookup validates cwd before inspecting the persisted log', async () => {
  let inspections = 0
  const ctx = {
    sessions: { get: () => undefined },
    sessionPersistence: {
      list: async () => [
        { version: 1, id: 's-1', createdAt: 1, cwd: '/old', isSeeded: false },
        { version: 1, id: 's-1', createdAt: 2, cwd: '/project', isSeeded: false },
      ],
      inspect: async () => {
        inspections += 1
        return {
          meta: { version: 1, id: 's-1', createdAt: 2, cwd: '/project', isSeeded: false },
          events: [event(0, 'session/title', { title: 'Persisted' })],
        }
      },
    },
  }
  const facts = await resolveSessionTitleFacts(ctx, [lookup])
  assert.equal(inspections, 1)
  assert.equal(facts[0]?.title, 'Persisted')
})

test('ambiguous cold ids without a matching cwd are skipped', async () => {
  const ctx = {
    sessions: { get: () => undefined },
    sessionPersistence: {
      list: async () => [
        { version: 1, id: 's-1', createdAt: 1, cwd: '/one', isSeeded: false },
        { version: 1, id: 's-1', createdAt: 2, cwd: '/two', isSeeded: false },
      ],
      inspect: async () => { throw new Error('must not inspect an ambiguous id') },
    },
  }
  assert.deepEqual(await resolveSessionTitleFacts(ctx, [{ id: 's-1', updatedAt: 1, listedBlank: false }]), [])
})
