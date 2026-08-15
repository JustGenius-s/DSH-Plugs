import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WeChatApp, type WeChatAppInjected } from './WeChatApp.tsx'
import { en, zh, type WeChatKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'wechat.chat': WeChatKey
  }
}

const NS = 'wechat.chat'

export const inject = ['slots', 'locale', 'sessions', 'workspaces'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-wechat-chat: dictionaries')
  const t = ctx.locale.bind(NS)

  const injected = (): WeChatAppInjected => ({
    t,
    open: (id) => ctx.sessions.open(id),
    startSession: (workspaceId) => ctx.workspaces.startSession(workspaceId),
    bindingOf: (id) => ctx.sessions.binding(id as never),
    archiveSession: (id) => ctx.workspaces.archiveSession(id),
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    createWorkspace: (path) => ctx.workspaces.create({ path }),
    connectWorkspace: (id) => ctx.workspaces.connectWorkspace(id),
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'wechat-chat',
    order: 80,
    locale: NS,
    inject: injected,
  }, WeChatApp as never))
}
