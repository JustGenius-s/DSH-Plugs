/**
 * Client-safe debug UI state. Host keeps this in process memory and serves it
 * over HTTP; it is intentionally not folded from the durable session log.
 */
import type { DebugHypothesis } from './hypotheses.ts'
import type { DebugLogEntry, DebugReproWait } from './shared.ts'

export interface DebugRunSummary {
  id: string
  endedAt: number
  logCount: number
}

export interface DebugProjection {
  active: boolean
  pending: boolean
  wait: DebugReproWait | null
  logs: readonly DebugLogEntry[]
  /** Workspace-relative JSONL path, when a debug kit was installed. */
  logFile: string | null
  runId: string | null
  runs: readonly DebugRunSummary[]
  hypotheses: readonly DebugHypothesis[]
}
