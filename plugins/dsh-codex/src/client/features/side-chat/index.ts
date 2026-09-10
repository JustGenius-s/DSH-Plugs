/** Side chat as a first-class DSH 0.1.5+ right-Sidebar tab. */

import { createElement, useSyncExternalStore } from 'react'
import type {
  ClientContext,
  SettingsScope,
} from '@just-genius/dsh-plugin-runtime/client'
import type { IApiClient } from '@just-genius/dsh-plugin-runtime/client'
import { IconSideChatColor16 } from '@just-genius/dsh-plugin-ui'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import {
  registerSidebarTab,
  sidebarTabTitle,
  type SidebarTabProps,
} from '../../sidebar-right'
import {
  createSidebarTabKeepAliveRegistry,
  sidebarTabOccurrenceKey,
  SidebarTabKeepAliveMount,
} from '../../sidebar-tab-keep-alive'
import { SidePanelErrorBoundary } from '../side-panels/error-boundary'
import {
  connectionApiOf,
  conversationAttachmentsOf,
  remoteSessionApiOf,
  uiConversationOf,
} from './connection'
import { sideChatTabDefinition } from './definition'
import { modelDirectoriesOf } from './model-directory'
import { SideChatPanel, type SideChatSessionsFace } from './panel'
import {
  createSideChatTabStateRegistry,
  type SideChatTabState,
  type SideChatTabStateHandle,
} from './tab-state'
import { ensureSideChatStyles } from './styles'

const NS = 'settings.codex'
const EMPTY_STATE: Readonly<SideChatTabState> = Object.freeze({})
const emptySnapshot = (): Readonly<SideChatTabState> => EMPTY_STATE
const emptySubscribe = (): (() => void) => () => {}

function useSideChatTabState(handle: SideChatTabStateHandle | undefined): Readonly<SideChatTabState> {
  return useSyncExternalStore(
    handle?.subscribe ?? emptySubscribe,
    handle?.getSnapshot ?? emptySnapshot,
    handle?.getSnapshot ?? emptySnapshot,
  )
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
      const api = connectionApiOf(ctx) as IApiClient | undefined
      const modelDirectories = modelDirectoriesOf(ctx)
      const imageApi = remoteSessionApiOf(ctx) ?? api
      const uiConversation = uiConversationOf(ctx)
      const conversation = conversationAttachmentsOf(ctx)

      return bindEnabledSlot(
        scope,
        config => config.sideChatEnabled,
        () => {
          const retainedTabs = createSidebarTabKeepAliveRegistry()
          const tabStates = createSideChatTabStateRegistry()

          const SideChatTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const key = sidebarTabOccurrenceKey(props.sessionId, tab.id)
            const state = tabStates.acquire(key, tab.signal)?.getSnapshot()

            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: () => createElement(
                SidePanelErrorBoundary,
                { label: props.t('view.sideChat') },
                createElement(SideChatPanel, {
                  parentSessionId: props.sessionId,
                  tabKey: key,
                  initialSideSessionId: state?.sideSessionId,
                  sessions,
                  api: imageApi,
                  uiConversation,
                  modelDirectories,
                  conversation,
                  t: props.t,
                  updateTabState: tabStates.update,
                }),
              ),
            })
          }

          // DSH keeps tab titles mounted separately from the active body. The
          // metadata channel therefore gives every occurrence its live first-
          // message caption even while another tab is visible.
          const SideChatTitle = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const key = sidebarTabOccurrenceKey(props.sessionId, tab.id)
            const state = useSideChatTabState(tabStates.acquire(key, tab.signal))
            return sidebarTabTitle(
              IconSideChatColor16,
              state.title ?? props.t('view.sideChat'),
            )
          }

          const disposeRegistration = registerSidebarTab(
            ctx,
            sideChatTabDefinition(t),
            SideChatTab,
            { locale: NS, title: SideChatTitle },
          )

          return () => {
            // Unmount first: every panel closes its owned side session in its
            // effect cleanup. A normal tab switch never reaches this path.
            retainedTabs.dispose()
            tabStates.dispose()
            disposeRegistration()
          }
        },
      )
    },
  }
}

export { SideChatPanel }
export {
  SIDE_CHAT_TAB_ID,
  SIDE_CHAT_TAB_KIND,
  sideChatTabDefinition,
} from './definition'
