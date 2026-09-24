/**
 * Defensive session-log access.
 *
 * Both the legacy `events` getter and the current `snapshotEvents()` API must
 * expose a session's log to consumers without depending on its package copy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionEventsOf } from '../src/session-events.ts'

test('returns the log as-is when it is an array', () => {
  const log = [{ type: 'user/message' }]
  assert.equal(sessionEventsOf({ events: log }), log)
})

test('reads current DSH sessions through snapshotEvents', () => {
  const log = [{ type: 'assistant/message', data: { usage: { inputTokens: 7, outputTokens: 3 } } }]
  const session = { snapshotEvents: () => log }
  assert.equal(sessionEventsOf(session), log)
  log.push({ type: 'assistant/message', data: { usage: { inputTokens: 2, outputTokens: 1 } } })
  assert.equal(sessionEventsOf(session).length, 2)
})

test('degrades a missing log to an empty array', () => {
  assert.deepEqual(sessionEventsOf({}), [])
  assert.deepEqual(sessionEventsOf({ events: undefined }), [])
  assert.deepEqual(sessionEventsOf({ events: null }), [])
  assert.deepEqual(sessionEventsOf(undefined), [])
  assert.deepEqual(sessionEventsOf(null), [])
})

test('degrades a non-iterable log to an empty array', () => {
  // The regression: these all threw "events is not iterable" before.
  assert.deepEqual(sessionEventsOf({ events: 42 }), [])
  assert.deepEqual(sessionEventsOf({ events: 'turn/start' }), [])
  assert.deepEqual(sessionEventsOf({ events: {} }), [])
  assert.deepEqual(sessionEventsOf({ events: { length: 1 } }), [])
})

test('materializes non-array iterables', () => {
  const set = new Set([{ type: 'turn/start' }])
  const result = sessionEventsOf({ events: set })
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 1)
  // A generator is iterable but not an array; it must still be accepted.
  function* gen() { yield { type: 'turn/end' } }
  assert.deepEqual(sessionEventsOf({ events: gen() }), [{ type: 'turn/end' }])
})

test('an empty log stays empty rather than becoming undefined', () => {
  assert.deepEqual(sessionEventsOf({ events: [] }), [])
})
