import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DashCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import { WarpTerminalView } from './warp-terminal-view'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

interface TerminalPanelProps {
  sessionId: string
  cwd?: string
  instanceKey?: string
  t: (key: string) => string
}

function createTerminalPanel(scope: SettingsScope<DashCodexConfig>) {
  return function TerminalPanel({ sessionId, cwd, instanceKey, t }: TerminalPanelProps) {
    const subscribe = (listener: () => void) => scope.subscribe(listener)
    const getSnapshot = () => scope.getSnapshot()
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const config = { ...DEFAULT_CONFIG, ...snapshot.value }
    // Side-panel instances share the conversation session id. Include the
    // instance key so each terminal tab has an explicit resource identity.
    const terminalId = instanceKey === undefined ? sessionId : sessionId + ':' + instanceKey

    return createElement(WarpTerminalView, {
      sessionId: terminalId,
      cwd,
      terminalShell: config.terminalShell,
      terminalScrollback: config.terminalScrollback,
      terminalFontSize: config.terminalFontSize,
      t,
    })
  }
}

export function createTerminalFeature(
  ctx: ClientContext,
  scope: SettingsScope<DashCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'terminal',
    activate() {
      const TerminalPanel = createTerminalPanel(scope)
      const disposeDescriptor = ctx.sidePanels.describe('terminal', { icon: 'terminal', multi: true })
      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          disposeEntry?.()
          disposeEntry = undefined
          if (!(scope.getSnapshot().value ?? DEFAULT_CONFIG).terminalEnabled) return

          disposeEntry = ctx.slots.register(
            {
              name: PANEL_SLOT,
              id: 'terminal',
              order: 20,
              locale: NS as never,
              label: () => t('view.warpTerminal'),
            },
            TerminalPanel as never,
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

export { WarpTerminalView }