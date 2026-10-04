import type { PipPosition, PipSize } from './float-layout.ts'

export interface PipBounds extends PipPosition, PipSize {}

function validRect(rect: PipBounds): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
}

/**
 * The preview belongs to the conversation scrollport, excluding the sticky
 * composer. Coordinates are viewport-relative so shell/sidebar offsets never
 * become part of the card's local drag coordinates.
 */
export function conversationPipBounds(
  scroll: PipBounds | null,
  viewport: PipSize,
  composer: PipBounds | null = null,
): PipBounds | null {
  if (scroll === null || !validRect(scroll)
    || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null
  const left = Math.max(0, scroll.left)
  const top = Math.max(0, scroll.top)
  const right = Math.min(viewport.width, scroll.left + scroll.width)
  let bottom = Math.min(viewport.height, scroll.top + scroll.height)
  if (composer !== null && validRect(composer)
    && composer.left < right && composer.left + composer.width > left
    && composer.top + composer.height > top && composer.top < bottom) {
    bottom = Math.min(bottom, Math.max(top, composer.top))
  }
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

export function samePipBounds(left: PipBounds | null, right: PipBounds | null): boolean {
  if (left === null || right === null) return left === right
  return left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height
}
