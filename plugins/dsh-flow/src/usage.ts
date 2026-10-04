import type { FlowTokenUsage } from './shared.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readUsage(value: unknown): FlowTokenUsage | null {
  if (!record(value)) return null
  const uncachedInputTokens = count(value.inputTokens)
  const outputTokens = count(value.outputTokens)
  const cacheReadTokens = value.cacheReadTokens === undefined ? 0 : count(value.cacheReadTokens)
  const cacheWriteTokens = value.cacheWriteTokens === undefined ? 0 : count(value.cacheWriteTokens)
  if (uncachedInputTokens === null || outputTokens === null || cacheReadTokens === null || cacheWriteTokens === null) return null
  return { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

/** Last provider sample wins per model step, so chunk and final message do not double-count. */
export function tokenUsageOf(events: readonly unknown[]): FlowTokenUsage | null {
  const steps = new Map<string, FlowTokenUsage>()
  for (const event of events) {
    if (!record(event) || !record(event.data)) continue
    const data = event.data
    const turn = count(data.turn)
    const step = count(data.step)
    if (turn === null || step === null) continue
    const sample = event.type === 'assistant/chunk' && record(data.chunk) && data.chunk.type === 'usage'
      ? data.chunk.usage
      : event.type === 'assistant/message' ? data.usage : undefined
    const usage = readUsage(sample)
    if (usage !== null) steps.set(`${turn}:${step}`, usage)
  }
  if (steps.size === 0) return null
  const total = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  for (const usage of steps.values()) {
    total.uncachedInputTokens += usage.uncachedInputTokens
    total.cacheReadTokens += usage.cacheReadTokens
    total.cacheWriteTokens += usage.cacheWriteTokens
    total.outputTokens += usage.outputTokens
  }
  return total
}
