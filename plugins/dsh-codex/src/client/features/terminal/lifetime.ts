import { terminateTerminalSession } from './connection-controller'

export interface TerminalLifetimeRegistry {
  /** Bind one official tab occurrence to its abort signal (idempotent). */
  watch(signal: AbortSignal, terminalId: string): void
  /** Terminate every tracked PTY and release all signal listeners. */
  dispose(): void
}

interface LifetimeEntry {
  signal: AbortSignal
  terminalId: string
  abort: () => void
}

/**
 * Keep termination owned by the tab occurrence rather than a React body.
 * Official Sidebar bodies may unmount while inactive; their AbortSignal lives
 * until the tab is actually removed, so the listener deliberately does too.
 */
export function createTerminalLifetimeRegistry(
  terminate: (terminalId: string) => Promise<void> = terminateTerminalSession,
): TerminalLifetimeRegistry {
  const entries = new Map<AbortSignal, LifetimeEntry>()
  const stoppedSignals = new WeakSet<AbortSignal>()

  const stop = (entry: LifetimeEntry): void => {
    if (stoppedSignals.has(entry.signal)) return
    stoppedSignals.add(entry.signal)
    entry.signal.removeEventListener('abort', entry.abort)
    entries.delete(entry.signal)
    void terminate(entry.terminalId).catch(() => {})
  }

  return {
    watch(signal, terminalId) {
      if (stoppedSignals.has(signal) || entries.has(signal)) return
      const entry: LifetimeEntry = {
        signal,
        terminalId,
        abort: () => stop(entry),
      }
      entries.set(signal, entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      if (signal.aborted) stop(entry)
    },
    dispose() {
      for (const entry of [...entries.values()]) stop(entry)
    },
  }
}
