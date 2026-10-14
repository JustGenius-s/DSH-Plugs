import { describe, expect, it, vi } from 'vitest'
import {
  DEBUG_STANCE_DOMAIN,
  NO_STANCE,
  openStanceStore,
  stanceKey,
  type StanceRecord,
} from '../src/stance-store.ts'

/**
 * The durable stance seam. History: the stance was appended to the session log
 * as `debug/mode` with `{ ignorable: true }`, but no shipped Session accepts
 * that option, so the marker was dropped and the log became unloadable
 * (`SessionFormatUnsupportedError: … event type "debug/mode" … not marked
 * ignorable`). These tests pin the replacement: a plain domain record, and a
 * store that degrades to memory-only instead of failing the mount.
 */

/** A minimal in-memory stand-in for the opened domain. */
function fakeDomain() {
  const records = new Map<string, StanceRecord>()
  const closes: number[] = []
  return {
    records,
    closes,
    domain: {
      table: () => ({
        get: (key: string) => records.get(key),
        put: async (key: string, value: StanceRecord) => {
          records.set(key, value)
        },
      }),
      close: async () => {
        closes.push(1)
      },
    },
  }
}

const SESSION = 'session-109568db-2c29-4799-b918-ca681629fdb9'

describe('stanceKey', () => {
  it('accepts a session id the json backend can store', () => {
    expect(stanceKey(SESSION)).toBe(SESSION)
  })

  it('rejects an id outside the path-safe key grammar', () => {
    expect(stanceKey('session/../escape')).toBeNull()
    expect(stanceKey('')).toBeNull()
  })
})

describe('openStanceStore', () => {
  it('reads back what it wrote, per session', async () => {
    const fake = fakeDomain()
    const store = await openStanceStore({ storageDomain: { open: async () => fake.domain } })

    expect(store.active(SESSION)).toBe(false)
    store.set(SESSION, true)
    await vi.waitFor(() => expect(store.active(SESSION)).toBe(true))
    expect(store.active('other-session')).toBe(false)
    expect(fake.records.get(SESSION)?.active).toBe(true)
  })

  it('never skips a write, so the last of two rapid toggles wins', async () => {
    const fake = fakeDomain()
    const store = await openStanceStore({ storageDomain: { open: async () => fake.domain } })

    // Both queue before either lands in memory; a cheap "unchanged" guard on
    // the queued state would drop the second and leave the stance on.
    store.set(SESSION, true)
    store.set(SESSION, false)
    await vi.waitFor(() => expect(fake.records.get(SESSION)?.active).toBe(false))
    expect(store.active(SESSION)).toBe(false)
  })

  it('ignores a session whose id cannot be a safe record key', async () => {
    const fake = fakeDomain()
    const store = await openStanceStore({ storageDomain: { open: async () => fake.domain } })

    store.set('bad/id', true)
    expect(store.active('bad/id')).toBe(false)
    expect(fake.records.size).toBe(0)
  })

  it('degrades to memory-only when the domain cannot open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await openStanceStore({
      storageDomain: { open: async () => { throw new Error('backend-not-found') } },
    })

    expect(store.active(SESSION)).toBe(false)
    store.set(SESSION, true)
    expect(warn).toHaveBeenCalled()
    // A failed mount must not take /debug down: the seam stays usable.
    await expect(store.close()).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('keeps a failed record write from surfacing to the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const domain = {
      table: () => ({
        get: () => undefined,
        put: async () => { throw new Error('disk full') },
      }),
      close: async () => {},
    }
    const store = await openStanceStore({ storageDomain: { open: async () => domain } })

    expect(() => store.set(SESSION, true)).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })

  it('closes the domain it opened', async () => {
    const fake = fakeDomain()
    const store = await openStanceStore({ storageDomain: { open: async () => fake.domain } })

    await store.close()
    expect(fake.closes).toHaveLength(1)
  })
})

describe('NO_STANCE', () => {
  it('remembers nothing and accepts writes', () => {
    expect(NO_STANCE.active(SESSION)).toBe(false)
    expect(() => NO_STANCE.set(SESSION, true)).not.toThrow()
    expect(NO_STANCE.active(SESSION)).toBe(false)
  })
})

describe('DEBUG_STANCE_DOMAIN', () => {
  it('is a distinct, log-free domain keyed per session', () => {
    // The name must not collide with another plugin's domain, and it must not
    // be an event namespace: the stance never enters the session log.
    expect(DEBUG_STANCE_DOMAIN.name).toBe('debug_stance')
    expect(Object.keys(DEBUG_STANCE_DOMAIN.tables)).toEqual(['sessions'])
    expect(DEBUG_STANCE_DOMAIN.name.startsWith('plugin:')).toBe(false)
  })
})
