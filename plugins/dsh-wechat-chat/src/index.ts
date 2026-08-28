import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'
import { WECHAT_PROMPT } from './wechat-prompt.ts'

export const name = 'dsh-wechat-chat'

export const inject = [HOST_SERVICES.systemPrompt] as const

export function apply(ctx: Context) {
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'wechat:chat-persona',
      order: 12,
      text: WECHAT_PROMPT,
    }),
    'dsh-wechat-chat: wechat persona',
  )
}
