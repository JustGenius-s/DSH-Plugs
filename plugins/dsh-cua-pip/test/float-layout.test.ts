import { describe, expect, it } from 'vitest'
import {
  applyDragDelta,
  clampPipPosition,
  createClickGuard,
  createPipPlacements,
  fitPipPreviewInViewport,
  fitPipPreviewSize,
  isDragGesture,
  PIP_DEFAULT_PREVIEW,
  PIP_DRAG_THRESHOLD_PX,
  pipCardPositionStyle,
  pipPlacement,
  resolvePipPreviewSize,
  restorePipPlacement,
  snapPipPosition,
} from '../src/client/float-layout.ts'

describe('fitPipPreviewSize', () => {
  it('returns the default box when the source size is missing', () => {
    expect(fitPipPreviewSize(0, 0)).toEqual(PIP_DEFAULT_PREVIEW)
    expect(fitPipPreviewSize(-10, 200)).toEqual(PIP_DEFAULT_PREVIEW)
    expect(fitPipPreviewSize(Number.NaN, 100)).toEqual(PIP_DEFAULT_PREVIEW)
  })

  it('scales a portrait capture so the long edge is 400', () => {
    expect(fitPipPreviewSize(361, 640)).toEqual({ width: 226, height: 400 })
  })

  it('scales a landscape capture so the long edge is 400', () => {
    expect(fitPipPreviewSize(1440, 900)).toEqual({ width: 400, height: 250 })
  })

  it('keeps a capture that already fits the cap', () => {
    expect(fitPipPreviewSize(320, 200)).toEqual({ width: 320, height: 200 })
  })

  it('keeps a square capture square', () => {
    expect(fitPipPreviewSize(800, 800)).toEqual({ width: 400, height: 400 })
  })
})

describe('fitPipPreviewInViewport', () => {
  it('shrinks a portrait capture to fit a short viewport without cropping it', () => {
    expect(fitPipPreviewInViewport(361, 640, { width: 500, height: 200 }))
      .toEqual({ width: 103, height: 184 })
  })

  it('constrains the capture and the initial empty state to a narrow viewport', () => {
    expect(fitPipPreviewInViewport(1440, 900, { width: 216, height: 500 }))
      .toEqual({ width: 200, height: 125 })
    expect(fitPipPreviewInViewport(0, 0, { width: 216, height: 500 }))
      .toEqual({ width: 200, height: 140 })
  })
})

describe('agent preview dimensions', () => {
  it('uses requested CSS dimensions independently of capture pixels and the default long-edge cap', () => {
    const requested = { width: 640, height: 360 }
    expect(resolvePipPreviewSize(1568, 1176, requested)).toEqual(requested)
    expect(resolvePipPreviewSize(1024, 768, requested)).toEqual(requested)
  })

  it('applies a new size immediately, including before the first capture arrives', () => {
    expect(resolvePipPreviewSize(0, 0, { width: 600, height: 200 }))
      .toEqual({ width: 600, height: 200 })
    expect(resolvePipPreviewSize(1568, 1176, { width: 600, height: 200 }))
      .toEqual({ width: 600, height: 200 })
    expect(resolvePipPreviewSize(1568, 1176, { width: 240, height: 400 }))
      .toEqual({ width: 240, height: 400 })
  })

  it('shrinks the requested box proportionally to the conversation bounds', () => {
    const requested = { width: 640, height: 360 }
    expect(resolvePipPreviewSize(1200, 900, requested, { width: 336, height: 500 }))
      .toEqual({ width: 320, height: 180 })
    expect(resolvePipPreviewSize(1200, 900, requested, { width: 900, height: 196 }))
      .toEqual({ width: 320, height: 180 })
    expect(resolvePipPreviewSize(1200, 900, requested, { width: 900, height: 500 }))
      .toEqual(requested)
  })

  it('preserves default sizing when an override is absent or invalid', () => {
    for (const requested of [
      undefined,
      { width: 0, height: 200 },
      { width: 200, height: -1 },
      { width: Number.NaN, height: 200 },
      { width: 200, height: Number.POSITIVE_INFINITY },
    ]) {
      expect(resolvePipPreviewSize(1440, 900, requested))
        .toEqual({ width: 400, height: 250 })
      expect(resolvePipPreviewSize(1440, 900, requested, { width: 216, height: 500 }))
        .toEqual({ width: 200, height: 125 })
    }
  })

  it('keeps the same docked edge when the agent changes preview dimensions', () => {
    const viewport = { width: 1000, height: 800 }
    const held = { edge: 'right' as const, top: 500 }
    const enlarged = resolvePipPreviewSize(1568, 1176, { width: 640, height: 360 }, viewport)
    expect(restorePipPlacement(held, enlarged, viewport))
      .toEqual({ left: 352, top: 432 })
    const smaller = resolvePipPreviewSize(1568, 1176, { width: 240, height: 180 }, viewport)
    expect(restorePipPlacement(held, smaller, viewport))
      .toEqual({ left: 752, top: 500 })
    expect(restorePipPlacement({ edge: 'left', top: 500 }, enlarged, viewport))
      .toEqual({ left: 8, top: 432 })
  })
})

describe('applyDragDelta / clampPipPosition', () => {
  it('moves by the pointer delta inside the viewport', () => {
    expect(
      applyDragDelta({ left: 100, top: 80 }, { x: 20, y: -10 }, { width: 200, height: 120 }, { width: 1000, height: 800 }),
    ).toEqual({ left: 120, top: 70 })
  })

  it('clamps to the viewport margin', () => {
    expect(
      applyDragDelta({ left: 900, top: 700 }, { x: 200, y: 200 }, { width: 200, height: 100 }, { width: 1000, height: 800 }),
    ).toEqual({ left: 792, top: 692 })
  })

  it('stays on the margin when the card is larger than the viewport', () => {
    expect(clampPipPosition({ left: 50, top: 50 }, { width: 900, height: 700 }, { width: 400, height: 300 })).toEqual({
      left: 8,
      top: 8,
    })
  })
})

describe('isDragGesture', () => {
  it('ignores a click-sized wobble and accepts a real drag', () => {
    expect(isDragGesture(0, 0)).toBe(false)
    expect(isDragGesture(3, 0)).toBe(false)
    expect(isDragGesture(PIP_DRAG_THRESHOLD_PX, 0)).toBe(true)
    expect(isDragGesture(3, 3)).toBe(true)
  })
})

describe('edge docking', () => {
  const size = { width: 200, height: 120 }
  const viewport = { width: 1000, height: 800 }

  it('snaps to the nearest edge while retaining the vertical placement', () => {
    expect(snapPipPosition({ left: 220, top: 320 }, size, viewport))
      .toEqual({ left: 8, top: 320 })
    expect(snapPipPosition({ left: 520, top: 320 }, size, viewport))
      .toEqual({ left: 792, top: 320 })
  })

  it('keeps an edge after the viewport and capture resize, clamping the vertical position', () => {
    const held = pipPlacement({ left: 700, top: 650 }, size, viewport)
    expect(held).toEqual({ edge: 'right', top: 650 })
    expect(restorePipPlacement(held, { width: 300, height: 200 }, { width: 600, height: 500 }))
      .toEqual({ left: 292, top: 292 })
    expect(restorePipPlacement({ edge: 'left', top: 80 }, size, viewport))
      .toEqual({ left: 8, top: 80 })
  })

  it('initializes at the conversation lower left and remembers positions independently for each session', () => {
    expect(restorePipPlacement(undefined, size, viewport)).toEqual({ left: 8, top: 656 })
    const retained = createPipPlacements()
    retained.set('one', { edge: 'left', top: 80 })
    retained.set('two', { edge: 'right', top: 400 })
    expect(restorePipPlacement(retained.get('one'), size, viewport)).toEqual({ left: 8, top: 80 })
    expect(restorePipPlacement(retained.get('two'), size, viewport)).toEqual({ left: 792, top: 400 })
    retained.delete('one')
    expect(retained.keys()).toEqual(['two'])
  })
})

describe('pipCardPositionStyle', () => {
  it('defaults to the bottom-left inset and switches to left/top after a drag', () => {
    expect(pipCardPositionStyle(null)).toEqual({ left: 8, bottom: 24 })
    expect(pipCardPositionStyle({ left: 40, top: 60 })).toEqual({
      left: 40,
      top: 60,
      right: 'auto',
      bottom: 'auto',
    })
  })
})

describe('createClickGuard', () => {
  it('suppresses the next consume after a drag, then clears', () => {
    const guard = createClickGuard()
    expect(guard.consume()).toBe(false)
    guard.suppress()
    expect(guard.consume()).toBe(true)
    expect(guard.consume()).toBe(false)
  })

  it('does not discard a fresh click after a cancelled gesture', () => {
    const guard = createClickGuard()
    guard.suppress()
    guard.reset()
    expect(guard.consume()).toBe(false)
  })
})
