/**
 * Reveal an over-long row title by crawling it while the row is hovered.
 *
 * This mirrors the official session row exactly — same constants, same
 * `scrollLeft` mechanism, same fade-mask hooks — so a pinned row reveals its
 * title the way the row inside a workspace group does:
 *
 *   - entering crawls the title at a CONSTANT speed until its far edge is
 *     visible, then it rests there under the pointer;
 *   - leaving returns it to the start in one step, so the resting ellipsis
 *     renders at full strength;
 *   - an overflow of at most {@link MIN_TITLE_REVEAL_PX} is left alone, because
 *     a barely-clipped title moving a few pixels reads as jitter, not a reveal;
 *   - `prefers-reduced-motion` jumps straight to the far edge instead of
 *     animating, which is the same accommodation the official code makes.
 *
 * The fade hooks (`data-scrolled` / `data-clipped`) are what the stylesheet
 * turns into left/right edge masks, so the crawl does not run text under a hard
 * clip. Keeping the names identical to the official ones is deliberate: the
 * masking rules are copied from the same stylesheet.
 */

import { useEffect, useMemo, useRef } from 'react'

/** Overflow at or below this stays put: moving a few pixels reads as jitter. */
const MIN_TITLE_REVEAL_PX = 8

/** Crawl speed in CSS pixels per millisecond. */
const TITLE_MARQUEE_PX_PER_MS = 0.03

type TitleRef = { readonly current: HTMLElement | null }

function placeTitle(title: HTMLElement, left: number, range: number): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' })
  else title.scrollLeft = left
  if (left > 0) title.dataset.scrolled = ''
  else delete title.dataset.scrolled
  if (left < range) title.dataset.clipped = ''
  else delete title.dataset.clipped
}

function restTitle(title: HTMLElement): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' })
  else title.scrollLeft = 0
  delete title.dataset.scrolled
  delete title.dataset.clipped
}

export interface TitleMarquee {
  enter: () => void
  leave: () => void
}

/** Bind the crawl to one title element. `title` must be the CLIPPING span. */
export function useTitleMarquee(title: TitleRef): TitleMarquee {
  const frame = useRef(0)

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
  }, [])

  return useMemo(() => ({
    enter: () => {
      const element = title.current
      if (element === null) return
      const range = element.scrollWidth - element.clientWidth
      if (range <= MIN_TITLE_REVEAL_PX) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        placeTitle(element, range, range)
        return
      }
      cancelAnimationFrame(frame.current)
      let previous: number | undefined
      let position = 0
      const step = (now: number): void => {
        position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS
        previous = now
        placeTitle(element, Math.min(position, range), range)
        if (position < range) frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    },
    leave: () => {
      cancelAnimationFrame(frame.current)
      const element = title.current
      if (element === null) return
      restTitle(element)
    },
  }), [title])
}

export { MIN_TITLE_REVEAL_PX, TITLE_MARQUEE_PX_PER_MS }
