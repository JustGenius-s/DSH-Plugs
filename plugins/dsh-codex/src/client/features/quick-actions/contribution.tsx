import { createElement, type ReactNode } from 'react'
import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig, QuickAction } from '../../../shared/config'
import type { TerminalControllerStore } from '../terminal/controller'
import { TERMINAL_TAB_KIND, terminalControllerId } from '../terminal/contract'
import { QuickActionsControls } from './controls'
import { createQuickActionsStore } from './store'

export interface QuickActionsTerminalContext {
  sessionId: string
  terminalId: string
  cwd?: string
  visible?: boolean
}

export interface QuickActionsContribution {
  render(context: QuickActionsTerminalContext): ReactNode
  dispose(): void
}

export function createQuickActionsContribution(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  controllers: TerminalControllerStore,
  t: (key: string) => string,
): QuickActionsContribution {
  const quickActions = createQuickActionsStore(scope)

  const execute = async (
    action: QuickAction,
    initial: QuickActionsTerminalContext,
  ): Promise<void> => {
    let activeTerminal = initial

    for (const step of action.steps) {
      const command = step.command.trim()
      if (command === '') throw new Error('quick action requires a non-empty command')

      if (step.target === 'new') {
        const cwd = activeTerminal.cwd?.trim() ?? ''
        if (cwd === '') throw new Error('quick action new-target requires a cwd')
        ctx.sidebarRight.openTab(TERMINAL_TAB_KIND, {
          revealIfOpened: false,
          params: { cwd },
        })
        const tab = ctx.sidebarRight.active()
        if (tab === undefined || tab.kind !== TERMINAL_TAB_KIND) {
          throw new Error('quick action failed to open a terminal')
        }
        activeTerminal = {
          sessionId: initial.sessionId,
          terminalId: terminalControllerId(initial.sessionId, tab.id),
          cwd,
        }
      }

      await (await controllers.waitFor(activeTerminal.terminalId)).run(command)
    }
  }

  return {
    render: context => createElement(QuickActionsControls, {
      store: quickActions,
      execute: action => execute(action, context),
      visible: context.visible,
      t,
    }),
    dispose: () => quickActions.dispose(),
  }
}
