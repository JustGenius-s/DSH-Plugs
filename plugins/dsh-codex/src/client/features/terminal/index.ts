import { createElement, useEffect, useSyncExternalStore } from 'react'
import type {
  ClientContext,
  SettingsScope,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import { IconTerminalColor16 } from '@just-genius/dsh-plugin-ui'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
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
  SidebarTabKeepAliveMount,
} from '../../sidebar-tab-keep-alive'
import type { QuickActionsContribution } from '../quick-actions/contribution'
import { WarpTerminalView } from './warp-terminal-view'
import type { TerminalControllerStore } from './controller'
import {
  TERMINAL_TAB_ID,
  TERMINAL_TAB_KIND,
  TERMINAL_RESOURCE_PATTERN,
  isTerminalResourceAddress,
  terminalControllerId,
  terminalCwd,
  terminalResourceAddressForTab,
  terminalResourceControllerId,
} from './contract'
import { createTerminalLifetimeRegistry } from './lifetime'
import { createTerminalReference } from './reference'

const NS = 'settings.codex'

export function terminalTabDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: TERMINAL_TAB_ID,
    kind: TERMINAL_TAB_KIND,
    patterns: [TERMINAL_RESOURCE_PATTERN],
    priority: 'extension',
    canOpen: isTerminalResourceAddress,
    title: () => t('view.warpTerminal'),
    guide: [{
      order: 20,
      title: () => t('view.warpTerminal'),
      icon: IconTerminalColor16,
    }],
  }
}

export function createTerminalFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
  controllerStore: TerminalControllerStore,
  quickActions: QuickActionsContribution,
): CodexFeature {
  return {
    id: 'terminal',
    activate() {
      const terminalReference = createTerminalReference(ctx)
      const disposeTab = bindEnabledSlot(
        scope,
        config => config.terminalEnabled,
        () => {
          const lifetimes = createTerminalLifetimeRegistry()
          const retainedTabs = createSidebarTabKeepAliveRegistry()

          const TerminalTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const resourceAddress = terminalResourceAddressForTab(
              tab.navigation.address,
              tab.id,
            )
            const isResource = resourceAddress === tab.navigation.address
            const sessionCwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
            const cwd = terminalCwd(tab.navigation.params, sessionCwd)
            const settings = useSyncExternalStore(
              listener => scope.subscribe(listener),
              () => scope.getSnapshot(),
              () => scope.getSnapshot(),
            )
            const config = { ...DEFAULT_CONFIG, ...settings.value }
            // The controller registry is keyed by resource address, not tab id:
            // `openResource` resolves navigation asynchronously, so whoever
            // opened this terminal cannot read the tab id it will get. The
            // address is minted by the opener and reported back here, so both
            // sides agree on one key without reading post-navigation state.
            // The PTY identity (below) stays tab-based: it owns the Host
            // session token and the tab-close lifetime.
            const terminalId = terminalControllerId(props.sessionId, tab.id)
            const controllerId = isResource
              ? terminalResourceControllerId(props.sessionId, resourceAddress)
              : terminalId

            useEffect(() => {
              if (isResource) {
                lifetimes.watch(tab.signal, terminalId)
                return
              }
              tab.actions.openResource(resourceAddress, {
                replaceTab: true,
                revealIfOpened: false,
                params: tab.navigation.params,
              })
            }, [
              isResource,
              resourceAddress,
              tab.actions,
              tab.navigation.params,
              tab.signal,
              terminalId,
            ])

            if (!isResource) return null

            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: visible => createElement(
                'div',
                { className: 'dsh-codex-terminal-tab' },
                createElement(
                  'div',
                  { className: 'dsh-codex-terminal-toolbar' },
                  quickActions.render({
                    sessionId: props.sessionId,
                    terminalId: controllerId,
                    cwd,
                    visible,
                  }),
                ),
                createElement(WarpTerminalView, {
                  sessionId: terminalId,
                  cwd,
                  terminalShell: config.terminalShell,
                  terminalScrollback: config.terminalScrollback,
                  terminalFontSize: config.terminalFontSize,
                  controllerStore,
                  controllerId,
                  visible,
                  t: props.t,
                  onAddToContext: (text: string): boolean =>
                    terminalReference.insert(props.sessionId, text, t('context.chipLabel')),
                }),
              ),
            })
          }

          // Titles remain mounted for every tab in the strip, including
          // inactive bodies, making this the durable signal-to-Host bridge.
          const TerminalTitle = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const terminalId = terminalControllerId(props.sessionId, tab.id)
            const isResource = isTerminalResourceAddress(tab.navigation.address)
            useEffect(() => {
              if (isResource) lifetimes.watch(tab.signal, terminalId)
            }, [isResource, tab.signal, terminalId])
            return sidebarTabTitle(IconTerminalColor16, props.t('view.warpTerminal'))
          }

          const disposeRegistration = registerSidebarTab(
            ctx,
            terminalTabDefinition(t),
            TerminalTab,
            { locale: NS, title: TerminalTitle },
          )
          return () => {
            disposeRegistration()
            retainedTabs.dispose()
            lifetimes.dispose()
          }
        },
      )

      return () => {
        disposeTab()
        terminalReference.dispose()
      }
    },
  }
}

export { WarpTerminalView }
