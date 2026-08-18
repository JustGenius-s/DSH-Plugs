/**
 * The collapsed launcher's visibility state, shared between the shell (which
 * measures occlusion and owns the card) and the session-header toggle (which
 * lets the user override the measurement).
 *
 * Two inputs decide visibility:
 *
 * - `occluded` — measured by the shell: the card currently overlaps a
 *   conversation message row, so leaving it up would cover the chat.
 * - `override` — the user's explicit choice from the header toggle, or null
 *   to follow the measurement.
 *
 * A 'show' override only means something while the card occludes; once the
 * conversation moves out from under the card (scroll or resize) auto mode
 * shows it anyway, so the override retires itself and the header toggle goes
 * with it. A 'hide' override is sticky: the user asked for the card to stay
 * gone.
 */

export type LauncherOverride = 'show' | 'hide' | null

export interface LauncherSnapshot {
  /** The card currently overlaps conversation content. */
  occluded: boolean
  /** Explicit user choice; null follows the occlusion measurement. */
  override: LauncherOverride
}

export interface LauncherStore {
  getSnapshot(): LauncherSnapshot
  subscribe(listener: () => void): () => void
  /** Derived visibility: override wins, else show unless occluded. */
  visible(): boolean
  setOccluded(occluded: boolean): void
  /** Flip visibility with an explicit override (the header toggle). */
  toggle(): void
}

export function launcherVisible(snapshot: LauncherSnapshot): boolean {
  return snapshot.override !== null ? snapshot.override === 'show' : !snapshot.occluded
}

export function createLauncherStore(): LauncherStore {
  let snapshot: LauncherSnapshot = { occluded: false, override: null }
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const set = (patch: Partial<LauncherSnapshot>): void => {
    const next = { ...snapshot, ...patch }
    if (next.occluded === snapshot.occluded && next.override === snapshot.override) return
    snapshot = next
    emit()
  }
  const store: LauncherStore = {
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    visible() {
      return launcherVisible(snapshot)
    },
    setOccluded(occluded) {
      const override = !occluded && snapshot.override === 'show' ? null : snapshot.override
      set({ occluded, override })
    },
    toggle() {
      set({ override: launcherVisible(snapshot) ? 'hide' : 'show' })
    },
  }
  return store
}
