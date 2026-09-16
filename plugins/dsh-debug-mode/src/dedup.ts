import type { DebugLogEntry } from './shared.ts'

/** Fold identical ingest ticks that land inside one poll period. */
export const DEDUP_WINDOW_MS = 8000

export function evidenceKey(entry: Pick<DebugLogEntry, 'source' | 'text' | 'hypothesisId' | 'location' | 'runId' | 'data'>): string {
  return [
    entry.source,
    entry.text,
    entry.hypothesisId ?? '',
    entry.location ?? '',
    entry.runId ?? '',
    stableData(entry.data),
  ].join('\0')
}

export function foldDuplicateLog(
  logs: readonly DebugLogEntry[],
  entry: DebugLogEntry,
  windowMs = DEDUP_WINDOW_MS,
): DebugLogEntry[] {
  for (let index = logs.length - 1; index >= 0; index--) {
    const previous = logs[index]
    if (previous === undefined) continue
    if (entry.at - previous.at > windowMs) break
    if (evidenceKey(previous) !== evidenceKey(entry)) continue
    const next = logs.slice()
    next[index] = {
      ...previous,
      at: entry.at,
      count: (previous.count ?? 1) + 1,
    }
    return next
  }
  return [...logs, entry]
}

function stableData(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
