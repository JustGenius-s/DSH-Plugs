import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DebugChip } from './DebugChip.tsx'
import { DebugDock } from './DebugDock.tsx'
import { en, zh, type DebugKey } from './locales.ts'
import { REPRO_PATH, type DebugHttpResult, type DebugReproAction } from '../shared.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    debug: DebugKey
  }
}

const NS = 'debug'

export const inject = ['slots', 'locale', 'remote', 'remote.commands'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-debug-mode: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'debug-chip',
    order: 20,
    locale: NS,
    inject: (sessionId) => ({
      exitDebugMode: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/debug off')
        if (!result.ok) return `${result.error.message} (${result.error.code})`
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
      resolveRepro: (action: DebugReproAction, notes: string) => postJson(REPRO_PATH, { sessionId, action, notes }),
    }),
  }, DebugDock as never))
}

async function postJson(path: string, body: unknown): Promise<string | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let value: DebugHttpResult<unknown>
  try {
    value = await response.json() as DebugHttpResult<unknown>
  } catch {
    return `request failed (${response.status})`
  }
  if (value.ok) return null
  return value.message
}
