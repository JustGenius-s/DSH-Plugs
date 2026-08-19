export const NAMESPACE = 'whale-girl'
export const CONTRIBUTOR = 'whale-girl'
export const OVERLAY_ID = 'pet'
export const BODY_LIMIT = 1024
export const PRESENCE_TTL_MS = 45_000
export const HEARTBEAT_MS = 15_000

export const DEFAULTS = Object.freeze({
  enabled: true,
  size: 110,
  opacity: 1,
  walk: {
    enabled: true,
    minWaitMs: 18_000,
    maxWaitMs: 40_000,
    minMs: 3_000,
    maxMs: 6_000,
    speedPxPerSec: 45,
  },
  sleepAfterMs: 60_000,
  pollMs: 3_000,
  bubbleMs: 2_500,
  welcomeMs: 6_000,
  celebrateMs: 6_000,
  errorMs: 4_000,
  disappointedMs: 6_000,
  replies: {
    feed: ['「啊呜——谢谢投喂！」', '「好好吃，能量满满！」', '「嘻嘻，投喂成功！」'],
    play: ['「嘿嘿，再来一次！」', '「玩得好开心～」', '「我赢了！再来！」'],
  },
})

export type WhaleGirlConfig = {
  enabled: boolean
  size: number
  opacity: number
  walk: {
    enabled: boolean
    minWaitMs: number
    maxWaitMs: number
    minMs: number
    maxMs: number
    speedPxPerSec: number
  }
  sleepAfterMs: number
  pollMs: number
  bubbleMs: number
  welcomeMs: number
  celebrateMs: number
  errorMs: number
  disappointedMs: number
  replies: { feed: string[]; play: string[] }
}

export function validateConfig(value: WhaleGirlConfig): void {
  const walk = value.walk
  if (walk.minWaitMs > walk.maxWaitMs) throw new Error('walk.minWaitMs 不得大于 walk.maxWaitMs')
  if (walk.minMs > walk.maxMs) throw new Error('walk.minMs 不得大于 walk.maxMs')
}
