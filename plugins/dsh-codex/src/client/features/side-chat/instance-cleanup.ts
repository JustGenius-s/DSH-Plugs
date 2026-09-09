/**
 * Releasing side chats whose panel has been switched off.
 *
 * Kept apart from the feature's registration module so it can be tested
 * without the component graph that module pulls in (React primitives, CSS
 * injection, session bindings) — the logic here is a pure read over the
 * side-panels store plus one host call per id.
 */

import type { SidePanelsStore } from '../side-panels/service'
import { sideChatApi } from './api'

/** The side-panels id owned by this feature. */
export const SIDE_CHAT_PANEL_ID = 'side-chat'

/**
 * Release every side chat the open tabs own.
 *
 * Called when the panel is switched off. The shell drops instances whose panel
 * is no longer registered, so their components unmount — but the unmount only
 * closes a side chat it has already forked, and it never runs at all for a
 * retained pane the user is not looking at. Closing here is what guarantees a
 * switched-off feature leaves no side agent running and holding its session
 * open.
 *
 * The two buckets matter: `instances` is the current session's strip, while
 * `retainedSessions` keeps recently-viewed sessions mounted for fast
 * switching. Reading only the first would abandon the side chats on every
 * session the user is not currently looking at.
 *
 * Idempotent by construction — the same id is closed once per call (deduped),
 * and a repeat call for an already-closed id gets a 404 from the Host, which
 * is swallowed. So a repeated settings change, or a double-invoked effect,
 * cannot double-close.
 *
 * @param store - the side-panels store holding the instances.
 * @param close - the close call; injectable so tests assert the ids without a
 *   Host. Defaults to the real API.
 * @returns the ids it asked the Host to close, in strip order.
 */
export function closeAllSideChatInstances(
  store: SidePanelsStore,
  close: (sideSessionId: string) => Promise<unknown> = id => sideChatApi.close(id),
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const snapshot = store.getSnapshot()
  const buckets = [
    ...snapshot.instances,
    // A retained bucket whose panel session differs still owns live side
    // agents; the switch is global, so it must reach them too.
    ...snapshot.retainedSessions.flatMap(session => session.instances),
  ]
  for (const instance of buckets) {
    if (instance.panelId !== SIDE_CHAT_PANEL_ID) continue
    const id = instance.state?.sideSessionId
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    // Fire-and-forget: one unreachable side chat must not block releasing the
    // rest, and a failure here is not actionable for the user.
    void Promise.resolve(close(id)).catch(() => {})
  }
  return ids
}
