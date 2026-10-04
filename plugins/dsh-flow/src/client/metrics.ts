import type { FlowTokenUsage } from '../shared.ts'

export function elapsedMs(startedAt: string | null, endedAt: string | null, now: number): number | null {
  if (startedAt === null) return null
  const start = Date.parse(startedAt)
  const end = endedAt === null ? now : Date.parse(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, end - start)
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}小时${minutes}分${rest}秒`
  if (minutes > 0) return `${minutes}分${rest}秒`
  return `${rest}秒`
}

export function totalTokens(usage: FlowTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
}

export function inputTokens(usage: FlowTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}
