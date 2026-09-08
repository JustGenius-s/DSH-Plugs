import { describe, expect, it } from 'vitest'
import { tabInsertIndex } from '../src/client/features/side-panels/tab-order'

/**
 * Where a new side-panel tab lands. The store reads this index directly, so
 * the rule is pinned here instead of through the store's localStorage-backed
 * observable (AGENTS.md: plain function first, tests never touch the DOM).
 */

const strip = (...keys: string[]) => keys.map((key) => ({ key }))

describe('tabInsertIndex', () => {
  it('puts the first tab of an empty strip at 0', () => {
    expect(tabInsertIndex([], null)).toBe(0)
    expect(tabInsertIndex([], 'missing')).toBe(0)
  })

  it('lands right after the active tab', () => {
    expect(tabInsertIndex(strip('a', 'b', 'c'), 'a')).toBe(1)
    expect(tabInsertIndex(strip('a', 'b', 'c'), 'b')).toBe(2)
  })

  it('appends when the active tab is the last one', () => {
    expect(tabInsertIndex(strip('a', 'b', 'c'), 'c')).toBe(3)
  })

  it('appends when no tab is active', () => {
    expect(tabInsertIndex(strip('a', 'b'), null)).toBe(2)
  })

  it('appends when the active key is stale', () => {
    // A closed instance can leave an activeKey that no longer resolves; the
    // new tab must still land somewhere rather than vanish.
    expect(tabInsertIndex(strip('a', 'b'), 'gone')).toBe(2)
  })
})
