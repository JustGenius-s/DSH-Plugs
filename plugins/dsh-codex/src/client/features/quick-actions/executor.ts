import type { SidebarRightService } from '@just-genius/dsh-plugin-runtime/client'
import type { QuickAction } from '../../../shared/config'
import type { TerminalControllerStore } from '../terminal/controller'
import {
  TERMINAL_TAB_KIND,
  createTerminalResourceAddress,
  terminalResourceControllerId,
} from '../terminal/contract'

export interface QuickActionsTerminalContext {
  sessionId: string
  terminalId: string
  cwd?: string
  visible?: boolean
}

export async function executeQuickAction(
  sidebar: Pick<SidebarRightService, 'openResource'>,
  controllers: Pick<TerminalControllerStore, 'waitFor'>,
  action: QuickAction,
  initial: QuickActionsTerminalContext,
): Promise<void> {
  let activeTerminal = initial

  for (const step of action.steps) {
    const command = step.command.trim()
    if (command === '') throw new Error('quick action requires a non-empty command')

    if (step.target === 'new') {
      const cwd = activeTerminal.cwd?.trim() ?? ''
      if (cwd === '') throw new Error('quick action new-target requires a cwd')
      const address = createTerminalResourceAddress()
      sidebar.openResource(address, {
        kind: TERMINAL_TAB_KIND,
        revealIfOpened: false,
        params: { cwd },
      })
      // The new tab's id is not readable yet: `openResource` applies
      // navigation asynchronously, so `sidebar.active()` still reports the
      // previous tab here. Key the controller on the resource address we just
      // minted — the tab that mounts from it registers under that same key.
      activeTerminal = {
        sessionId: initial.sessionId,
        terminalId: terminalResourceControllerId(initial.sessionId, address),
        cwd,
      }
    }

    const controller = await controllers.waitFor(activeTerminal.terminalId)
    await controller.run(command)
  }
}
