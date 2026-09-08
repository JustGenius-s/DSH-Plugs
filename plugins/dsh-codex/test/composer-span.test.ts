import { describe, expect, it } from 'vitest'
import { detectEndOf } from '../src/client/host-adapters/composer-span'

/**
 * The composer's append span. Insert events are span-CAS'd in DETECT
 * coordinates, where a chip is one character while `draft` spells it out in
 * full — so these cases pin the conversion that lets "add to chat" work more
 * than once.
 */

describe('detectEndOf', () => {
  it('is the draft length while the draft holds no chip', () => {
    expect(detectEndOf('', [])).toBe(0)
    expect(detectEndOf('hello', [])).toBe(5)
    expect(detectEndOf('hello\nworld', [])).toBe(11)
  })

  it('collapses one chip to a single character', () => {
    // Clipboard "@src/a.ts " is 10 chars; detect is chip + space = 2.
    expect(detectEndOf('@src/a.ts ', [{ length: 9 }])).toBe(2)
  })

  it('collapses every chip in the draft', () => {
    // "@a @bb " is 7 clipboard chars; detect is chip+space+chip+space = 4.
    expect(detectEndOf('@a @bb ', [{ length: 2 }, { length: 3 }])).toBe(4)
  })

  it('ignores an empty or single-character occurrence', () => {
    expect(detectEndOf('abc', [{ length: 0 }, { length: 1 }])).toBe(3)
  })

  it('never returns a negative offset', () => {
    expect(detectEndOf('', [{ length: 5 }])).toBe(0)
  })
})
