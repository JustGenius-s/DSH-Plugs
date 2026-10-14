import { conversationPipBounds, samePipBounds, type PipBounds } from './conversation-bounds.ts'

// Keep host DOM knowledge at this boundary. Slot outlets are display:contents,
// so their descendants supply geometry; the outlet itself has no layout box.
const MAIN_CONVERSATION = '[data-slot="main.conversation"]'
const CONVERSATION_SCROLL = '[data-conversation-scroll]'
const CONVERSATION_CONTENT = '[data-conversation-content]'
const COMPOSER_SEAT = '[data-composer-seat]'
const RIGHTBAR = '[data-sidebar-right-panel], [data-slot="rightbar"], [data-slot="rightbar.session"]'

export interface ConversationSurfaceCandidate {
  scope: 'main' | 'fallback' | 'embedded'
  visible: boolean
}

/**
 * A hidden/missing main surface must not redirect its PiP into an embedded
 * conversation. Older hosts without the main outlet may supply one unambiguous
 * standalone conversation, but never an arbitrary first match.
 */
export function pickConversationSurfaceCandidate<T extends ConversationSurfaceCandidate>(
  candidates: readonly T[],
  mainMounted: boolean,
): T | undefined {
  const scope = mainMounted ? 'main' : 'fallback'
  const eligible = candidates.filter((candidate) => candidate.scope === scope && candidate.visible)
  return eligible.length === 1 ? eligible[0] : undefined
}

function candidateScope(scroll: HTMLElement): ConversationSurfaceCandidate['scope'] {
  const content = scroll.closest<HTMLElement>(CONVERSATION_CONTENT)
  if (scroll.closest(RIGHTBAR) !== null
    || scroll.parentElement?.closest(CONVERSATION_SCROLL) != null
    || content?.parentElement?.closest(CONVERSATION_CONTENT) != null) return 'embedded'
  if (scroll.closest(MAIN_CONVERSATION) !== null) return 'main'

  // Legacy hosts put the scrollport directly in the phase root; current hosts
  // put the shared content body between them. Embedded bodies own no phase root.
  const root = scroll.closest('[data-phase]')
  return root !== null
    && (scroll.parentElement === root || content?.parentElement === root)
    ? 'fallback'
    : 'embedded'
}

function visibleBounds(element: HTMLElement): PipBounds | null {
  if (!element.isConnected
    || element.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return null
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function readConversationBounds(): PipBounds | null {
  if (document.hidden) return null
  const mainMounted = document.querySelector(MAIN_CONVERSATION) !== null
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(CONVERSATION_SCROLL))
    .map((scroll) => {
      const scope = candidateScope(scroll)
      const bounds = scope === 'embedded' ? null : visibleBounds(scroll)
      return { scope, visible: bounds !== null, scroll, bounds }
    })
  const chosen = pickConversationSurfaceCandidate(candidates, mainMounted)
  if (chosen === undefined || chosen.scroll.closest('[data-rightbar-fullscreen]') !== null) return null

  // Embedded views can own a second composer. Only the seat belonging to this
  // scrollport can reserve its footer band.
  const composer = Array.from(chosen.scroll.querySelectorAll<HTMLElement>(COMPOSER_SEAT))
    .find((seat) => seat.closest(CONVERSATION_SCROLL) === chosen.scroll)
  return conversationPipBounds(
    chosen.bounds,
    { width: window.innerWidth, height: window.innerHeight },
    composer === undefined ? null : visibleBounds(composer),
  )
}

/**
 * Subscribe only while a PiP is open. Frame sampling catches position-only
 * movement and grid transitions, which ResizeObserver cannot report, as well
 * as scroll/sticky-composer changes. No document mutation subscription or DOM
 * writes means the preview cannot trigger a measurement feedback loop.
 */
export function observeConversationBounds(listener: (bounds: PipBounds | null) => void): () => void {
  let disposed = false
  let frame: number | undefined
  let previous: PipBounds | null = null
  let initialized = false

  const measure = (): void => {
    const bounds = readConversationBounds()
    if (initialized && samePipBounds(previous, bounds)) return
    initialized = true
    previous = bounds
    listener(bounds)
  }
  const tick = (): void => {
    frame = undefined
    if (disposed) return
    measure()
    if (!disposed && !document.hidden) frame = window.requestAnimationFrame(tick)
  }
  const visibilityChanged = (): void => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    tick()
  }

  document.addEventListener('visibilitychange', visibilityChanged)
  tick()
  return () => {
    disposed = true
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
}
