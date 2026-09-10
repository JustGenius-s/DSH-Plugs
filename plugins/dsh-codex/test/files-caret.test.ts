import { describe, expect, it } from 'vitest'
import {
  caretBoxInLine,
  clampColumn,
  MIN_CARET_HEIGHT,
  positionOfColumn,
  type RectLike,
} from '../src/client/features/files/caret-position'

/**
 * Read-only caret geometry. Rendering is never exercised (AGENTS.md forbids UI
 * tests), so the rules that decide where the caret lands are pinned here
 * instead: clamping a click-derived column to its line, and turning a column
 * back into a box. `caret-dom.ts` only feeds these numbers from the DOM.
 */

const line: RectLike = { left: 100, top: 200, width: 400, height: 21 }

describe('clampColumn', () => {
  it('keeps a column inside the line', () => {
    expect(clampColumn(0, 10)).toBe(0)
    expect(clampColumn(7, 10)).toBe(7)
    expect(clampColumn(10, 10)).toBe(10)
  })

  it('clamps past the end instead of dropping the caret', () => {
    // The renderer appends an ellipsis past stopRenderingLineAfter, and an
    // empty line paints a placeholder space, so a hit-tested column can exceed
    // the source line.
    expect(clampColumn(11, 10)).toBe(10)
    expect(clampColumn(3, 0)).toBe(0)
  })

  it('treats a negative or unusable column as the line start', () => {
    expect(clampColumn(-5, 10)).toBe(0)
    expect(clampColumn(Number.NaN, 10)).toBe(0)
    expect(clampColumn(Number.POSITIVE_INFINITY, 10)).toBe(0)
  })

  it('floors a fractional column', () => {
    expect(clampColumn(4.8, 10)).toBe(4)
  })
})

describe('positionOfColumn', () => {
  it('returns undefined when the line paints no text', () => {
    expect(positionOfColumn([], 0)).toBeUndefined()
  })

  it('resolves a column inside a single-node line', () => {
    expect(positionOfColumn([5], 3)).toEqual({ index: 0, offset: 3 })
  })

  it('keeps the end of a node on that node', () => {
    // The boundary column belongs to the earlier node, which is what keeps a
    // caret at the end of a token from jumping into the next one.
    expect(positionOfColumn([3, 4], 3)).toEqual({ index: 0, offset: 3 })
    expect(positionOfColumn([3, 4], 4)).toEqual({ index: 1, offset: 1 })
  })

  it('parks a column past the end at the end of the line', () => {
    expect(positionOfColumn([5], 99)).toEqual({ index: 0, offset: 5 })
    expect(positionOfColumn([3, 4], 99)).toEqual({ index: 1, offset: 4 })
  })

  it('clamps a negative column to the start', () => {
    expect(positionOfColumn([3, 4], -2)).toEqual({ index: 0, offset: 0 })
  })
})

describe('caretBoxInLine', () => {
  it('measures the caret relative to the line box', () => {
    const caret: RectLike = { left: 180, top: 200, width: 0, height: 21 }
    expect(caretBoxInLine(caret, line)).toEqual({ left: 80, top: 0, height: 21 })
  })

  it('puts a wrapped row caret on that row', () => {
    const caret: RectLike = { left: 100, top: 221, width: 0, height: 21 }
    expect(caretBoxInLine(caret, line)).toEqual({ left: 0, top: 21, height: 21 })
  })

  it('falls back to a visible height when the range reports none', () => {
    const caret: RectLike = { left: 120, top: 200, width: 0, height: 0 }
    expect(caretBoxInLine(caret, line).height).toBe(MIN_CARET_HEIGHT)
  })

  it('never paints outside the line box', () => {
    // A caret rect left of or above the line (a stale measure) must not pull
    // the marker off the row.
    const caret: RectLike = { left: 40, top: 150, width: 0, height: 21 }
    expect(caretBoxInLine(caret, line)).toEqual({ left: 0, top: 0, height: 21 })
  })
})
