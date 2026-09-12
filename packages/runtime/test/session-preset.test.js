/**
 * The session-preset projection.
 *
 * 0.1.2 removed `resolveSessionPreset` from dsh-agent-presets; this module
 * reproduces the `agentPreset` projection those packages register. The
 * upstream definition (dsh-agent-presets/lib/index.js) is the contract:
 *   init:  (header) => header.agentPreset ?? null
 *   apply: (state, event) => event.type === 'agent-preset/selected'
 *            ? event.data.agentPreset : state
 *
 * These tests pin that shape — notably that the selection event carries the
 * preset under `data`, which an earlier version read from the event root and
 * silently kept a stale header value.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSessionPreset } from '../src/session-preset.ts'

/** Build a session log the way the host hands it over. */
function session(header, events = []) {
  return { header, events }
}

/** A durable `agent-preset/selected` event, as the projection expects it. */
function selectedEvent(agentPreset, seq = 1) {
  return { type: 'agent-preset/selected', seq, time: 0, data: { agentPreset } }
}

test('reads the preset from the session header', () => {
  assert.equal(resolveSessionPreset(session({ agentPreset: 'standard' })), 'standard')
})

test('yields undefined when neither header nor log names a preset', () => {
  assert.equal(resolveSessionPreset(session({})), undefined)
  assert.equal(resolveSessionPreset(session({ agentPreset: undefined }, [])), undefined)
})

test('advances the header value on an agent-preset/selected event', () => {
  const result = resolveSessionPreset(session(
    { agentPreset: 'standard' },
    [selectedEvent('minimal')],
  ))
  assert.equal(result, 'minimal')
})

test('reads the selected preset from event.data, not the event root', () => {
  // The regression: the payload is nested under `data`.
  const event = { type: 'agent-preset/selected', seq: 1, time: 0, data: { agentPreset: 'nested' } }
  assert.equal(resolveSessionPreset(session({}, [event])), 'nested')
  // A value planted at the event root must be ignored, not silently preferred.
  const planted = {
    type: 'agent-preset/selected',
    seq: 1,
    time: 0,
    agentPreset: 'root',
    data: { agentPreset: 'nested' },
  }
  assert.equal(resolveSessionPreset(session({}, [planted])), 'nested')
})

test('the last selection wins', () => {
  const result = resolveSessionPreset(session(
    { agentPreset: 'standard' },
    [selectedEvent('first', 1), selectedEvent('second', 2)],
  ))
  assert.equal(result, 'second')
})

test('ignores unrelated events and malformed selections', () => {
  const result = resolveSessionPreset(session(
    { agentPreset: 'standard' },
    [
      { type: 'user/message', seq: 1, time: 0, data: {} },
      { type: 'agent-preset/selected', seq: 2, time: 0 },
      { type: 'agent-preset/selected', seq: 3, time: 0, data: {} },
      { type: 'agent-preset/selected', seq: 4, time: 0, data: { agentPreset: 42 } },
      { type: 'assistant/message', seq: 5, time: 0, data: {} },
    ],
  ))
  assert.equal(result, 'standard')
})

test('treats an empty header preset as no preset', () => {
  assert.equal(resolveSessionPreset(session({ agentPreset: '' })), undefined)
})

test('survives a session with no iterable event log', () => {
  // The regression: Session.events is a prototype getter, so an object that is
  // not a live Session reads undefined and `for...of` throws "not iterable".
  // A missing log must degrade to the header value, never crash the caller.
  assert.doesNotThrow(() => resolveSessionPreset({ header: { agentPreset: 'standard' } }))
  assert.equal(resolveSessionPreset({ header: { agentPreset: 'standard' } }), 'standard')
  assert.equal(resolveSessionPreset({ header: {}, events: null }), undefined)
  assert.equal(resolveSessionPreset({ header: {}, events: 42 }), undefined)
  // Iterables that are not arrays still work.
  assert.equal(
    resolveSessionPreset({ header: {}, events: new Set([selectedEvent('from-set')]) }),
    'from-set',
  )
})
