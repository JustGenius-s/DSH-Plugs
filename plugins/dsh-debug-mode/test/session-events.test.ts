import { describe, expect, it } from 'vitest'
import { sessionEvents } from '../src/session-events.ts'

/**
 * The version-tolerant event-log read. DSH 0.1.3 made `session.events` private
 * and moved reads to `snapshotEvents()`; reading the old getter blindly threw
 * "events is not iterable" and took `/debug` down with it, so both shapes and
 * the "neither" case are pinned here.
 */

const event = { type: 'turn/start', seq: 1 } as never

describe('sessionEvents', () => {
  it('reads the 0.1.3+ accessor', () => {
    expect(sessionEvents({ snapshotEvents: () => [event] })).toEqual([event])
  })

  it('falls back to the legacy events array', () => {
    expect(sessionEvents({ events: [event] })).toEqual([event])
  })

  it('prefers the current accessor when both exist', () => {
    const legacy = { type: 'turn/end', seq: 1 } as never
    expect(sessionEvents({ snapshotEvents: () => [event], events: [legacy] })).toEqual([event])
  })

  it('returns an empty log for a non-array legacy value', () => {
    // A private field read off the class instance is undefined, not a throw.
    expect(sessionEvents({ events: undefined })).toEqual([])
  })

  it('returns an empty log when neither accessor exists', () => {
    expect(sessionEvents({})).toEqual([])
  })
})
