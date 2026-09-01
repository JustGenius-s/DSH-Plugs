// Browser half: update state from the Host half's routes.
//
// Detection lives Host-side now, so this replaces the old
// `window.dshDesktop.updates.getState()` / `onState()` pair with a poll of
// STATE_PATH. Polling (rather than SSE) keeps this to one moving part: the Host
// already refreshes on its own interval, so the browser only needs to catch up.
//
// The store is deliberately framework-free. Both the settings card (a React
// component) and the native seats (registered once, outside React) render the
// same state, and only the former can use hooks.

import { getJson, postJson, postResult } from '@just-genius/dsh-plugin-runtime/client'

import {
  CHECK_PATH,
  EXEC_PATH,
  STATE_PATH,
  VERSION_PATH,
  EMPTY_STATE,
  type DesktopExecReport,
  type DesktopUpdateState,
} from '../shared'
import { bridge } from './bridge'

/** Poll interval. Detection is hourly-scale; this only catches up. */
const POLL_MS = 15_000

type Listener = (state: DesktopUpdateState) => void

export interface UpdateStore {
  /** Current snapshot. */
  get(): DesktopUpdateState
  /** Subscribe; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void
  /** Re-run detection now (the "check now" action). */
  checkNow(): void
  /** Report an execute outcome so every window sees the same progress. */
  report(report: DesktopExecReport): void
  /** Drive the runtime upgrade through the shell, reporting both outcomes. */
  updateDsh(version: string): Promise<void>
  /** Stop polling (called when the plugin fiber disposes). */
  dispose(): void
}

function asState(value: unknown): DesktopUpdateState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  return value as DesktopUpdateState
}

/**
 * Open the shared store: starts polling, reports the shell's version to the
 * Host (which is what enables the app half of detection), and returns the
 * handle every consumer shares.
 */
export function createUpdateStore(): UpdateStore {
  let state: DesktopUpdateState = EMPTY_STATE
  let disposed = false
  const listeners = new Set<Listener>()

  const set = (next: DesktopUpdateState): void => {
    if (disposed) return
    state = next
    for (const listener of [...listeners]) listener(state)
  }

  const pull = async (): Promise<void> => {
    try {
      const next = await getJson<DesktopUpdateState>(STATE_PATH)
      const parsed = asState(next)
      if (parsed !== undefined) set(parsed)
    } catch {
      // Keep the last good snapshot; the next tick retries.
    }
  }

  /**
   * Hand the Host the shell's packaged version. Only the shell knows it and
   * only the browser can reach both sides; an empty string means "no shell",
   * which makes the Host skip the app half of detection.
   */
  const reportVersion = async (): Promise<void> => {
    const app = (await bridge()?.updates.appVersion().catch(() => undefined)) ?? ''
    if (disposed) return
    try {
      const res = await postJson<{ ok: boolean; state?: DesktopUpdateState }>(VERSION_PATH, { app })
      const parsed = asState(res.state)
      if (parsed !== undefined) set(parsed)
    } catch {
      // Non-fatal: the runtime half of detection still runs.
    }
  }

  void reportVersion()
  void pull()
  const timer = setInterval(() => { void pull() }, POLL_MS)

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    checkNow() {
      // Hit CHECK_PATH so the Host actually re-runs detection rather than
      // re-reading the snapshot a STATE_PATH poll would return.
      void postResult<{ ok: boolean; state?: DesktopUpdateState }>(CHECK_PATH, {})
        .then((res) => {
          const parsed = asState(res.state)
          if (parsed !== undefined) set(parsed)
          else void pull()
        })
        .catch(() => {})
    },
    report(value) {
      void postJson<{ ok: boolean; state?: DesktopUpdateState }>(EXEC_PATH, value)
        .then((res) => {
          const parsed = asState(res.state)
          if (parsed !== undefined) set(parsed)
        })
        .catch(() => {})
    },
    async updateDsh(version) {
      const shell = bridge()?.updates
      if (shell === undefined || version === '') return
      this.report({ phase: 'start', version })
      try {
        await shell.updateDsh(version)
        this.report({ phase: 'done', version })
      } catch (err) {
        this.report({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },
    dispose() {
      disposed = true
      clearInterval(timer)
      listeners.clear()
    },
  }
}
