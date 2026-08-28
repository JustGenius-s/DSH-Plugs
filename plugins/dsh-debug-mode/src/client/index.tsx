import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getRemote } from '@just-genius/dsh-plugin-runtime/client'
import { DebugChip } from './DebugChip.tsx'
import { DebugDock } from './DebugDock.tsx'
import { en, zh, type DebugKey } from './locales.ts'
import { REPRO_PATH, type DebugReproAction } from '../shared.ts'
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
  CLIENT_SERVICES.remoteCommands,
] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-debug-mode: dictionaries')
  const remote = getRemote(ctx)

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'debug-chip',
    order: 20,
    locale: NS,
    inject: (sessionId) => ({
      sessionId: String(sessionId),
      exitDebugMode: async () => {
        const result = await remote.commands.execute(sessionId, '/debug off', [])
        if (!result.ok) return result.error.message + ' (' + result.error.code + ')'
        if (result.value === undefined) return 'unknown command: /debug off'
        return null
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
