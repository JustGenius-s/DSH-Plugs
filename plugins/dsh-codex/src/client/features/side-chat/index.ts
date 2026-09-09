/**
 * The dsh-codex side-chat feature: registers a `side.panel` entry where each
 * open instance is ONE side chat (Codex-style /side). The panel is `multi`, so
 * opening a new "侧聊" tab in the side-panel host forks a fresh blank side
 * session (sharing the parent's cwd/sandbox, preset and model but never
 * loading the parent's history) and renders its full live conversation with
 * the same Markdown/tool primitives DSH's own chat uses. Closing the tab
 * disposes the side chat — the tab lifecycle IS the side chat lifecycle.
 */

import { createElement } from 'react'
import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { IApiClient } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'
import { SideChatPanel, type SideChatSessionsFace } from './panel'
import { closeAllSideChatInstances, SIDE_CHAT_PANEL_ID } from './instance-cleanup'
import { ensureSideChatStyles } from './styles'
import { connectionApiOf, remoteSessionApiOf, uiConversationOf } from './connection'
import { modelDirectoriesOf } from './model-directory'

const PANEL_SLOT = 'side.panel'
// Same id the cleanup reads: a panel renamed in one place but not the other
// would silently stop releasing side chats when the switch goes down.
const PANEL_ID = SIDE_CHAT_PANEL_ID
const NS = 'settings.codex'

interface ConnectionFace {
  connection?: { api?: IApiClient }
}

/** Structural face of the connection service (see ./connection.ts). */

/** Structural face of `ctx.conversation` (subset of IConversation). */
interface ConversationFace {
  createDraftImages(files: readonly File[]): readonly unknown[]
  draftImages(ids: readonly unknown[]): readonly unknown[]
  releaseDraftImage(id: unknown): void
}

export function createSideChatFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'side-chat',
    activate() {
      ensureSideChatStyles()
      const sessions = ctx.sessions as unknown as SideChatSessionsFace
      const store = ctx.sidePanels as SidePanelsStore
      // `ConnectionHandle.api` is REQUIRED, so read it through the runtime's
      // accessor (`ctx.get`, which never throws for an undeclared service)
      // rather than through an optional chain on the context proxy: a missed
      // read left the model picker silently stuck on "模型…" forever.
      const api = connectionApiOf(ctx) as IApiClient | undefined
      // The model directory moved off `connection.api` in DSH 0.1.2: that
      // envelope RPC (`sessions.models` / `selectModel`) was removed, so the
      // picker read a namespace that no longer existed and reported a missing
      // inject. `modelDirectories` is the per-session owner now.
      const modelDirectories = modelDirectoriesOf(ctx)
      // Attachment reads: the 0.1.2 Typert remote is preferred, but the legacy
      // envelope api is kept as the fallback so an image still renders on a
      // host that has not mounted the remote namespace.
      const imageApi = remoteSessionApiOf(ctx) ?? api
      // Durable image reads: the same face the MAIN transcript uses, so a
      // side-chat attachment renders as the main conversation renders it.
      const uiConversation = uiConversationOf(ctx)
      // Optional compatibility service: `Context#get()` is the Cordis API for
      // reading a service without an inject requirement. Do not fall back to
      // `ctx.conversation` here; property access is inject-guarded and throws
      // while the conversation provider is absent or still activating.
      const conversation = ctx.get('conversation') as unknown as ConversationFace | undefined

      // `multi`: every open is a NEW instance (tab), and each tab is one side
      // chat (the panel forks on mount and disposes on unmount).
      const disposeDescriptor = ctx.sidePanels.describe(PANEL_ID, {
        icon: 'chat',
        multi: true,
      })

      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          const enabled = (scope.getSnapshot().value ?? DEFAULT_CONFIG).sideChatEnabled !== false
          disposeEntry?.()
          disposeEntry = undefined
          if (!enabled) {
            // Switching the panel off also releases the side chats it owns:
            // their tabs are gone (the shell drops instances whose panel is no
            // longer registered), and a side agent nobody can reach would keep
            // running and hold its session open.
            closeAllSideChatInstances(store)
            return
          }

          disposeEntry = ctx.slots.register(
            {
              name: PANEL_SLOT,
              id: PANEL_ID,
              order: 15,
              locale: NS as never,
              label: () => t('view.sideChat'),
            },
            function SideChatPanelSlot(props: {
              sessionId: string
              cwd?: string
              instanceKey?: string
              t: (key: string) => string
            }) {
              const key = props.instanceKey
              // Restored tabs carry the side session id they own, so a page
              // reload reconnects to the same live side chat instead of
              // forking a duplicate.
              const instance = key === undefined
                ? undefined
                : store.getSnapshot().instances.find(item => item.key === key)
              return createElement(SideChatPanel, {
                parentSessionId: props.sessionId,
                instanceKey: key,
                initialSideSessionId: instance?.state?.sideSessionId,
                sessions: sessions as SideChatSessionsFace,
                api: imageApi,
                uiConversation,
                modelDirectories,
                conversation,
                t: props.t,
                // Stable method reference + key: `updateInstanceState` is the
                // same function identity every render, so the panel's effect
                // that persists sideSessionId doesn't re-fire on every render
                // (a fresh closure would → setSnapshot → re-render → new
                // closure → infinite loop that can take the whole shell down).
                updateInstanceState: store.updateInstanceState.bind(store),
              })
            } as never,
          )
        }

        syncRegistration()
        const unsubscribe = scope.subscribe(syncRegistration)
        return () => {
          unsubscribe()
          disposeEntry?.()
          disposeEntry = undefined
        }
      })

      return () => {
        disposeDescriptor()
        disposeInjection()
      }
    },
  }
}

export { SideChatPanel }
