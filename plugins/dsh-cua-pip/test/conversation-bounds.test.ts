import { describe, expect, it } from 'vitest'
import { conversationPipBounds, samePipBounds } from '../src/client/conversation-bounds.ts'
import { applyDragDelta, fitPipPreviewInViewport, restorePipPlacement, snapPipPosition } from '../src/client/float-layout.ts'

describe('conversation PiP bounds', () => {
  const screen = { width: 1746, height: 1134 }
  const scroll = { left: 560, top: 64, width: 920, height: 1070 }
  const composer = { left: 560, top: 960, width: 920, height: 174 }

  it('uses conversation edges and reserves the header, sidebars, and input area', () => {
    expect(conversationPipBounds(scroll, screen, composer))
      .toEqual({ left: 560, top: 64, width: 920, height: 896 })
  })

  it('defaults inside the marked lower-left conversation area', () => {
    const bounds = conversationPipBounds(scroll, screen, composer)!
    const size = { width: 400, height: 250 }
    const position = restorePipPlacement(undefined, size, bounds)
    expect({ left: bounds.left + position.left, top: bounds.top + position.top })
      .toEqual({ left: 568, top: 686 })
    expect(bounds.top + position.top + size.height).toBeLessThan(composer.top)
  })

  it('keeps a far left or right drag out of both sidebars', () => {
    const bounds = conversationPipBounds(scroll, screen, composer)!
    const size = { width: 400, height: 250 }
    const start = { left: 200, top: 200 }
    const left = snapPipPosition(applyDragDelta(start, { x: -3000, y: 0 }, size, bounds), size, bounds)
    const right = snapPipPosition(applyDragDelta(start, { x: 3000, y: 0 }, size, bounds), size, bounds)
    expect(bounds.left + left.left).toBe(568)
    expect(bounds.left + right.left + size.width).toBe(1472)
  })

  it('retains docking when a sidebar moves the conversation without changing its width', () => {
    const before = conversationPipBounds(scroll, screen, composer)!
    const after = conversationPipBounds({ ...scroll, left: 260 }, screen, { ...composer, left: 260 })!
    expect(samePipBounds(before, after)).toBe(false)
    const position = restorePipPlacement({ edge: 'left', top: 300 }, { width: 400, height: 250 }, after)
    expect(after.left + position.left).toBe(268)
    expect(position.top).toBe(300)
  })

  it('fits a narrow conversation after the right sidebar opens and the composer grows', () => {
    const bounds = conversationPipBounds(
      { left: 560, top: 64, width: 300, height: 1070 },
      screen,
      { left: 560, top: 600, width: 300, height: 534 },
    )!
    const size = fitPipPreviewInViewport(1440, 900, bounds)
    const position = restorePipPlacement({ edge: 'right', top: 700 }, size, bounds)
    expect(size).toEqual({ width: 284, height: 177 })
    expect(bounds.left + position.left + size.width).toBeLessThan(860)
    expect(bounds.top + position.top + size.height).toBeLessThan(600)
  })

  it('clips to the visible viewport and ignores a composer in another panel', () => {
    expect(conversationPipBounds(
      { left: -20, top: -10, width: 500, height: 1000 },
      { width: 400, height: 800 },
      { left: 600, top: 600, width: 200, height: 200 },
    )).toEqual({ left: 0, top: 0, width: 400, height: 800 })
  })

  it('hides instead of falling back to the shell when no conversation is measurable', () => {
    expect(conversationPipBounds(null, screen)).toBeNull()
    expect(conversationPipBounds({ ...scroll, width: 0 }, screen)).toBeNull()
    expect(conversationPipBounds({ ...scroll, left: 1800 }, screen)).toBeNull()
    expect(conversationPipBounds({ ...scroll, top: Number.NaN }, screen)).toBeNull()
    expect(conversationPipBounds(scroll, screen, { ...composer, top: 0, height: 1134 })).toBeNull()
  })
})
