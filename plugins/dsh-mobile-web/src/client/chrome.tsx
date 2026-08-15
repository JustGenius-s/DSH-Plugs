import { useEffect, useRef } from 'react'
import { findFrame, isMobileViewport, isSidebarOpen } from './query.ts'
import type { MobileKey } from './locales.ts'

const EDGE = 24
const SWIPE = 56

export type MobileChromeInjected = {
  toggleSidebar: () => void
  t: (key: MobileKey) => string
}

export type MobileChromeProps = MobileChromeInjected

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 6.25h12M4 10h12M4 13.75h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function MobileChrome({ toggleSidebar, t }: MobileChromeProps) {
  const startX = useRef<number | null>(null)
  const startY = useRef(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!isMobileViewport() || !isSidebarOpen()) return
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      if (!isMobileViewport() || event.changedTouches.length === 0) return
      const touch = event.changedTouches[0]
      startX.current = touch.clientX
      startY.current = touch.clientY
    }
    const onEnd = (event: TouchEvent) => {
      const origin = startX.current
      startX.current = null
      if (origin === null || !isMobileViewport() || event.changedTouches.length === 0) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - origin
      const dy = Math.abs(touch.clientY - startY.current)
      if (dy > Math.abs(dx)) return
      const open = isSidebarOpen(findFrame())
      if (!open && origin <= EDGE && dx >= SWIPE) toggleSidebar()
      else if (open && dx <= -SWIPE) toggleSidebar()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [toggleSidebar])

  return (
    <div data-dsh-mobile-chrome="">
      <div
        data-dsh-mobile-backdrop=""
        role="button"
        tabIndex={-1}
        aria-label={t('closeBackdrop')}
        onClick={() => {
          if (isSidebarOpen()) toggleSidebar()
        }}
      />
      <button
        type="button"
        data-dsh-mobile-menu=""
        aria-label={t('openMenu')}
        onClick={() => toggleSidebar()}
      >
        <MenuIcon />
      </button>
    </div>
  )
}
