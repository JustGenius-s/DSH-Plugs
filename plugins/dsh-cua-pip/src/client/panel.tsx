// An edge-to-edge capture. The host owns the watch lifetime; mounting or
// returning to this panel only reads the existing watch and never opens one.

import { createElement, useEffect, useRef, useState } from 'react'
import { api, subscribeFrames } from './bridge.ts'
import type { FrameFeedConnection } from './frame-feed.ts'
import { resolvePipPreviewSize, type PipSize } from './float-layout.ts'
import {
  createRetainedTargets,
  emptyPanelSnapshot,
  panelFrameWarning,
  panelCaptureLabel,
  panelSnapshotForSession,
  panelSnapshotFromFrame,
  updatePanelSnapshot,
  type RetainedTargets,
} from './panel-state.ts'

export interface CuaPipPanelProps {
  sessionId: string
  t: (key: string) => string
  retained?: RetainedTargets
  clickGuard?: { consume(): boolean }
  viewport?: PipSize
  previewSize?: PipSize
}

/** Selection metadata survives navigation. It never triggers automatic watch. */
export const moduleRetained = createRetainedTargets()

const noDrag = { WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as const
const styles = {
  root: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    minHeight: 0,
    padding: 0,
    outlineOffset: -3,
    background: '#111113',
    color: 'inherit',
    cursor: 'inherit',
    ...noDrag,
  },
  shot: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    pointerEvents: 'none',
    ...noDrag,
  },
  empty: {
    opacity: 0.65,
    fontSize: 12,
    padding: 20,
    textAlign: 'center',
    ...noDrag,
  },
  warning: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: 'calc(100% - 16px)',
    padding: '4px 7px',
    borderRadius: 6,
    background: 'rgba(26,26,30,.64)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: '#fff',
    fontSize: 11,
    lineHeight: 1.4,
    pointerEvents: 'none',
    ...noDrag,
  },
} as const

export function CuaPipPanel({
  sessionId,
  t,
  retained = moduleRetained,
  clickGuard,
  viewport,
  previewSize,
}: CuaPipPanelProps) {
  const [snapshot, setSnapshot] = useState(() => emptyPanelSnapshot(sessionId))
  const [connection, setConnection] = useState<FrameFeedConnection>('connecting')
  const [now, setNow] = useState(Date.now)
  const currentSession = useRef(sessionId)
  currentSession.current = sessionId
  const visible = panelSnapshotForSession(snapshot, sessionId)

  useEffect(() => {
    setSnapshot(emptyPanelSnapshot(sessionId))
    const feed = subscribeFrames(sessionId, {
      onFrame: (body) => {
        if (currentSession.current !== sessionId) return
        const next = panelSnapshotFromFrame(sessionId, body)
        if (next.target === null) retained.delete(sessionId)
        else retained.set(sessionId, next.target)
        setSnapshot((current) => updatePanelSnapshot(current, sessionId, body))
        setNow(Date.now())
      },
      onConnection: setConnection,
    })
    // A silent/frozen feed needs a visible warning even if no event arrives.
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => {
      feed.close()
      clearInterval(timer)
    }
  }, [sessionId, retained])

  const onFocus = (): void => {
    if (clickGuard?.consume() || !visible.watching) return
    void api.focus(sessionId, visible.target ?? undefined).then(
      (body) => {
        if (!body.ok && currentSession.current === sessionId) {
          setSnapshot((current) => ({ ...current, error: t('panel.focusFailed') }))
        }
      },
      () => {
        if (currentSession.current === sessionId) {
          setSnapshot((current) => ({ ...current, error: t('panel.focusFailed') }))
        }
      },
    )
  }

  const frame = visible.frame
  const warning = panelFrameWarning(visible, now, connection)
  const preview = resolvePipPreviewSize(frame?.width ?? 0, frame?.height ?? 0, previewSize, viewport)
  const label = frame === null ? t(panelCaptureLabel(visible)) : `${frame.appName} — ${frame.windowTitle}`

  return createElement(
    'div',
    {
      style: { ...styles.root, width: preview.width, height: preview.height },
      'data-cua-pip-panel': '',
      'data-cua-pip-preview-size': `${preview.width}x${preview.height}`,
      'data-cua-pip-watching': visible.watching ? '' : undefined,
      role: 'button',
      tabIndex: visible.watching ? 0 : -1,
      'aria-label': label,
      'aria-disabled': !visible.watching,
      title: visible.error ?? label,
      onClick: onFocus,
      onKeyDown: (event: { key: string; preventDefault(): void }) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onFocus()
      },
    },
    frame !== null
      ? createElement('img', {
          style: styles.shot,
          src: `data:${frame.mime};base64,${frame.base64}`,
          alt: '',
          draggable: false,
        })
      : createElement('div', { style: styles.empty, role: 'status' }, t(panelCaptureLabel(visible))),
    warning === null ? null : createElement('div', {
      style: styles.warning,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': true,
    }, t(warning === 'reconnecting' ? 'panel.reconnecting' : 'panel.interrupted')),
  )
}
