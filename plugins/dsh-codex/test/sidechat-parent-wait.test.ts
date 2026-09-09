/**
 * A side chat is forked from the conversation the user is looking at, but the
 * panel can mount BEFORE that session has entered the Host's session store —
 * a page reload, a session switch, or a cold restore all race the fork.
 *
 * The Host used to read the parent once and fail the very first attempt with
 * `404 parent session "..." not found`, which made the side chat unusable
 * whenever the race was lost. The client already polls for its own side
 * session to appear (see `waitForListed` in panel.tsx); the Host must do the
 * same for the parent.
 *
 * These tests use real timing with small budgets so the deadline logic under
 * test (`Date.now()` based) behaves exactly as it does in production.
 */

import { describe, expect, it } from 'vitest'
import { pollForValue } from '../src/host/side-chat/server'

describe('pollForValue', () => {
  it('returns a value that is already available without polling', async () => {
    let calls = 0
    const value = await pollForValue(
      () => { calls += 1; return 'here' },
      { timeoutMs: 50, intervalMs: 10 },
    )
    expect(value).toBe('here')
    // Read once, no waiting.
    expect(calls).toBe(1)
  })

  it('waits for a value that appears after a few polls', async () => {
    let attempts = 0
    const value = await pollForValue(
      () => {
        attempts += 1
        return attempts >= 3 ? 'session' : undefined
      },
      { timeoutMs: 1000, intervalMs: 10 },
    )
    expect(value).toBe('session')
    expect(attempts).toBe(3)
  })

  it('gives up when the value never appears', async () => {
    const start = Date.now()
    const value = await pollForValue(() => undefined, {
      timeoutMs: 120,
      intervalMs: 20,
    })
    expect(value).toBeUndefined()
    // Stopped once the budget was spent, rather than polling forever.
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(600)
  })

  it('checks again after each interval', async () => {
    let calls = 0
    await pollForValue(
      () => { calls += 1; return undefined },
      { timeoutMs: 80, intervalMs: 20 },
    )
    expect(calls).toBeGreaterThan(1)
  })
})
