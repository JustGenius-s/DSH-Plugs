import { createElement, type ReactNode } from 'react'
import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { TerminalControllerStore } from '../terminal/controller'
import { QuickActionsControls } from './controls'
import {
  executeQuickAction,
  type QuickActionsTerminalContext,
} from './executor'
import { createQuickActionsStore } from './store'

export type { QuickActionsTerminalContext } from './executor'

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

  return {
    render: context => createElement(QuickActionsControls, {
      store: quickActions,
      execute: action => executeQuickAction(ctx.sidebarRight, controllers, action, context),
      visible: context.visible,
      t,
    }),
    dispose: () => quickActions.dispose(),
  }
}
