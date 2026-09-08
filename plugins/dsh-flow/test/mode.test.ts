import { expect, test } from 'vitest'

import { commitFlowMode, createFlowModeStore, sessionIdOf, setFlowMode } from '../lib/mode.js'

/**
 * The mode switch is the user's control over this plugin, so its state machine
 * is the part most worth testing: a mode that turns itself on, or silently
 * fails to turn off, is worse than no mode at all.
 */

const S = 'session-1'

test('mode is off by default', () => {
  const store = createFlowModeStore()
  expect(store.isOn(S)).toBe(false)
  expect(store.get(S)).toBe(undefined)
})

test('turning on outside a turn commits immediately', () => {
  const store = createFlowModeStore()
  expect(setFlowMode(store, S, true, false)).toBe('committed')
  expect(store.isOn(S)).toBe(true)
})

test('turning off outside a turn commits immediately', () => {
  const store = createFlowModeStore()
  setFlowMode(store, S, true, false)
  // `restarted`, not `committed`: an active mode ended, which the command
  // reports differently (it also cancels running children).
  expect(setFlowMode(store, S, false, false)).toBe('restarted')
  expect(store.isOn(S)).toBe(false)
})

test('a switch during an open turn is queued, not applied', () => {
  const store = createFlowModeStore()
  expect(setFlowMode(store, S, true, true)).toBe('queued')
  // The pending target is already visible to the UI and the prompt gate…
  expect(store.isOn(S)).toBe(true)
  // …but not yet committed to the durable mode value.
  expect(store.get(S)!.active).toBe(false)
  expect(store.get(S)!.wanted).toBe(true)
})

test('a queued switch commits at the next pre-step', () => {
  const store = createFlowModeStore()
  setFlowMode(store, S, true, true)
  expect(commitFlowMode(store, S)).toBe(true)
  expect(store.get(S)!.active).toBe(true)
  expect(store.get(S)!.wanted).toBe(null)
})

test('commit is a no-op when nothing is pending', () => {
  const store = createFlowModeStore()
  expect(commitFlowMode(store, S)).toBe(false)
  setFlowMode(store, S, true, false)
  expect(commitFlowMode(store, S)).toBe(false)
})

test('repeated identical switches are no-ops', () => {
  const store = createFlowModeStore()
  setFlowMode(store, S, true, false)
  expect(setFlowMode(store, S, true, false)).toBe('noop')
  expect(setFlowMode(store, S, false, false)).toBe('restarted')
  expect(setFlowMode(store, S, false, false)).toBe('noop')
})

test('toggling back mid-turn cancels the pending switch', () => {
  const store = createFlowModeStore()
  // Off, then ask for on while a turn is open.
  setFlowMode(store, S, true, true)
  expect(store.get(S)!.wanted).toBe(true)
  // Change your mind before the boundary: the pending switch is dropped.
  expect(setFlowMode(store, S, false, true)).toBe('noop')
  expect(store.get(S)!.wanted).toBe(null)
  expect(store.isOn(S)).toBe(false)
})

test('mode state is per session', () => {
  const store = createFlowModeStore()
  setFlowMode(store, 'a', true, false)
  expect(store.isOn('a')).toBe(true)
  expect(store.isOn('b')).toBe(false)
})

test('sessionIdOf reads the conversation session, not the agent id', () => {
  expect(sessionIdOf({ session: { id: 'sess-9' } })).toBe('sess-9')
  const agentWithId = { id: 'agent-1', session: { id: 'sess-9' } }
  expect(sessionIdOf(agentWithId)).not.toBe('agent-1')
})

test('clear forgets every session', () => {
  const store = createFlowModeStore()
  setFlowMode(store, 'a', true, false)
  setFlowMode(store, 'b', true, false)
  store.clear()
  expect(store.isOn('a')).toBe(false)
  expect(store.isOn('b')).toBe(false)
})
