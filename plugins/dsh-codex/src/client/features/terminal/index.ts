import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { PanelNavState } from '../side-panels/service'
import { WarpTerminalView } from './warp-terminal-view'
import type { TerminalControllerStore } from './controller'
import { createTerminalReference, type TerminalReferenceApi } from './reference'
import { bindEnabledSlot } from '../../bind-enabled-slot'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

interface TerminalPanelProps {
  sessionId: string
  cwd?: string
  instanceKey?: string
  state?: PanelNavState
  t: (key: string) => string
}

function createTerminalPanel(scope: SettingsScope<DshCodexConfig>, controllerStore: TerminalControllerStore, terminalReference: TerminalReferenceApi) {
  return function TerminalPanel({ sessionId, cwd, instanceKey, state, t }: TerminalPanelProps) {
    const subscribe = (listener: () => void) => scope.subscribe(listener)
    const getSnapshot = () => scope.getSnapshot()
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const config = { ...DEFAULT_CONFIG, ...snapshot.value }
    // Side-panel instances share the conversation session id. Include the
    // instance key so each terminal tab has an explicit resource identity.
    const terminalId = instanceKey === undefined ? sessionId : sessionId + ':' + instanceKey

    return createElement(WarpTerminalView, {
      sessionId: terminalId,
      cwd: state?.cwd ?? cwd,
      terminalShell: config.terminalShell,
      terminalScrollback: config.terminalScrollback,
      terminalFontSize: config.terminalFontSize,
      controllerStore,
      controllerId: terminalId,
      t,
      onAddToContext: (text: string): boolean =>
        terminalReference.insert(sessionId, text, t('context.chipLabel')),
    })
  }
}

export function createTerminalFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
  controllerStore: TerminalControllerStore,
): CodexFeature {
  return {
    id: 'terminal',
    requires: ['sidePanels'],
    activate() {
      const terminalReference = createTerminalReference(ctx)
      const TerminalPanel = createTerminalPanel(scope, controllerStore, terminalReference)
      const disposeDescriptor = ctx.sidePanels.describe('terminal', { icon: 'terminal', multi: true })
      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => bindEnabledSlot(
        scope,
        config => config.terminalEnabled,
        () => ctx.slots.register(
          {
            name: PANEL_SLOT,
            id: 'terminal',
            order: 20,
            locale: NS as never,
            label: () => t('view.warpTerminal'),
          },
          TerminalPanel as never,
        ),
      ))

      return () => {
        terminalReference.dispose()
        disposeDescriptor()
        disposeInjection()
      }
    },
  }
}

export { WarpTerminalView }
