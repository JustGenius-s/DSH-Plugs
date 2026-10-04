import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'
import { DebugChip } from './DebugChip.tsx'
import { DebugDock } from './DebugDock.tsx'
import { IconDebugOutline16 } from './DebugIcon.tsx'
import { en, zh, type DebugKey } from './locales.ts'
import { CLEAR_PATH, COMMAND_PATH, REPRO_PATH, type DebugReproAction } from '../shared.ts'
import { postResult } from '@just-genius/dsh-plugin-runtime/client'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    debug: DebugKey
  }
}

const NS = 'debug'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.remote,
  'commandUi',
] as const

interface CommandUiFace {
  register(contribution: {
    name: string
    label?: () => string
    description?: () => string
    icon?: unknown
    available: (session: { sessionId: string }) => boolean
    ui: { kind: 'action'; run: (session: { sessionId: string }) => void }
  }): () => void
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-debug-mode: dictionaries')
  const t = ctx.locale.bind(NS)
  const commandUi = ctx.get('commandUi') as CommandUiFace | undefined
  if (commandUi !== undefined) {
    ctx.effect(() => commandUi.register({
      name: 'debug',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconDebugOutline16,
      available: () => true,
      ui: {
        kind: 'action',
        run: (session) => {
          void postJson(COMMAND_PATH, { sessionId: String(session.sessionId) })
        },
      },
    }), 'dsh-debug-mode: command row')
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'debug-chip',
    order: 20,
    locale: NS,
    inject: (sessionId) => ({
      sessionId: String(sessionId),
      exitDebugMode: async () => {
        return postJson(COMMAND_PATH, { sessionId, rawInput: 'off' })
      },
    }),
  }, DebugChip as never))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'debug',
    order: 5,
    locale: NS,
    inject: (sessionId) => ({
      sessionId: String(sessionId),
      resolveRepro: (action: DebugReproAction, notes: string) => postJson(REPRO_PATH, { sessionId, action, notes }),
      clearLogs: () => postJson(CLEAR_PATH, { sessionId }),
    }),
  }, DebugDock as never))
}

async function postJson(path: string, body: unknown): Promise<string | null> {
  try {
    await postResult(path, body)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
