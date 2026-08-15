import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { findFrame, isMobileViewport, isSidebarOpen, MOBILE_QUERY } from './query.ts'
import { MOBILE_CSS } from './styles.ts'

const STYLE_ID = '@just-genius/dsh-mobile-web/mobile.css'
const VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'

function injectCss(): () => void {
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)) {
    return () => {}
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-mobile-web'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = MOBILE_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

function patchViewport(): () => void {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="viewport"]') ??
    document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport' }))
  const previous = meta.getAttribute('content')
  meta.setAttribute('content', VIEWPORT_CONTENT)
  return () => {
    if (previous === null) meta.remove()
    else meta.setAttribute('content', previous)
  }
}

function syncVisualViewport(): void {
  const vv = window.visualViewport
  const root = document.documentElement
  if (!vv) {
    root.style.removeProperty('--dsh-vv-height')
    root.style.removeProperty('--dsh-vv-top')
    return
  }
  root.style.setProperty('--dsh-vv-height', `${Math.round(vv.height)}px`)
  root.style.setProperty('--dsh-vv-top', `${Math.round(vv.offsetTop)}px`)
}

function watchVisualViewport(): () => void {
  const vv = window.visualViewport
  syncVisualViewport()
  if (!vv) return () => {}
  const onChange = () => syncVisualViewport()
  vv.addEventListener('resize', onChange)
  vv.addEventListener('scroll', onChange)
  return () => {
    vv.removeEventListener('resize', onChange)
    vv.removeEventListener('scroll', onChange)
    document.documentElement.style.removeProperty('--dsh-vv-height')
    document.documentElement.style.removeProperty('--dsh-vv-top')
  }
}

function markFrame(): void {
  const overlay = document.querySelector('[data-shell-overlay]')
  const frame = overlay?.parentElement
  if (frame && !frame.hasAttribute('data-dsh-mobile-frame')) {
    frame.setAttribute('data-dsh-mobile-frame', '')
  }
}

function watchFrame(): () => void {
  markFrame()
  const mo = new MutationObserver(() => markFrame())
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}

function watchMobileClass(): () => void {
  const root = document.documentElement
  root.classList.add('dsh-mobile-web')
  const media = window.matchMedia(MOBILE_QUERY)
  const apply = () => root.classList.toggle('dsh-mobile-web-active', media.matches)
  apply()
  media.addEventListener('change', apply)
  return () => {
    media.removeEventListener('change', apply)
    root.classList.remove('dsh-mobile-web', 'dsh-mobile-web-active')
  }
}

function closeSidebarIfOpen(ctx: ClientContext): void {
  if (!isMobileViewport() || !isSidebarOpen()) return
  ctx.layout.toggleSidebar()
}

function watchSessionClose(ctx: ClientContext): () => void {
  let current = ctx.sessions.list.getSnapshot().current
  return ctx.sessions.list.subscribe(() => {
    const next = ctx.sessions.list.getSnapshot().current
    if (next === current) return
    current = next
    closeSidebarIfOpen(ctx)
  })
}

function watchDialogClose(ctx: ClientContext): () => void {
  let sawDialog = false
  const mo = new MutationObserver(() => {
    const open = document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
    if (open && !sawDialog) closeSidebarIfOpen(ctx)
    sawDialog = open
  })
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}

/** Install document-level mobile adaptations. Returns a disposer for the plugin fiber. */
export function startAdapt(ctx: ClientContext): () => void {
  const disposers = [
    injectCss(),
    patchViewport(),
    watchVisualViewport(),
    watchFrame(),
    watchMobileClass(),
    watchSessionClose(ctx),
    watchDialogClose(ctx),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export { findFrame, isMobileViewport, isSidebarOpen }
