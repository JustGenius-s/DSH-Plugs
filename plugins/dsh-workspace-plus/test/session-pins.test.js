import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseSessionPins } from '../src/client/session-pins.ts'

test('legacy global session pins are retained until their workspace is known', () => {
  assert.deepEqual(parseSessionPins(['s-1', 's-2']), [
    { workspaceId: '', sessionId: 's-1' },
    { workspaceId: '', sessionId: 's-2' },
  ])
})

test('legacy scoped pins retain sibling sessions and other workspaces', () => {
  const pins = [
    { workspaceId: 'ws-1', sessionId: 's-1' },
    { workspaceId: 'ws-2', sessionId: 's-2' },
    { workspaceId: 'ws-1', sessionId: 's-3' },
  ]
  assert.deepEqual(parseSessionPins(pins), pins)
})

test('an unresolved migrated session pin survives another reload', () => {
  assert.deepEqual(parseSessionPins([{ workspaceId: '', sessionId: 's-1' }]), [
    { workspaceId: '', sessionId: 's-1' },
  ])
})

test('legacy parsing ignores malformed records and retains the latest duplicate', () => {
  assert.deepEqual(parseSessionPins([null, {}, '', 's-1', 's-2', 's-1']), [
    { workspaceId: '', sessionId: 's-2' },
    { workspaceId: '', sessionId: 's-1' },
  ])
})
