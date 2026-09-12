/** Side chat as a first-class DSH 0.1.5+ right-Sidebar tab. */

import { createElement, useEffect, useSyncExternalStore } from 'react'
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
import { SidePanelErrorBoundary } from '../../error-boundary'
import {
  connectionApiOf,
  conversationAttachmentsOf,
  remoteSessionApiOf,
  uiConversationOf,
} from './connection'
import {
  isSideChatResourceAddress,
  sideChatResourceAddressForTab,
} from './contract'
import { sideChatTabDefinition } from './definition'
import { modelDirectoriesOf } from './model-directory'
import { SideChatPanel, type SideChatSessionsFace } from './panel'
import { pendingInteractionsOf } from './pending'
import {
  createSideChatTabStateRegistry,
  sideChatTabCaption,
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
      // DSH 0.1.5 answers approvals and questions through a session-keyed store
      // on `uiSession`. Resolved once here because the panel has no context of
      // its own, and the composer subscribes to the live store.
      const pendingInteractions = pendingInteractionsOf(ctx)

      return bindEnabledSlot(
        scope,
        config => config.sideChatEnabled,
        () => {
          const retainedTabs = createSidebarTabKeepAliveRegistry()
          const tabStates = createSideChatTabStateRegistry()

          const SideChatTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const key = sidebarTabOccurrenceKey(props.sessionId, tab.id)
            // A tab opened from the guide holds the PAGE address, and the store
            // allows one page per pane — so without this conversion a second
            // side chat could never exist. Mint the occurrence's own resource
            // address (derived from its own tab id, so a remount re-opens the
            // same one instead of multiplying tabs) and move the record onto it.
            const resourceAddress = sideChatResourceAddressForTab(
              tab.navigation.address,
              tab.id,
            )
            const isResource = isSideChatResourceAddress(tab.navigation.address)
            // Only a real window joins the numbering sequence. The guide's
            // page tab is an invisible holder replaced by its own resource tab
            // one commit later, so ranking it would shift every real window's
            // number up by one — captioning the sole side chat "侧聊 1".
            const numbering = isResource ? { sessionId: props.sessionId } : undefined
            const state = tabStates.acquire(key, tab.signal, numbering)?.getSnapshot()

            useEffect(() => {
              if (isResource) return
              tab.actions.openResource(resourceAddress, {
                replaceTab: true,
                revealIfOpened: false,
              })
            }, [isResource, resourceAddress, tab.actions])

            if (!isResource) return null

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
                  pendingInteractions,
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
            // Numbered by the SAME rule the body uses, so the two seats agree
            // on which occurrences hold a number. Both read one tab record, so
            // they cannot disagree about whether it is a resource.
            const numbering = isSideChatResourceAddress(tab.navigation.address)
              ? { sessionId: props.sessionId }
              : undefined
            const state = useSideChatTabState(
              tabStates.acquire(key, tab.signal, numbering),
            )
            return sidebarTabTitle(
              IconSideChatColor16,
              sideChatTabCaption(state, props.t),
            )
          }

          const disposeRegistration = registerSidebarTab(
            ctx,
            sideChatTabDefinition(t, IconSideChatColor16),
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
  SIDE_CHAT_RESOURCE_PATTERN,
  SIDE_CHAT_TAB_ID,
  SIDE_CHAT_TAB_KIND,
  isSideChatResourceAddress,
  sideChatResourceAddress,
  sideChatResourceAddressForTab,
} from './contract'
export { sideChatTabDefinition } from './definition'
export { sideChatTabCaption, type SideChatNumberingScope } from './tab-state'
