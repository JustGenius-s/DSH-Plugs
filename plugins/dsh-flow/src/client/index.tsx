import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, postResult } from '@just-genius/dsh-plugin-runtime/client'
import { IconFlowColor16 } from '@just-genius/dsh-plugin-ui'

import { FlowCanvas } from './FlowCanvas.tsx'
import { FlowChip } from './FlowChip.tsx'
import { createFlowArgumentSource, createFlowCommand, type FlowCommand } from './command.ts'
import { en, zh, type FlowKey } from './locales.ts'
import { FLOW_TAB_KIND, registerFlowTab } from './sidebar.ts'
import { flowState } from './state.ts'
import { MODE_PATH, type FlowActionResult } from '../shared.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    flow: FlowKey
  }
}

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.sidebarRight,
  CLIENT_SERVICES.sidebarRightTabs,
  CLIENT_SERVICES.inputTriggers,
  'commandUi',
] as const

interface CommandUiFace {
  register(command: FlowCommand): () => void
}

function FlowTab({ sessionId }: { sessionId: string }) {
  return <FlowCanvas key={sessionId} sessionId={sessionId} />
}

function FlowTabTitle() {
  return <><IconFlowColor16 />Flow</>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('flow', { zh, en }), 'dsh-flow: dictionaries')
  const t = ctx.locale.bind('flow')
  ctx.effect(() => registerFlowTab(ctx, FlowTab, FlowTabTitle, IconFlowColor16), 'dsh-flow: sidebar tab')

  // Keep /flow client-owned, like Debug: Host decorations cannot set a title or icon.
  const commandUi = ctx.get('commandUi') as CommandUiFace
  ctx.effect(() => commandUi.register(createFlowCommand(t, ({ sessionId }) => {
    ctx.sidebarRight.openTab(FLOW_TAB_KIND)
    void flowState.setMode(String(sessionId), true)
  })), 'dsh-flow: command row')

  ctx.effect(() => ctx.inputTriggers.registerSource(createFlowArgumentSource(t, async (sessionId, rawInput) => {
    try {
      const result = await postResult<FlowActionResult>(
        `${MODE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { rawInput },
      )
      if (!result.ok) return { kind: 'error', text: result.message ?? t('command.failed') }
      if (rawInput.trim() !== 'off') ctx.sidebarRight.openTab(FLOW_TAB_KIND)
      await flowState.refresh(sessionId)
      return { kind: 'success' }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : t('command.failed') }
    }
  })), 'dsh-flow: typed command arguments')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'flow-chip',
    order: 21,
    locale: 'flow',
    inject: sessionId => ({ sessionId: String(sessionId) }),
  }, FlowChip as never))
}
