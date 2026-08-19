import type { PetState } from './pet-state.ts'

const FALLBACK_REPLIES = {
  feed: ['「啊呜——谢谢投喂！」', '「好好吃，能量满满！」', '「嘻嘻，投喂成功！」'],
  play: ['「嘿嘿，再来一次！」', '「玩得好开心～」', '「我赢了！再来！」'],
}

export type InteractAction = 'feed' | 'play'

export function applyAction(
  state: PetState,
  action: unknown,
  replies: { feed: string[]; play: string[] } | null = null,
): { status: number; body: unknown } {
  if (action === 'feed' || action === 'play') {
    const pool = replies?.[action]?.length ? replies[action] : FALLBACK_REPLIES[action]
    return {
      status: 200,
      body: { pet: state, reply: pool[Math.floor(Math.random() * pool.length)] },
    }
  }
  return { status: 400, body: { error: `unknown action "${String(action)}"; expected "feed" or "play"` } }
}

export function isCrossOrigin(headers: Record<string, string | string[] | undefined>, host: string | undefined): boolean {
  const site = headers['sec-fetch-site']
  if (typeof site === 'string') return site !== 'same-origin' && site !== 'none'
  const origin = headers.origin
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  return false
}
