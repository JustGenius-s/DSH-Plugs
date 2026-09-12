import { useCallback, useEffect, useRef } from 'react'
import { Menu, type MenuEntry } from '@just-genius/dsh-plugin-ui'

/** Where the menu was opened, in viewport coordinates. */
export interface MenuAnchor {
  x: number
  y: number
}

export interface RowMenuProps {
  /** Menu rows, already filtered by the enabled feature flags. */
  items: readonly MenuEntry[]
  anchor: MenuAnchor
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Right-click / double-click menu for one sidebar row.
 *
 * There is no trigger element to anchor to — the pointer position is the
 * anchor — so the list renders portaled and positioned from a synthetic
 * zero-size rect at that point. `Menu` measures the list itself and clamps it
 * to the viewport, so the zero width/height is only a placement origin.
 */
export function RowMenu({ items, anchor, onSelect, onClose }: RowMenuProps) {
  const rectRef = useRef<DOMRect | null>(null)

  const getAnchorRect = useCallback((): DOMRect => {
    const cached = rectRef.current
    if (cached !== null && cached.x === anchor.x && cached.y === anchor.y) return cached
    const next = new DOMRect(anchor.x, anchor.y, 0, 0)
    rectRef.current = next
    return next
  }, [anchor.x, anchor.y])

  // Scrolling or resizing moves the row out from under a fixed-position menu;
  // dismissing is cheaper and less surprising than trying to follow it.
  useEffect(() => {
    const dismiss = (): void => { onClose() }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onClose])

  if (items.length === 0) return null

  return (
    <Menu
      open
      portal
      align="start"
      side="bottom"
      getAnchorRect={getAnchorRect}
      // The wrapper carries no layout: `getAnchorRect` owns placement.
      anchor={<span style={{ display: 'contents' }} />}
      items={items}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}
