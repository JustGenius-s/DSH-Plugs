import { createElement, useEffect, useSyncExternalStore } from 'react'
import type {
  ClientContext,
  SettingsScope,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import { IconApiOutline14 } from '@just-genius/dsh-plugin-ui'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import { registerSidebarTab, type SidebarTabProps } from '../../sidebar-right'
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
  terminalControllerId,
  terminalCwd,
} from './contract'
import { createTerminalLifetimeRegistry } from './lifetime'
import { createTerminalReference } from './reference'

const NS = 'settings.codex'

export function terminalTabDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: TERMINAL_TAB_ID,
    kind: TERMINAL_TAB_KIND,
    priority: 'extension',
    title: () => t('view.warpTerminal'),
    guide: [{
      order: 20,
      title: () => t('view.warpTerminal'),
      description: () => t('sidebar.terminalDescription'),
      icon: IconApiOutline14,
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
            const sessionCwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
            const cwd = terminalCwd(tab.navigation.params, sessionCwd)
            const settings = useSyncExternalStore(
              listener => scope.subscribe(listener),
              () => scope.getSnapshot(),
              () => scope.getSnapshot(),
            )
            const config = { ...DEFAULT_CONFIG, ...settings.value }
            const terminalId = terminalControllerId(props.sessionId, tab.id)

            useEffect(() => {
              lifetimes.watch(tab.signal, terminalId)
            }, [tab.signal, terminalId])

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
                    terminalId,
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
                  controllerId: terminalId,
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
            useEffect(() => {
              lifetimes.watch(tab.signal, terminalId)
            }, [tab.signal, terminalId])
            return props.t('view.warpTerminal')
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
