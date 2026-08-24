import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryDock } from './MemoryDock.tsx'
import { MemorySection } from './MemorySection.tsx'
import type { MemorySectionInjected } from './MemorySection.tsx'
import { installMemorySettingsIcon } from './memory-settings-icon.ts'
import { en, zh, type MemoryKey } from './locales.ts'
import { PROPOSE_PATH, type MemoryProposeAction } from '../shared.ts'
import { postResult } from '@just-genius/dsh-plugin-runtime/client'
import { MemoryController } from './memory-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    memory: MemoryKey
  }
}

const NS = 'memory'

export const inject = ['slots', 'locale'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')

  const t = ctx.locale.bind(NS) as MemorySectionInjected['t']
  const controller = new MemoryController()
  ctx.effect(() => () => controller.dispose(), 'dsh-memory: controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 45,
    label: () => t('nav'),
    inject: () => ({ t, controller }),
  }, MemorySection))
  ctx.effect(() => installMemorySettingsIcon(() => t('nav')), 'dsh-memory: settings icon')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'memory-propose',
    order: 8,
    locale: NS,
    inject: (sessionId) => ({
      sessionId: String(sessionId),
      resolvePropose: (action: MemoryProposeAction, title: string, content: string) =>
        postPropose(PROPOSE_PATH, { sessionId, action, title, content }),
    }),
  }, MemoryDock as never))
}

async function postPropose(path: string, body: unknown): Promise<string | null> {
  try {
    await postResult<unknown>(path, body)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
