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
import { ensureSideChatStyles } from './styles'

const PANEL_SLOT = 'side.panel'
const PANEL_ID = 'side-chat'
const NS = 'settings.codex'

interface ConnectionFace {
  connection?: { api?: IApiClient }
}

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
      const api = (ctx as unknown as ConnectionFace).connection?.api
      const conversation = (ctx.get('conversation') as unknown as ConversationFace | undefined)
        ?? (ctx.conversation as unknown as ConversationFace | undefined)

      // `multi`: every open is a NEW instance (tab), and each tab is one side
      // chat (the panel forks on mount and disposes on unmount).
      const disposeDescriptor = ctx.sidePanels.describe(PANEL_ID, {
        icon: 'chat',
        multi: true,
      })

      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          disposeEntry?.()
          disposeEntry = undefined
          if (!(scope.getSnapshot().value ?? DEFAULT_CONFIG).sideChatEnabled) return

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
                api,
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
