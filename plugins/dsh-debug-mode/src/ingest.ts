import { MAX_INGEST_BATCH, MAX_INGEST_LINE, type DebugLogEntry } from './shared.ts'

/** Structured fields a runtime probe may send with one dock line. */
export type IngestExtras = Pick<DebugLogEntry, 'hypothesisId' | 'location' | 'data' | 'runId'>

export interface ParsedIngestLine extends IngestExtras {
  text: string
}

function clip(text: string): string {
  return text.length > MAX_INGEST_LINE ? text.slice(0, MAX_INGEST_LINE) : text
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

function extrasOf(body: object): IngestExtras {
  const value = body as Record<string, unknown>
  const extras: IngestExtras = {}
  const hypothesisId = asTrimmedString(value.hypothesisId)
  if (hypothesisId !== undefined) extras.hypothesisId = hypothesisId
  const location = asTrimmedString(value.location)
  if (location !== undefined) extras.location = location
  const runId = asTrimmedString(value.runId)
  if (runId !== undefined) extras.runId = runId
  if (value.data !== undefined) extras.data = value.data
  return extras
}

/**
 * Pull display lines plus optional hypothesis fields out of one ingest POST.
 *
 * Accepts `{ message }` (preferred), `{ text }`, and `{ lines }`. Structured
 * extras on the body apply to every line in that request.
 */
export function collectIngestLines(body: object): ParsedIngestLine[] {
  const value = body as { message?: unknown; text?: unknown; lines?: unknown }
  const extras = extrasOf(body)
  const texts: string[] = []
  const message = asTrimmedString(value.message) ?? asTrimmedString(value.text)
  if (message !== undefined) texts.push(message)
  if (Array.isArray(value.lines)) {
    for (const item of value.lines) {
      const line = asTrimmedString(item)
      if (line !== undefined) texts.push(line)
    }
  }
  return texts.slice(0, MAX_INGEST_BATCH).map((text) => ({
    text: clip(text),
    ...extras,
  }))
}

/** One dock / tool-result line the model can cite. */
export function formatLogEntry(entry: DebugLogEntry): string {
  const time = new Date(entry.at).toISOString()
  const parts = [`[${time}]`, `[${entry.source}]`]
  if (entry.hypothesisId !== undefined) parts.push(`[${entry.hypothesisId}]`)
  if (entry.runId !== undefined) parts.push(`[run:${entry.runId}]`)
  if (entry.location !== undefined) parts.push(entry.location)
  parts.push(entry.text)
  if (entry.count !== undefined && entry.count > 1) parts.push(`×${entry.count}`)
  if (entry.data !== undefined) {
    try {
      parts.push(JSON.stringify(entry.data))
    } catch {
      parts.push(String(entry.data))
    }
  }
  return parts.join(' ')
}

export function formatLogs(logs: readonly DebugLogEntry[]): string {
  if (logs.length === 0) return ''
  return logs.map(formatLogEntry).join('\n')
}
