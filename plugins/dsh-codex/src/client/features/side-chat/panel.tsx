/**
 * The side-chat panel: ONE official Sidebar tab renders ONE side chat. Opening
 * a new "侧聊" tab creates an independent occurrence; this component mounts,
 * forks a fresh blank side
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
import { sideChatApi, SideChatDisabledError } from './api'
import { chatRowsOf } from './snapshot'
import type {
  ImageApi,
  SideChatConversationFace,
  UiConversationFace,
} from './connection'
import { SideChatComposer } from './composer'
import { SideChatTranscript } from './transcript'
import { describeError, type ErrorDetail } from '../../error-boundary'
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

/**
 * Describe a failure for the panel's error bar.
 *
 * Reuses the boundary's formatter so an async failure and a render failure
 * produce the same shape — one place to look, both carrying a stack.
 */
function describePanelError(cause: unknown): ErrorDetail {
  return describeError(cause)
}

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
  /** Collision-free identity of this official `(Session, tab.id)` occurrence. */
  tabKey: string
  /** The occurrence's already-owned side session id, if its body remounts. */
  initialSideSessionId?: string
  sessions: SideChatSessionsFace
  /**
   * The legacy `connection.api` face, kept only for attachment reads. DSH
   * 0.1.2 removed its `sessions.*` RPCs, so it no longer serves the model
   * directory — that goes through `modelDirectories` below.
   */
  api?: unknown
  /** The `ctx.uiConversation` image face (durable image reads). */
  uiConversation?: unknown
  /** The `ctx.modelDirectories` resolver (model directory / selection). */
  modelDirectories?: unknown
  /** The validated `ctx.conversation` draft-attachment face. */
  conversation?: SideChatConversationFace
  t: (key: string) => string
  /** Stable metadata channel shared with the separately-mounted official title. */
  updateTabState: (key: string, patch: { title?: string; sideSessionId?: string }) => void
}

/**
 * One side chat tab. Forks a fresh side session on mount (unless a restored
 * instance already owns one) and disposes it on unmount; renders its
 * transcript + composer for its whole lifetime.
 */
export function SideChatPanel({
  parentSessionId,
  tabKey,
  initialSideSessionId,
  sessions,
  api,
  uiConversation,
  modelDirectories,
  conversation,
  t,
  updateTabState,
}: SideChatPanelProps) {
  const [sideSessionId, setSideSessionId] = useState<string | null>(
    initialSideSessionId ?? null,
  )
  // Carries the stack, not just the message: these panels fail in ways a
  // one-line message cannot locate.
  const [error, setError] = useState<ErrorDetail | null>(null)
  // Side chat is switched off in the settings. Held apart from `error` on
  // purpose: a feature the user turned off is a state to explain, not a
  // failure to report — putting it in the error bar would offer a stack for
  // something that worked exactly as configured.
  const [disabled, setDisabled] = useState(false)
  // Whether the parent's conversation context reached this side chat, as the
  // host reported it at open time.
  const [contextState, setContextState] = useState<SideChatContextState | null>(null)

  // Publish the owned side session id so a disposable official body wrapper
  // can reconnect to this occurrence if it ever remounts. Normal tab switches
  // retain this component and do not run its cleanup.
  const persistedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (sideSessionId === null) return
    if (persistedIdRef.current === sideSessionId) return
    persistedIdRef.current = sideSessionId
    updateTabState(tabKey, { sideSessionId })
  }, [sideSessionId, tabKey, updateTabState])

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
        // A switched-off side chat is not a failure: record it as a state and
        // leave the error bar empty, so the pane explains itself instead of
        // showing an empty message with an empty stack.
        if (cause instanceof SideChatDisabledError) {
          if (alive) setDisabled(true)
          return
        }
        // Keep the stack: a bare message cannot say whether the fork, the list
        // wait, or the context injection failed, which is exactly what made
        // these reports unlocatable.
        if (alive) setError(describePanelError(cause))
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

  // The conversation content (order/nodes) is NOT on `session.getSnapshot()` —
  // since DSH 0.1.2 that snapshot is the control face only (queue, running,
  // openState…), with no `chat` field, which is exactly why a sent message
  // never rendered. Chat rows come from the uiConversation service's chat
  // target instead — the same source the main conversation's `useChat` reads.
  const chatTarget = useMemo<Observable<unknown> | undefined>(() => {
    if (sideSessionId === null) return undefined
    const svc = uiConversation as
      | { binding(id: string): { target(name: string): Observable<unknown> } | undefined }
      | undefined
    try {
      return svc?.binding(sideSessionId)?.target('chat')
    } catch {
      // The binding resolves the session lazily; a not-yet-listed side chat
      // throws, and the empty hero below is the correct stand-in until it lands.
      return undefined
    }
  }, [sideSessionId, uiConversation])
  const chatSnapshot = useSyncExternalStore<import('./snapshot').ChatLike | undefined>(
    (fn) => (chatTarget === undefined ? () => {} : chatTarget.subscribe(fn)),
    () => (chatTarget === undefined ? undefined : chatTarget.getSnapshot() as import('./snapshot').ChatLike | undefined),
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

  // Tab caption: publish the side chat's first own user message to the official
  // title seat, which is mounted independently from this retained body.
  const firstUserText = useMemo(() => {
    if (chatSnapshot === undefined) return ''
    // The title reads the chat target, not the control snapshot: the control
    // face has no `nodes`, so the old read always found nothing.
    for (const node of chatRowsOf<{ kind?: string; data?: unknown }>(chatSnapshot)) {
      if (node.kind !== 'user') continue
      const content = (node.data as { content?: readonly unknown[] } | undefined)?.content ?? []
      const text = content
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
  }, [chatSnapshot])
  const persistedTitleRef = useRef<string | null>(null)
  useEffect(() => {
    if (firstUserText.length === 0) return
    if (persistedTitleRef.current === firstUserText) return
    persistedTitleRef.current = firstUserText
    updateTabState(tabKey, { title: firstUserText })
  }, [firstUserText, tabKey, updateTabState])

  const handleError = useCallback((message: string) => setError({ message }), [])

  return (
    <div className="dsh-codex-sidechat" data-sidechat-root="">
      {error !== null && (
        <div className="dsh-codex-sidechat-error">
          <div className="dsh-codex-sidechat-error-body">
            <span className="dsh-codex-sidechat-error-message">{error.message}</span>
            {error.stack !== undefined && (
              <details className="dsh-codex-sidechat-error-stackwrap">
                <summary>调用栈</summary>
                <pre className="dsh-codex-sidechat-error-stack">{error.stack}</pre>
              </details>
            )}
          </div>
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

      {disabled ? (
        // Reuse the empty-panel slot: the pane has nothing to show and nothing
        // to retry, so it says what the user can do about it.
        <div className="dsh-codex-sidechat-empty-panel">
          <p>{t('sideChat.disabled')}</p>
        </div>
      ) : session === undefined ? (
        <div className="dsh-codex-sidechat-empty-panel">
          <p>{t('sideChat.loading')}</p>
        </div>
      ) : (
        <div className="dsh-codex-sidechat-conversation">
          <SideChatTranscript
            snapshot={snapshot}
            chat={chatSnapshot}
            t={t}
            sessionId={sideSessionId ?? undefined}
            api={api as ImageApi | undefined}
            uiConversation={uiConversation as UiConversationFace | undefined}
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
            modelDirectories={modelDirectories as import('./model-directory').ModelDirectoryResolverFace | undefined}
            conversation={conversation}
            onError={handleError}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
