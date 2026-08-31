import {
  getSessions,
  type ClientContext,
  type SettingsScope,
} from '@just-genius/dsh-plugin-runtime/client'
import { clampFullSessionLoadLimit, DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import { loadOlderSessionHistory } from '../../host-adapters/sessions'

/**
 * Client sessions face, read structurally: this package compiles host and
 * client entries together, so the host `sessions` merge would otherwise win.
 */
interface SessionWindow {
  getSnapshot(): {
    hasMore?: boolean
    loadingOlder?: boolean
    openState?: string
    chat?: {
      order?: readonly string[]
      nodes?: {
        get?(key: string): { kind?: string } | undefined
        values?(): ReadonlyArray<{ kind?: string } | undefined>
      }
    }
    nodes?: ReadonlyArray<{ kind?: string }>
  }
  subscribe(listener: () => void): () => void
}

function isUserNode(node: { kind?: string } | undefined): boolean {
  return node?.kind === 'user'
}

function userMessageCount(snap: ReturnType<SessionWindow['getSnapshot']>): number {
  const order = snap.chat?.order
  const nodes = snap.chat?.nodes

  if (nodes !== undefined && typeof nodes.values === 'function') {
    let count = 0
    for (const node of nodes.values()) {
      if (isUserNode(node)) count += 1
    }
    if (count > 0) return count
  }

  if (order !== undefined && typeof nodes?.get === 'function') {
    let count = 0
    for (const key of order) {
      if (isUserNode(nodes.get(key))) count += 1
    }
    if (count > 0) return count
  }

  if (Array.isArray(snap.nodes)) {
    let count = 0
    for (const node of snap.nodes) {
      if (isUserNode(node)) count += 1
    }
    if (count > 0) return count
  }

  // Prefer stopping short when nodes cannot be classified.
  return order?.length ?? 0
}

function loadLimit(scope: SettingsScope<DshCodexConfig>): number {
  const value = scope.getSnapshot().value?.fullSessionLoadLimit
  return clampFullSessionLoadLimit(
    typeof value === 'number' ? value : DEFAULT_CONFIG.fullSessionLoadLimit,
  )
}

interface ClientSessionsLike {
  list: {
    getSnapshot(): { current?: string }
    subscribe(listener: () => void): () => void
  }
  binding(id: string): { session: SessionWindow } | undefined
}

/** Stop if a page does not grow the window; the host may be stuck. */
const STALL_LIMIT = 4

export function createFullSessionLoadFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
): CodexFeature {
  return {
    id: 'full-session-load',
    activate() {
      const sessions = getSessions(ctx) as unknown as ClientSessionsLike
      let disposed = false
      let unsubSession: (() => void) | undefined
      let attachedId: string | undefined
      let inFlight = false
      let stall = 0
      let retry: ReturnType<typeof setTimeout> | undefined

      const enabled = (): boolean => (
        scope.getSnapshot().value?.fullSessionLoadEnabled
        ?? DEFAULT_CONFIG.fullSessionLoadEnabled
      )

      const detach = (): void => {
        unsubSession?.()
        unsubSession = undefined
        attachedId = undefined
        stall = 0
        if (retry !== undefined) {
          clearTimeout(retry)
          retry = undefined
        }
      }

      const later = (): void => {
        if (disposed || retry !== undefined) return
        retry = setTimeout(() => {
          retry = undefined
          pump()
        }, 50)
      }

      const attach = (id: string, session: SessionWindow): void => {
        if (attachedId === id) return
        detach()
        attachedId = id
        unsubSession = session.subscribe(pump)
      }

      const pump = (): void => {
        if (disposed || inFlight) return
        if (!enabled()) {
          detach()
          return
        }
        const id = sessions.list.getSnapshot().current
        if (id === undefined) {
          detach()
          return
        }
        if (attachedId !== undefined && attachedId !== id) detach()
        const session = sessions.binding(id)?.session
        if (session === undefined) {
          later()
          return
        }
        attach(id, session)
        const snap = session.getSnapshot()
        if (snap.openState !== undefined && snap.openState !== 'open') return
        if (snap.hasMore !== true) {
          stall = 0
          return
        }
        const limit = loadLimit(scope)
        const count = userMessageCount(snap)
        // Prefer stopping short: the next host page is not a fixed user-message
        // count and can jump well past the cap.
        if (count >= limit || (count > 0 && limit - count <= 4)) {
          stall = 0
          return
        }
        if (snap.loadingOlder === true) return
        const before = snap.chat?.order?.length ?? 0
        inFlight = true
        void loadOlderSessionHistory(sessions, id).then(() => {
          const next = session.getSnapshot()
          const after = next.chat?.order?.length ?? 0
          if (userMessageCount(next) >= loadLimit(scope)) stall = STALL_LIMIT
          else if (after <= before && next.hasMore === true) stall += 1
          else stall = 0
        }, () => {
          stall += 1
        }).finally(() => {
          inFlight = false
          if (!disposed && stall < STALL_LIMIT) later()
        })
      }

      const unsubList = sessions.list.subscribe(pump)
      const unsubScope = scope.subscribe(pump)
      pump()
      return () => {
        disposed = true
        unsubList()
        unsubScope()
        detach()
      }
    },
  }
}
