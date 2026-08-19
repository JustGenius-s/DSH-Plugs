/**
  * Client-safe projection types. Host and browser both import this file so
  * `useProjection('debug')` and the host unit share one SessionProjectionMap key.
  */
import type { DebugLogEntry, DebugReproWait } from './shared.ts'

export interface DebugProjection {
  active: boolean
  pending: boolean
  wait: DebugReproWait | null
  logs: readonly DebugLogEntry[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Debug collaboration state folded from /debug, debug/mode, waits, and logs. */
    debug: DebugProjection
  }
}
