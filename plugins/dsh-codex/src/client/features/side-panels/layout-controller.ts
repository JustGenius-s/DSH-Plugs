import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { chatAnchorRows, conversationScroll, isChatViewActive } from '../../host-adapters/conversation-dom'
import type { LauncherStore } from './launcher-store'

export interface SidePanelLayout {
  anchorTop: number | null
  launcherRef: MutableRefObject<HTMLDivElement | null>
}

/** Owns document-level layout effects for the side-panel platform shell. */
export function useSidePanelLayout(
  open: boolean,
  width: number,
  launcher: LauncherStore,
  panelRosterVersion: number,
): SidePanelLayout {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--dsh-side-panels-width', open ? `${width}px` : '0px')
    document.body.toggleAttribute('data-dsh-side-panels-open', open)
    return () => {
      root.style.setProperty('--dsh-side-panels-width', '0px')
      document.body.removeAttribute('data-dsh-side-panels-open')
    }
  }, [open, width])

  const [anchorTop, setAnchorTop] = useState<number | null>(null)
  useEffect(() => {
    if (open) return
    let frame: number | null = null
    const measure = (): void => {
      const scroll = conversationScroll()
      setAnchorTop(scroll === null ? null : Math.round(scroll.getBoundingClientRect().top))
    }
    const schedule = (): void => {
      frame ??= requestAnimationFrame(() => { frame = null; measure() })
    }
    measure()
    const observer = new ResizeObserver(schedule)
    const scroll = conversationScroll()
    if (scroll !== null) observer.observe(scroll)
    observer.observe(document.documentElement)
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [open])

  const launcherRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open) {
      launcher.setOccluded(false)
      launcher.setChatView(true)
      return
    }
    let frame: number | null = null
    const measure = (): void => {
      launcher.setChatView(isChatViewActive())
      const card = launcherRef.current
      const scroll = conversationScroll()
      if (card === null || scroll === null) {
        launcher.setOccluded(false)
        return
      }
      const cardRect = card.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      const overlapsScroll = overlaps(cardRect, scrollRect)
      const occluded = overlapsScroll && chatAnchorRows(scroll).some(row => {
        const rowRect = row.getBoundingClientRect()
        return rowRect.bottom >= scrollRect.top
          && rowRect.top <= scrollRect.bottom
          && overlaps(cardRect, rowRect)
      })
      launcher.setOccluded(occluded)
    }
    const schedule = (): void => {
      frame ??= requestAnimationFrame(() => { frame = null; measure() })
    }
    measure()
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(document.documentElement)
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    })
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [launcher, open, panelRosterVersion])

  return { anchorTop, launcherRef }
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
