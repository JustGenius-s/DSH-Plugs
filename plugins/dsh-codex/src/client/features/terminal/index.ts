import { createElement, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { PanelNavState, SidePanelsService } from '../side-panels/service'
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

function createTerminalPanel(scope: SettingsScope<DshCodexConfig>, controllerStore: TerminalControllerStore, terminalReference: TerminalReferenceApi, sidePanels: SidePanelsService) {
  return function TerminalPanel({ sessionId, cwd, instanceKey, state, t }: TerminalPanelProps) {
    const subscribe = (listener: () => void) => scope.subscribe(listener)
    const getSnapshot = () => scope.getSnapshot()
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const config = { ...DEFAULT_CONFIG, ...snapshot.value }
    // Side-panel instances share the conversation session id. Include the
    // instance key so each terminal tab has an explicit resource identity.
    const terminalId = instanceKey === undefined ? sessionId : sessionId + ':' + instanceKey
    // The view publishes its running command here; the guard below turns that
    // into the confirmation the shell shows before closing this tab.
    const busyRef = useRef<string | null>(null)
    // Filled by the view; run when this tab is deliberately closed so the
    // shell stops instead of being left detached.
    const terminateRef = useRef<(() => void) | null>(null)
    useEffect(() => {
      if (instanceKey === undefined) return
      return sidePanels.onInstanceClose(sessionId + ':' + instanceKey, () => {
        terminateRef.current?.()
      })
    }, [sidePanels, sessionId, instanceKey])
    useEffect(() => {
      if (instanceKey === undefined) return
      return sidePanels.guardClose(sessionId + ':' + instanceKey, () => {
        const command = busyRef.current
        if (command === null) return null
        return {
          title: t('terminal.closeRunningTitle'),
          description: t('terminal.closeRunning').replace('{command}', command),
        }
      })
    }, [sidePanels, sessionId, instanceKey, t])

    return createElement(WarpTerminalView, {
      sessionId: terminalId,
      cwd: state?.cwd ?? cwd,
      terminalShell: config.terminalShell,
      terminalScrollback: config.terminalScrollback,
      terminalFontSize: config.terminalFontSize,
      controllerStore,
      controllerId: terminalId,
      busyRef,
      terminateRef,
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
      const TerminalPanel = createTerminalPanel(scope, controllerStore, terminalReference, ctx.sidePanels)
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
