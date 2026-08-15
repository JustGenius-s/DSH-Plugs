import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { WeChatApp, type WeChatAppInjected } from './WeChatApp.tsx'
import { en, zh, type WeChatKey } from './locales.ts'
import type { ModelDirectoryFace, ModelPick } from './models.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'wechat.chat': WeChatKey
  }
}

const NS = 'wechat.chat'

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'modelDirectories', 'connection'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-wechat-chat: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle

  const injected = (): WeChatAppInjected => ({
    t,
    open: (id) => ctx.sessions.open(id),
    startSession: (workspaceId) => ctx.workspaces.startSession(workspaceId),
    bindingOf: (id) => ctx.sessions.binding(id as never),
    archiveSession: (id) => ctx.workspaces.archiveSession(id),
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    createWorkspace: (path) => ctx.workspaces.create({ path }),
    connectWorkspace: (id) => ctx.workspaces.connectWorkspace(id),
    directoryFor: (id) => {
      try {
        return ctx.modelDirectories.directoryFor(id as never) as ModelDirectoryFace
      } catch {
        return undefined
      }
    },
    saveDefaultModel: (pick: ModelPick) => saveDefaultModel(connection, pick),
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'wechat-chat',
    order: 80,
    locale: NS,
    inject: injected,
  }, WeChatApp as never))
}

async function saveDefaultModel(connection: ConnectionHandle, pick: ModelPick): Promise<void> {
  const section: { provider: string; model: string; reasoningEffort?: string } = {
    provider: pick.provider,
    model: pick.model,
  }
  if (pick.reasoningEffort !== undefined) section.reasoningEffort = pick.reasoningEffort
  const response = await connection.api.settings.replace({
    ns: 'agent-default-model',
    section,
  })
  if (!response.result.ok) throw new Error(response.result.error.message)
}
