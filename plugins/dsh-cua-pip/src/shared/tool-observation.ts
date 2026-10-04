import { extractPid, extractWatchTarget, readToolCall } from './cua-activity.ts'
import type { WatchTarget } from './types.ts'

export interface ToolObservation {
  phase: 'call' | 'result'
  name?: string
  callId?: string
  arguments?: unknown
  result?: unknown
  failed: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Both ordinary tool calls and the nested calls made by run_code are visible. */
export function readToolObservation(event: unknown): ToolObservation | undefined {
  const call = readToolCall(event)
  if (call !== null) return { ...call, phase: 'call', failed: false }
  const row = record(event)
  const data = record(row?.data)
  if (data === undefined) return undefined
  if (row?.type === 'tool/code-dispatch') {
    return {
      phase: 'result',
      name: typeof data.name === 'string' ? data.name : undefined,
      callId: typeof data.subCallId === 'string' ? data.subCallId : undefined,
      arguments: data.arguments,
      result: data.content,
      failed: data.isError === true,
    }
  }
  if (row?.type !== 'tool/result') return undefined
  const message = record(data.message)
  const source = record(message?.source)
  const blocks = message?.content
  const block = Array.isArray(blocks)
    ? blocks.map(record).find((item) => item?.type === 'tool-result')
    : undefined
  const id = source?.callId ?? block?.toolCallId
  return {
    phase: 'result',
    callId: typeof id === 'string' ? id : undefined,
    result: block?.content ?? blocks,
    failed: data.error !== undefined || block?.isError === true,
  }
}

/**
 * Inspect only driver metadata, never accessibility trees, screenshots, or
 * arbitrary application text. A result's pid wins over a previous window.
 */
export function targetHint(value: unknown, depth = 0): { target?: WatchTarget; pid?: number } | undefined {
  if (depth > 6) return undefined
  if (typeof value === 'string') {
    try { return targetHint(JSON.parse(value), depth + 1) } catch { return undefined }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hint = targetHint(item, depth + 1)
      if (hint !== undefined) return hint
    }
    return undefined
  }
  const row = record(value)
  if (row === undefined || row.isError === true || row.effect === 'refused'
    || row.effect === 'failed' || row.ok === false || row.success === false) return undefined
  const success = row.ok === true || row.success === true || row.effect === 'confirmed'
    || ['request_sent', 'running', 'window_ready'].includes(String(row.launch_state))
  if (row.code !== undefined && !success) return undefined
  const target = extractWatchTarget(row)
  if (target !== undefined) return { target, pid: target.pid }
  const pid = extractPid(row)
  if (pid !== undefined) return { pid }
  for (const key of ['structuredContent', 'content', 'result']) {
    const hint = targetHint(row[key], depth + 1)
    if (hint !== undefined) return hint
  }
  if (row.type === 'text') return targetHint(row.text, depth + 1)
  return undefined
}
