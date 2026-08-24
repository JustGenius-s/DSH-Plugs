import { createSnapshotChannel } from '../../core/observable'

/**
 * The collapsed launcher's visibility state, shared between the shell (which
 * measures occlusion and owns the card) and the session-header toggle (which
 * lets the user override the measurement).
 *
 * Three inputs decide visibility:
 *
 * - `chatView` — measured by the shell: whether the conversation is showing
 *   its chat view (as opposed to trajectory/waterfall). The launcher only
 *   makes sense over the chat, so leaving the chat view hides it outright.
 * - `occluded` — measured by the shell: the card currently overlaps a
 *   conversation message row, so leaving it up would cover the chat.
 * - `override` — the user's explicit choice from the header toggle, or null
 *   to follow the measurement.
 *
 * `chatView` is a hard gate: it cannot be overridden. A 'show' override only
 * means something while the card occludes; once the conversation moves out
 * from under the card (scroll or resize) auto mode shows it anyway, so the
 * override retires itself and the header toggle goes with it. Leaving the
 * chat view also retires a 'show' override, since it can no longer be
 * honored. A 'hide' override is sticky: the user asked for the card to stay
 * gone.
 */

export type LauncherOverride = 'show' | 'hide' | null

export interface LauncherSnapshot {
  /** The conversation is showing its chat view (not trajectory/waterfall). */
  chatView: boolean
  /** The card currently overlaps conversation content. */
  occluded: boolean
  /** Explicit user choice; null follows the occlusion measurement. */
  override: LauncherOverride
}

export interface LauncherStore {
  getSnapshot(): LauncherSnapshot
  subscribe(listener: () => void): () => void
  /** Derived visibility: chat view first, then override wins, else show unless occluded. */
  visible(): boolean
  /** Set whether the conversation is on its chat view (the shell's tab watch). */
  setChatView(chatView: boolean): void
  setOccluded(occluded: boolean): void
  /** Flip visibility with an explicit override (the header toggle). */
  toggle(): void
  dispose(): void
}

export function launcherVisible(snapshot: LauncherSnapshot): boolean {
  if (!snapshot.chatView) return false
  return snapshot.override !== null ? snapshot.override === 'show' : !snapshot.occluded
}

export function createLauncherStore(): LauncherStore {
  let snapshot: LauncherSnapshot = { chatView: true, occluded: false, override: null }
  const channel = createSnapshotChannel(snapshot)
  const set = (patch: Partial<LauncherSnapshot>): void => {
    const next = { ...snapshot, ...patch }
    if (next.chatView === snapshot.chatView
      && next.occluded === snapshot.occluded
      && next.override === snapshot.override) return
    snapshot = next
    channel.publish(next)
  }
  const store: LauncherStore = {
    getSnapshot: channel.getSnapshot,
    subscribe: channel.subscribe,
    visible() {
      return launcherVisible(snapshot)
    },
    setChatView(chatView) {
      // A 'show' override cannot be honored off the chat view, so leaving the
      // chat retires it rather than leaving a stale show that never applies.
      const override = !chatView && snapshot.override === 'show' ? null : snapshot.override
      set({ chatView, override })
    },
    setOccluded(occluded) {
      const override = !occluded && snapshot.override === 'show' ? null : snapshot.override
      set({ occluded, override })
    },
    toggle() {
      // Only meaningful on the chat view; guard so a stray header toggle off
      // the chat view can never paint a 'show' that the gate would contradict.
      if (!snapshot.chatView) return
      set({ override: launcherVisible(snapshot) ? 'hide' : 'show' })
    },
    dispose() {
      channel.dispose()
    },
  }
  return store
}
