import type { ClientContext, ConnectionHandle } from '@just-genius/dsh-plugin-runtime/client'
import {
  CLIENT_SERVICES,
  getConnection,
  getSessions,
  getWorkspaces,
} from '@just-genius/dsh-plugin-runtime/client'
import { WeChatApp, type WeChatAppInjected } from './WeChatApp.tsx'
import { en, zh, type WeChatKey } from './locales.ts'
import type { ModelDirectoryFace, ModelPick } from './models.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'wechat.chat': WeChatKey
  }
}

const NS = 'wechat.chat'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.sessions,
  CLIENT_SERVICES.workspaces,
  CLIENT_SERVICES.modelDirectories,
  CLIENT_SERVICES.connection,
] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-wechat-chat: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = getConnection(ctx)
  const sessions = getSessions(ctx)
  const workspaces = getWorkspaces(ctx)

  const injected = (): WeChatAppInjected => ({
    t,
    open: (id) => sessions.open(id),
    startSession: (workspaceId) => workspaces.startSession(workspaceId),
    bindingOf: (id) => sessions.binding(id as never),
    archiveSession: (id) => workspaces.archiveSession(id),
    pickDirectory: () => workspaces.pickDirectory(),
    createWorkspace: (path) => workspaces.create({ path }),
    connectWorkspace: (id) => workspaces.connectWorkspace(id),
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
