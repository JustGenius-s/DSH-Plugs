import { expect, test } from 'vitest'

import { shouldWakeLeader } from '../lib/wake-policy.js'

/**
 * Every settlement is a Leader review point. The next step does not start
 * until the Leader calls flow.next, so a silent success would stall the graph.
 */

test('a success wakes even if other nodes could still run', () => {
  expect(shouldWakeLeader({ newlyFailed: false, remaining: 2, running: 0 })).toBe(true)
})

test('the last success wakes so the Leader can summarise', () => {
  expect(shouldWakeLeader({ newlyFailed: false, remaining: 0, running: 0 })).toBe(true)
})

test('a failure wakes so the Leader can patch', () => {
  expect(shouldWakeLeader({ newlyFailed: true, remaining: 3, running: 0 })).toBe(true)
})

test('a success while another child is still running still wakes', () => {
  expect(shouldWakeLeader({ newlyFailed: false, remaining: 2, running: 1 })).toBe(true)
})
