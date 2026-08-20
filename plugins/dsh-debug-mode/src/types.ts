/**
 * Client-safe debug UI state. Host keeps this in process memory and serves it
 * over HTTP; it is intentionally not folded from the durable session log.
 */
import type { DebugLogEntry, DebugReproWait } from './shared.ts'

export interface DebugProjection {
  active: boolean
  pending: boolean
  wait: DebugReproWait | null
  logs: readonly DebugLogEntry[]
}
