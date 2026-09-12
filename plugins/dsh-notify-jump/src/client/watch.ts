import type { SessionListState } from '@just-genius/dsh-plugin-runtime/client'
import { pendingAdvance, pendingCopy, type ObservedPending, type PendingKind } from './pending'
import { notificationTag } from './tag'

export interface SessionsListFace {
  readonly list: {
    getSnapshot(): SessionListState
    subscribe(listener: () => void): () => void
  }
}

/**
 * Watch the session list for approval / ask / plan-review waits and show a
 * desktop notification on the rising edge. Uses the same tag as turn-end
 * banners so the Notification wrap still opens the session.
 */
export function startPendingWatcher(
  sessions: SessionsListFace,
  onConnectionReset: (listener: () => void) => () => void,
): () => void {
  const observed = new Map<string, ObservedPending>()

  const reseed = () => {
    observed.clear()
  }

  const stopReset = onConnectionReset(reseed)
  const off = sessions.list.subscribe(() => {
    const state = sessions.list.getSnapshot()
    for (const id of state.ids) {
      const summary = state.byId[id]
      if (summary === undefined) continue
      const next = asPendingKind(summary.pendingInteraction)
      const { observed: nextObserved, fresh } = pendingAdvance(observed.get(id), next)
      observed.set(id, nextObserved)
      if (!fresh) continue
      if (summary.origin === 'subagent') continue
      if (!shouldShow(id, state.current)) continue
      const kind = next as PendingKind
      const copy = pendingCopy(kind, summary.title ?? summary.displayTitle ?? '')
      show(copy.title, copy.body, id)
    }
    const live = new Set(state.ids.map(String))
    for (const id of [...observed.keys()]) {
      if (!live.has(id)) observed.delete(id)
    }
  })

  return () => {
    off()
    stopReset()
  }
}

function asPendingKind(value: string | undefined): PendingKind | undefined {
  if (value === 'approval' || value === 'plan-review' || value === 'question') return value
  return undefined
}

function shouldShow(sessionId: string, currentSessionId: string | undefined): boolean {
  const api = window.Notification
  if (typeof api !== 'function' || api.permission !== 'granted') return false
  if (!document.hidden && sessionId === currentSessionId) return false
  return true
}

function show(title: string, body: string, sessionId: string): void {
  const api = window.Notification
  if (typeof api !== 'function' || api.permission !== 'granted') return
  new api(title, {
    body,
    tag: notificationTag(sessionId),
    requireInteraction: true,
  })
}
