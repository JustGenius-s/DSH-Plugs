// Pure geometry for the in-page PiP: preview size follows the captured window
// unless the agent requests a CSS size. The card is dragged in conversation-local
// coordinates (not Electron app-region — that would steal the Desktop window grip).

export const PIP_MAX_LONG_EDGE = 400
export const PIP_DEFAULT_PREVIEW = { width: 400, height: 280 } as const
export const PIP_DRAG_MARGIN = 8
export const PIP_DRAG_THRESHOLD_PX = 4
export const PIP_INSET = 24

export interface PipPosition {
  left: number
  top: number
}

export interface PipSize {
  width: number
  height: number
}

/** Keep the chosen edge anchored when the capture or viewport changes size. */
export interface PipPlacement {
  edge: 'left' | 'right'
  top: number
}

export function fitPipPreviewSize(
  srcW: number,
  srcH: number,
  maxLongEdge = PIP_MAX_LONG_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { width: PIP_DEFAULT_PREVIEW.width, height: PIP_DEFAULT_PREVIEW.height }
  }
  const long = Math.max(srcW, srcH)
  const scale = long > maxLongEdge ? maxLongEdge / long : 1
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  }
}

export function clampNumber(n: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, n))
}

function fitPipBoxInViewport(
  preview: PipSize,
  viewport: PipSize,
  margin = PIP_DRAG_MARGIN,
): PipSize {
  const availableWidth = Math.max(1, viewport.width - margin * 2)
  const availableHeight = Math.max(1, viewport.height - margin * 2)
  const scale = Math.min(1, availableWidth / preview.width, availableHeight / preview.height)
  return {
    width: Math.max(1, Math.floor(preview.width * scale)),
    height: Math.max(1, Math.floor(preview.height * scale)),
  }
}

/** Fit the whole capture, including portrait windows, inside its overlay. */
export function fitPipPreviewInViewport(
  srcW: number,
  srcH: number,
  viewport: PipSize,
  margin = PIP_DRAG_MARGIN,
): PipSize {
  return fitPipBoxInViewport(fitPipPreviewSize(srcW, srcH), viewport, margin)
}

/**
 * Explicit preview dimensions describe the CSS box, independently of capture
 * pixels or native window points. Keep that box's aspect ratio when space is
 * tight; the panel contains the whole capture within it.
 */
export function resolvePipPreviewSize(
  srcW: number,
  srcH: number,
  requested: PipSize | undefined,
  viewport?: PipSize,
): PipSize {
  const hasRequestedSize = requested !== undefined
    && Number.isFinite(requested.width) && requested.width > 0
    && Number.isFinite(requested.height) && requested.height > 0
  const preview = hasRequestedSize
    ? { width: Math.max(1, Math.round(requested.width)), height: Math.max(1, Math.round(requested.height)) }
    : fitPipPreviewSize(srcW, srcH)
  return viewport === undefined ? preview : fitPipBoxInViewport(preview, viewport)
}

export function clampPipPosition(
  pos: { left: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = PIP_DRAG_MARGIN,
): { left: number; top: number } {
  return {
    left: clampNumber(pos.left, margin, Math.max(margin, viewport.width - size.width - margin)),
    top: clampNumber(pos.top, margin, Math.max(margin, viewport.height - size.height - margin)),
  }
}

export function applyDragDelta(
  start: { left: number; top: number },
  delta: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = PIP_DRAG_MARGIN,
): { left: number; top: number } {
  return clampPipPosition(
    { left: start.left + delta.x, top: start.top + delta.y },
    size,
    viewport,
    margin,
  )
}

export function isDragGesture(dx: number, dy: number, threshold = PIP_DRAG_THRESHOLD_PX): boolean {
  return dx * dx + dy * dy >= threshold * threshold
}

/** Release a drag onto its nearest horizontal edge without moving it vertically. */
export function snapPipPosition(
  pos: PipPosition,
  size: PipSize,
  viewport: PipSize,
  margin = PIP_DRAG_MARGIN,
): PipPosition {
  const clamped = clampPipPosition(pos, size, viewport, margin)
  const right = Math.max(margin, viewport.width - size.width - margin)
  return {
    left: clamped.left + size.width / 2 < viewport.width / 2 ? margin : right,
    top: clamped.top,
  }
}

export function pipPlacement(
  pos: PipPosition,
  size: PipSize,
  viewport: PipSize,
): PipPlacement {
  const snapped = snapPipPosition(pos, size, viewport)
  return {
    edge: pos.left + size.width / 2 < viewport.width / 2 ? 'left' : 'right',
    top: snapped.top,
  }
}

export function restorePipPlacement(
  placement: PipPlacement | undefined,
  size: PipSize,
  viewport: PipSize,
): PipPosition {
  return clampPipPosition(
    {
      left: placement?.edge !== 'right' ? PIP_DRAG_MARGIN : viewport.width - size.width - PIP_DRAG_MARGIN,
      top: placement?.top ?? viewport.height - size.height - PIP_INSET,
    },
    size,
    viewport,
  )
}

/** The map outlives a mounted card, so navigating away does not reset its position. */
export function createPipPlacements() {
  const placements = new Map<string, PipPlacement>()
  return {
    get: (sessionId: string): PipPlacement | undefined => {
      const value = placements.get(sessionId)
      return value === undefined ? undefined : { ...value }
    },
    set: (sessionId: string, placement: PipPlacement): void => {
      placements.set(sessionId, { ...placement })
    },
    delete: (sessionId: string): void => {
      placements.delete(sessionId)
    },
    keys: (): string[] => [...placements.keys()],
  }
}

export function pipCardPositionStyle(
  pos: { left: number; top: number } | null,
  inset = PIP_INSET,
):
  | { left: number; bottom: number }
  | { left: number; top: number; right: 'auto'; bottom: 'auto' } {
  if (pos === null) return { left: PIP_DRAG_MARGIN, bottom: inset }
  return { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
}

export function createClickGuard(): { suppress(): void; consume(): boolean; reset(): void } {
  let suppressed = false
  return {
    suppress: () => {
      suppressed = true
    },
    consume: () => {
      const was = suppressed
      suppressed = false
      return was
    },
    reset: () => {
      suppressed = false
    },
  }
}
