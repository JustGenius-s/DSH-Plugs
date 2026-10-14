// The currently open conversation's PiP. Other sessions keep running on the
// host while this surface follows navigation.

import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  pickConversationActivity,
  resolveCurrentSessionId,
  shouldOpenOverlay,
} from '../shared/cua-activity.ts'
import type { CuaActivity } from '../shared/types.ts'
import { api } from './bridge.ts'
import { beginPreviewClose, finishPreviewClose, isPreviewClosing, type PendingCloses } from './close-state.ts'
import { samePipBounds, type PipBounds } from './conversation-bounds.ts'
import { observeConversationBounds } from './conversation-surface.ts'
import {
  applyDragDelta,
  clampPipPosition,
  createClickGuard,
  createPipPlacements,
  isDragGesture,
  pipCardPositionStyle,
  pipPlacement,
  restorePipPlacement,
  snapPipPosition,
  type PipPosition,
  type PipSize,
} from './float-layout.ts'
import { CuaPipPanel, moduleRetained } from './panel.tsx'

export interface FloatLayerProps {
  t: (key: string) => string
  getCurrentSessionId: () => string | undefined
  subscribeCurrentSession?: (listener: () => void) => () => void
}

/** Retain only geometry here. Open/closed state belongs to the host. */
export const modulePlacements = createPipPlacements()

const noDrag = { WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as const
const styles = {
  layer: {
    position: 'fixed',
    zIndex: 20,
    pointerEvents: 'none',
    overflow: 'hidden',
    ...noDrag,
  },
  card: {
    position: 'absolute',
    zIndex: 50,
    display: 'flex',
    overflow: 'hidden',
    borderRadius: 14,
    boxShadow: '0 12px 40px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.12)',
    background: '#111113',
    color: '#fff',
    pointerEvents: 'auto',
    userSelect: 'none',
    touchAction: 'none',
    cursor: 'grab',
    ...noDrag,
  },
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
    display: 'grid',
    placeItems: 'center',
    width: 30,
    height: 30,
    padding: 0,
    border: '1px solid rgba(255,255,255,.16)',
    borderRadius: '50%',
    background: 'rgba(26,26,30,.4)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 2px 14px rgba(0,0,0,.22)',
    color: '#fff',
    cursor: 'pointer',
    ...noDrag,
  },
} as const

const interactionCss = `
.dsh-cua-pip-close { opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
.dsh-cua-pip-card:hover .dsh-cua-pip-close,
.dsh-cua-pip-card:focus-within .dsh-cua-pip-close { opacity: 1; pointer-events: auto; }
.dsh-cua-pip-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.dsh-cua-pip-card[data-cua-pip-dragging] .dsh-cua-pip-close { opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .dsh-cua-pip-close { transition: none; } }
`

function viewportOf(card: HTMLElement): PipSize {
  const parent = card.offsetParent as HTMLElement | null
  return {
    width: parent?.clientWidth ?? 0,
    height: parent?.clientHeight ?? 0,
  }
}

function originOf(card: HTMLElement): PipPosition {
  const parentRect = (card.offsetParent as HTMLElement | null)?.getBoundingClientRect()
  const rect = card.getBoundingClientRect()
  return { left: rect.left - (parentRect?.left ?? 0), top: rect.top - (parentRect?.top ?? 0) }
}

function subscribeFallback(listener: () => void): () => void {
  window.addEventListener('storage', listener)
  window.addEventListener('popstate', listener)
  const timer = window.setInterval(listener, 100)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener('popstate', listener)
    window.clearInterval(timer)
  }
}

interface DragSession {
  pointerId: number
  startX: number
  startY: number
  start: PipPosition
  moved: boolean
}

function PipCard({
  activity,
  areaSize,
  t,
  close,
}: {
  activity: CuaActivity
  areaSize: PipSize
  t: (key: string) => string
  close: (activity: CuaActivity) => void
}) {
  const { sessionId } = activity
  const [position, setPosition] = useState<PipPosition | null>(null)
  const [viewport, setViewport] = useState<PipSize>(() => ({
    width: areaSize.width,
    height: areaSize.height,
  }))
  const [dragging, setDragging] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const positionRef = useRef<PipPosition | null>(null)
  const placement = useRef(modulePlacements.get(sessionId))
  const drag = useRef<DragSession | null>(null)
  const clickGuard = useRef(createClickGuard()).current

  const updatePosition = (next: PipPosition): void => {
    positionRef.current = next
    setPosition((previous) =>
      previous?.left === next.left && previous.top === next.top ? previous : next)
  }

  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null) return
    const constrain = (): void => {
      const bounds = viewportOf(card)
      const size = { width: card.offsetWidth, height: card.offsetHeight }
      setViewport((previous) =>
        previous.width === bounds.width && previous.height === bounds.height ? previous : bounds)
      const next = drag.current !== null && positionRef.current !== null
        ? clampPipPosition(positionRef.current, size, bounds)
        : restorePipPlacement(placement.current, size, bounds)
      updatePosition(next)
    }
    constrain()
    const observer = new ResizeObserver(constrain)
    observer.observe(card)
    if (card.offsetParent !== null) observer.observe(card.offsetParent)
    window.addEventListener('resize', constrain)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', constrain)
    }
  }, [])

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false): void => {
    const current = drag.current
    const card = cardRef.current
    if (current === null || card === null || current.pointerId !== event.pointerId) return
    if (current.moved) {
      const size = { width: card.offsetWidth, height: card.offsetHeight }
      const bounds = viewportOf(card)
      const next = snapPipPosition(positionRef.current ?? originOf(card), size, bounds)
      placement.current = pipPlacement(next, size, bounds)
      modulePlacements.set(sessionId, placement.current)
      updatePosition(next)
      clickGuard.suppress()
    }
    if (cancelled && !current.moved) clickGuard.reset()
    drag.current = null
    setDragging(false)
  }

  return createElement(
    'div',
    {
      ref: cardRef,
      className: 'dsh-cua-pip-card',
      style: {
        ...styles.card,
        ...pipCardPositionStyle(position),
        cursor: dragging ? 'grabbing' : 'grab',
      },
      'data-cua-pip-float': '',
      'data-cua-pip-session': sessionId,
      'data-cua-pip-dragging': dragging ? '' : undefined,
      role: 'dialog',
      'aria-label': t('view.title'),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return
        const card = cardRef.current
        if (card === null) return
        clickGuard.reset()
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          start: originOf(card),
          moved: false,
        }
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current
        const card = cardRef.current
        if (current === null || card === null || current.pointerId !== event.pointerId) return
        if (event.buttons === 0) {
          finishDrag(event, true)
          return
        }
        const delta = { x: event.clientX - current.startX, y: event.clientY - current.startY }
        if (!current.moved && !isDragGesture(delta.x, delta.y)) return
        if (!current.moved) {
          current.moved = true
          card.setPointerCapture(event.pointerId)
          setDragging(true)
        }
        updatePosition(applyDragDelta(
          current.start,
          delta,
          { width: card.offsetWidth, height: card.offsetHeight },
          viewportOf(card),
        ))
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finishDrag(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finishDrag(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finishDrag(event, true),
      onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
        if (!clickGuard.consume()) return
        event.preventDefault()
        event.stopPropagation()
      },
      onKeyDown: (event: { key: string; stopPropagation(): void }) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        close(activity)
      },
    },
    createElement('style', null, interactionCss),
    createElement(CuaPipPanel, {
      key: `${sessionId}:${activity.openedAt ?? 0}:${activity.target?.pid ?? 0}:${activity.target?.windowId ?? 0}`,
      sessionId, t, viewport, previewSize: activity.previewSize,
    }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-cua-pip-close',
        style: styles.close,
        'aria-label': t('panel.close'),
        title: t('panel.close'),
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation(),
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          close(activity)
        },
      },
      createElement(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        createElement('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      ),
    ),
  )
}

/** Service lifetime stays at shell scope; only geometry belongs to the chat. */
function ConversationPip({
  activity, t, close,
}: {
  activity: CuaActivity
  t: (key: string) => string
  close: (activity: CuaActivity) => void
}) {
  const [bounds, setBounds] = useState<PipBounds | null>(null)
  useLayoutEffect(() => observeConversationBounds((next) => {
    setBounds((previous) => samePipBounds(previous, next) ? previous : next)
  }), [])

  // Never render against the whole shell while the conversation is mounting
  // or covered by a fullscreen panel. Its host watcher stays alive.
  if (bounds === null) return null
  return createPortal(createElement(
    'div',
    {
      'data-cua-pip-layer': '',
      style: { ...styles.layer, ...bounds },
    },
    createElement(PipCard, { activity, areaSize: bounds, t, close }),
  ), document.body)
}

export function FloatLayer({ t, getCurrentSessionId, subscribeCurrentSession }: FloatLayerProps) {
  const [activities, setActivities] = useState<CuaActivity[]>([])
  const [closing, setClosing] = useState<PendingCloses>(() => new Map())
  const activityEpoch = useRef(0)
  const alive = useRef(true)
  const readSession = useCallback(
    () => resolveCurrentSessionId(getCurrentSessionId(), window.localStorage.getItem('dsh.sessions.current')),
    [getCurrentSessionId],
  )
  const subscribeSession = useCallback((listener: () => void) => {
    const unsubscribeStore = subscribeCurrentSession?.(listener)
    // Same-document localStorage writes do not dispatch storage events. Read
    // navigation independently of the activity request, which can be slow.
    const unsubscribeFallback = subscribeFallback(listener)
    return () => {
      unsubscribeStore?.()
      unsubscribeFallback()
    }
  }, [subscribeCurrentSession])
  const currentSession = useSyncExternalStore(subscribeSession, readSession, () => undefined)

  useEffect(() => {
    alive.current = true
    let mounted = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const pull = async (): Promise<void> => {
      const epoch = activityEpoch.current
      try {
        const body = await api.activity()
        if (mounted && epoch === activityEpoch.current) setActivities(body.sessions)
      } catch {
        // Keep the last known activity through a transient network failure.
      } finally {
        if (mounted) timer = setTimeout(() => void pull(), 1000)
      }
    }
    void pull()
    return () => {
      alive.current = false
      mounted = false
      clearTimeout(timer)
    }
  }, [])

  const close = (activity: CuaActivity): void => {
    const { sessionId } = activity
    activityEpoch.current++
    setClosing((previous) => beginPreviewClose(previous, activity))
    void api.close(sessionId, activity.openedAt).then(
      (result) => {
        if (!alive.current) return
        // Invalidate activity requests that started before this close completed.
        activityEpoch.current++
        if (result.ok && result.status?.open !== true) {
          moduleRetained.delete(sessionId)
          setActivities((previous) => previous.map((row) =>
            row.sessionId === sessionId && row.openedAt === activity.openedAt ? { ...row, visible: false } : row))
        }
        setClosing((previous) => finishPreviewClose(previous, activity))
      },
      () => {
        if (!alive.current) return
        activityEpoch.current++
        setClosing((previous) => finishPreviewClose(previous, activity))
      },
    )
  }

  const chosen = pickConversationActivity(activities, currentSession)
  if (chosen === undefined || isPreviewClosing(closing, chosen) || !shouldOpenOverlay(chosen, null)) return null
  return createElement(ConversationPip, { key: chosen.sessionId, activity: chosen, t, close })
}
