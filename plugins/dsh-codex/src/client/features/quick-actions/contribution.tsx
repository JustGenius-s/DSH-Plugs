import { createElement } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshCodexConfig, QuickAction } from '../../../shared/config'
import { currentSessionLocation } from '../../host-adapters/sessions'
import type { SidePanelActionsContribution } from '../side-panels/actions'
import type { SidePanelsStore } from '../side-panels/service'
import type { TerminalControllerStore } from '../terminal/controller'
import { QuickActionsControls } from './controls'
import { createQuickActionsStore } from './store'

export function createQuickActionsContribution(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  controllers: TerminalControllerStore,
  t: (key: string) => string,
): SidePanelActionsContribution {
  const quickActions = createQuickActionsStore(scope)

  const execute = async (action: QuickAction): Promise<void> => {
    const panels = ctx.sidePanels as SidePanelsStore
    const { sessionId, cwd: sessionCwd } = currentSessionLocation(ctx.sessions)
    const snapshot = panels.getSnapshot()
    let activeTerminal = snapshot.activeKey === null
      ? undefined
      : snapshot.instances.find(item => item.key === snapshot.activeKey && item.panelId === 'terminal')

    for (const step of action.steps) {
      const command = step.command.trim()
      if (command === '') throw new Error('quick action requires a non-empty command')
      if (!sessionId) throw new Error('quick action requires a current session')

      if (step.target === 'current') {
        if (activeTerminal === undefined) {
          throw new Error('quick action current-target requires an active terminal')
        }
        await (await controllers.waitFor(`${sessionId}:${activeTerminal.key}`)).run(command)
        continue
      }

      const cwd = (activeTerminal?.state?.cwd ?? sessionCwd)?.trim() ?? ''
      if (cwd === '') throw new Error('quick action new-target requires a cwd')
      const key = panels.open('terminal', { cwd })
      if (key === undefined) throw new Error('quick action failed to open a terminal')
      activeTerminal = panels.getSnapshot().instances.find(
        item => item.key === key && item.panelId === 'terminal',
      )
      await (await controllers.waitFor(`${sessionId}:${key}`)).run(command)
    }
  }

  return {
    render: variant => createElement(QuickActionsControls, {
      variant,
      store: quickActions,
      execute,
      t,
    }),
    dispose: () => quickActions.dispose(),
  }
}
