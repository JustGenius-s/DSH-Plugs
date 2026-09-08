/**
 * The side-chat panel: ONE side-panels tab renders ONE side chat. Because the
 * side-chat feature is `multi`, opening a new "侧聊" instance in the side-panel
 * host creates a new tab; this component mounts, forks a fresh blank side
 * session on the host (sharing the parent's cwd/sandbox, preset and model but
 * never loading the parent's history), binds it through `sessions.binding()`,
 * renders its Chat presentation nodes with the same Markdown / Think / tool
 * row primitives as the main conversation, and posts through the standard
 * `prompt`/conversation verbs so the side agent runs concurrently without
 * interrupting the main task.
 *
 * Closing the tab unmounts this component, which disposes the side chat on the
 * host (agent disposed + session archived) — the tab lifecycle IS the side
 * chat lifecycle, so there are no #-numbered sub-rows and no extra chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@just-genius/dsh-plugin-runtime/client'
import { sideChatApi } from './api'
import { SideChatComposer } from './composer'
import { SideChatTranscript } from './transcript'
import type { SideChatContextState } from '../../../shared/side-chat'

/** Minimal observable the panel subscribes to (structural subset). */
interface Observable<T> {
  subscribe(fn: () => void): () => void
  getSnapshot(): T
}

/** Minimal session face the panel uses (structural subset of SessionFace). */
export interface SideChatSession {
  sessionId?: string
  open(): Promise<void>
  subscribe(fn: () => void): () => void
  getSnapshot(): ConversationSnapshot
  prompt(content: readonly unknown[], mode: 'queue' | 'steer'): Promise<unknown>
  cancel(): Promise<unknown>
  command?(line: string): Promise<unknown>
  projections?: import('./permission-select').PermissionProjectionFace
}

/** The runtime `sessions` face the panel needs (structural subset of ISessions). */
export interface SideChatSessionsFace {
  list: Observable<{ current?: string; byId: Record<string, { displayTitle?: string }> }>
  binding(id: string): { session: SideChatSession } | undefined
}

/** How long to wait for a freshly opened side session to appear in the list. */
const LIST_POLL_MS = 200
const LIST_POLL_MAX = 25

/** Wait until a session id is listed (the host pushes session/created async). */
function waitForListed(sessions: SideChatSessionsFace, id: string): Promise<void> {
  return new Promise((resolve) => {
    let tries = 0
    const tick = (): void => {
      tries += 1
      if (sessions.list.getSnapshot().byId[id] !== undefined || tries >= LIST_POLL_MAX) {
        resolve()
        return
      }
      setTimeout(tick, LIST_POLL_MS)
    }
    tick()
  })
}

export interface SideChatPanelProps {
  /** The parent session this side chat is forked from (the main conversation). */
  parentSessionId: string
  /** The side-panels instance key this tab renders (`<panelId>#<n>`). */
  instanceKey?: string
  /** A restored tab's owned side session id (from the persisted instance state). */
  initialSideSessionId?: string
  sessions: SideChatSessionsFace
  /** The `IApiClient` face (model directory / selection). */
  api?: unknown
  /** The `ctx.conversation` face (draft-image attachment handling). */
  conversation?: unknown
  t: (key: string) => string
  /**
   * Stable `store.updateInstanceState` method (bound once by the host) so the
   * persist effect below can depend on it without re-firing every render.
   * The instance key travels via `instanceKey`.
   */
  updateInstanceState?: (key: string, patch: { title?: string; sideSessionId?: string }) => void
}

/**
 * One side chat tab. Forks a fresh side session on mount (unless a restored
 * instance already owns one) and disposes it on unmount; renders its
 * transcript + composer for its whole lifetime.
 */
export function SideChatPanel({
  parentSessionId,
  instanceKey,
  initialSideSessionId,
  sessions,
  api,
  conversation,
  t,
  updateInstanceState,
}: SideChatPanelProps) {
  const [sideSessionId, setSideSessionId] = useState<string | null>(
    initialSideSessionId ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  // Whether the parent's conversation context reached this side chat, as the
  // host reported it at open time.
  const [contextState, setContextState] = useState<SideChatContextState | null>(null)

  // Persist the owned side session id so a restored tab reconnects to the same
  // live side chat instead of forking a duplicate. Only fires when the id
  // actually changes (stable method identity + value compare).
  const persistedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (sideSessionId === null || instanceKey === undefined || updateInstanceState === undefined) return
    if (persistedIdRef.current === sideSessionId) return
    persistedIdRef.current = sideSessionId
    updateInstanceState(instanceKey, { sideSessionId })
  }, [sideSessionId, instanceKey, updateInstanceState])

  // Fork a fresh blank side session once on mount, unless a restored instance
  // already owns one. Guard against double-mount (StrictMode / HMR).
  const forkingRef = useRef(false)
  useEffect(() => {
    // The no-session bucket arrives as an empty string, not undefined: forking
    // from "" would ask the Host for a parent that cannot exist.
    if (parentSessionId === undefined || parentSessionId === '' || forkingRef.current) return
    if (sideSessionId !== null) return
    forkingRef.current = true
    let alive = true
    void (async () => {
      try {
        const opened = await sideChatApi.open(parentSessionId)
        const id = opened.sideSessionId
        if (!alive) {
          // Component unmounted before the fork settled — don't leak the side chat.
          void sideChatApi.close(id).catch(() => {})
          return
        }
        await waitForListed(sessions, id)
        if (!alive) {
          void sideChatApi.close(id).catch(() => {})
          return
        }
        setContextState(opened.context)
        setSideSessionId(id)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => {
      alive = false
    }
  }, [parentSessionId, sessions, sideSessionId])

  // Resolve the side session and open its event window once.
  const binding = sideSessionId === null ? undefined : sessions.binding(sideSessionId)
  const session = binding?.session
  useEffect(() => {
    if (session !== undefined) void session.open()
  }, [session])

  const snapshot = useSyncExternalStore<ConversationSnapshot | undefined>(
    (fn) => (session === undefined ? () => {} : session.subscribe(fn)),
    () => (session === undefined ? undefined : session.getSnapshot()),
  )

  // Disposing on unmount: closing the tab releases the side chat (agent
  // disposed + session archived on the host).
  useEffect(() => {
    return () => {
      const id = sideSessionId
      if (id === null) return
      void sideChatApi.close(id).catch(() => {})
    }
  }, [sideSessionId])

  const running = snapshot?.running === true

  // Tab caption: the side chat's first own user message (its title), persisted
  // to the side-panels host so the tab reads meaningfully instead of "侧聊 1".
  // Guarded with a ref: `updateInstanceState` arrives as a fresh bound function
  // every render, so without a value compare this effect would call into the
  // store each render → emit → shell re-render → new bound function → infinite
  // loop that takes the whole side-panels shell down with it.
  const firstUserText = useMemo(() => {
    if (snapshot === undefined) return ''
    // Defensive: `nodes` is absent until the conversation view composes, and
    // iterating it directly crashes the panel on open with the same
    // undefined-read the transcript guards against.
    for (const node of (snapshot.nodes ?? []) as readonly unknown[]) {
      const n = node as { kind?: string; content?: readonly unknown[] } | null
      if (n == null || n.kind !== 'user') continue
      const text = (n.content ?? [])
        .filter((block): block is { type?: string; text?: string } =>
          typeof block === 'object' && block !== null
          && (block as { type?: unknown }).type === 'text')
        .map(block => String(block.text ?? ''))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
      if (text.length > 0) return text.length > 24 ? text.slice(0, 24) + '…' : text
    }
    return ''
  }, [snapshot])
  const persistedTitleRef = useRef<string | null>(null)
  useEffect(() => {
    if (firstUserText.length === 0) return
    if (instanceKey === undefined || updateInstanceState === undefined) return
    if (persistedTitleRef.current === firstUserText) return
    persistedTitleRef.current = firstUserText
    updateInstanceState(instanceKey, { title: firstUserText })
  }, [firstUserText, instanceKey, updateInstanceState])

  const handleError = useCallback((message: string) => setError(message), [])

  return (
    <div className="dsh-codex-sidechat" data-sidechat-root="">
      {error !== null && (
        <div className="dsh-codex-sidechat-error">
          {error}
          <button
            type="button"
            className="dsh-codex-sidechat-error-dismiss"
            onClick={() => setError(null)}
            aria-label={t('sideChat.dismiss')}
          >
            ✕
          </button>
        </div>
      )}

      {session === undefined ? (
        <div className="dsh-codex-sidechat-empty-panel">
          <p>{t('sideChat.loading')}</p>
        </div>
      ) : (
        <div className="dsh-codex-sidechat-conversation">
          <SideChatTranscript
            snapshot={snapshot}
            t={t}
            sessionId={sideSessionId ?? undefined}
            api={api as import('./transcript').ImageApi | undefined}
            contextState={contextState ?? undefined}
          />
          <SideChatComposer
            session={{
              sessionId: sideSessionId ?? '',
              prompt: session.prompt.bind(session),
              cancel: session.cancel.bind(session),
              command: session.command === undefined ? undefined : session.command.bind(session),
              projections: session.projections,
            }}
            running={running}
            pending={snapshot?.pending}
            runningCalls={snapshot?.runningCalls}
            api={api as import('@just-genius/dsh-plugin-runtime/client').IApiClient | undefined}
            conversation={conversation as import('./composer').SideChatConversationFace | undefined}
            onError={handleError}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
