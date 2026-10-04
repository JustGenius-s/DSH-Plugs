import { describe, expect, it } from 'vitest'
import { debugDockOpen, debugLogCardOpen, effectiveDebugOn } from '../src/view.ts'

describe('effectiveDebugOn', () => {
  it('uses a queued enter before the log has flipped', () => {
    expect(effectiveDebugOn(true, false)).toBe(true)
  })

  it('hides on a queued leave', () => {
    expect(effectiveDebugOn(false, true)).toBe(false)
  })

  it('follows the committed value when nothing is queued', () => {
    expect(effectiveDebugOn(null, true)).toBe(true)
    expect(effectiveDebugOn(undefined, false)).toBe(false)
  })
})

describe('debugDockOpen', () => {
  const empty = { logCount: 0, runCount: 0, hypothesisCount: 0, waiting: false }

  it('stays closed on enter when the session has no logs yet', () => {
    expect(debugLogCardOpen(empty)).toBe(false)
    expect(debugDockOpen({ active: true, ...empty })).toBe(false)
  })

  it('opens the log card after ingest', () => {
    expect(debugDockOpen({ active: true, ...empty, logCount: 1 })).toBe(true)
  })

  it('still opens for an archived run or an open wait', () => {
    expect(debugDockOpen({ active: true, ...empty, runCount: 1 })).toBe(true)
    expect(debugDockOpen({ active: true, ...empty, waiting: true })).toBe(true)
  })
})
