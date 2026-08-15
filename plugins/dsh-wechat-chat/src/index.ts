import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { WECHAT_PROMPT } from './wechat-prompt.ts'

export const name = 'dsh-wechat-chat'

export const inject = ['systemPrompt'] as const

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
