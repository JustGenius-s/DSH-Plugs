/** Model-facing tool that pauses until the human finishes a reproduction. */
export const WAIT_FOR_REPRO = 'wait_for_repro'

/** Model-facing tool that appends one line to the debug log dock. */
export const DEBUG_LOG = 'debug_log'

/** HTTP path for appending or listing debug logs. */
export const LOGS_PATH = '/dsh-debug-mode/logs'

/** HTTP path for resolving a pending reproduction wait. */
export const REPRO_PATH = '/dsh-debug-mode/repro'

/** Keep the projection small enough to ride every history tail page. */
export const MAX_DEBUG_LOGS = 200

export type DebugLogSource = 'agent' | 'user' | 'ingest'

export type DebugReproVerdict = 'proceed' | 'fixed'

export type DebugReproAction = DebugReproVerdict | 'cancel'

export interface DebugLogEntry {
  id: string
  at: number
  source: DebugLogSource
  text: string
}

export interface DebugReproWait {
  id: string
  steps: string
  waiting: boolean
}

export interface DebugLogPost {
  sessionId: string
  text: string
  source?: DebugLogSource
}

export interface DebugReproPost {
  sessionId: string
  action: DebugReproAction
  notes?: string
}

export interface DebugHttpOk<T> {
  ok: true
  value: T
}

export interface DebugHttpErr {
  ok: false
  message: string
}

export type DebugHttpResult<T> = DebugHttpOk<T> | DebugHttpErr

export function capLogs(logs: readonly DebugLogEntry[]): DebugLogEntry[] {
  if (logs.length <= MAX_DEBUG_LOGS) return logs.slice()
  return logs.slice(logs.length - MAX_DEBUG_LOGS)
}

export function mintDebugId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}
