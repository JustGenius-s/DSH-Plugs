/** Phone, or a coarse-pointer tablet still inside the official auto-collapse band. */
export const MOBILE_QUERY =
  '(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))'

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
}

export function findFrame(): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>('[data-dsh-mobile-frame]')
  if (marked) return marked
  const overlay = document.querySelector('[data-shell-overlay]')
  return overlay?.parentElement ?? null
}

export function isSidebarOpen(frame: Element | null = findFrame()): boolean {
  return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
}
