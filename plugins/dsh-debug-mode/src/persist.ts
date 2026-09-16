/**
 * Durable debug-mode stance, when the host can mark plugin events ignorable.
 *
 * DSH 0.1.6+ accepts `session.append(type, data, { ignorable: true })`. Older
 * hosts drop that envelope, and an unmarked `debug/mode` poisons reload.
 * Feature-detect the write path before appending; otherwise keep memory only.
 */

export const DEBUG_MODE_EVENT = 'debug/mode'

export interface DebugModeEvent {
  type: typeof DEBUG_MODE_EVENT
  data: { active: boolean }
}

/** The append face 0.1.6 exposes for log-only plugin events. */
export interface IgnorableAppendSession {
  append(
    type: typeof DEBUG_MODE_EVENT,
    data: { active: boolean },
    opts?: { ignorable?: true },
  ): { ignorable?: true }
}

/** True when this Session's append will persist `ignorable: true`. */
export function sessionCanPersistDebug(session: { append?: unknown }): boolean {
  if (typeof session.append !== 'function') return false
  return Function.prototype.toString.call(session.append).includes('ignorable')
}

/**
 * Append one whole-value `debug/mode` record.
 *
 * @returns whether the event landed with the ignorable marker.
 */
export function appendDebugMode(
  session: IgnorableAppendSession,
  active: boolean,
): boolean {
  if (!sessionCanPersistDebug(session)) return false
  const event = session.append(DEBUG_MODE_EVENT, { active }, { ignorable: true })
  return event.ignorable === true
}

/** Last logged debug stance, or inactive when the log has none. */
export function foldDebugActive(
  events: readonly { readonly type?: unknown; readonly data?: unknown }[],
): boolean {
  let active = false
  for (const event of events) {
    if (event.type !== DEBUG_MODE_EVENT) continue
    const data = event.data
    if (typeof data !== 'object' || data === null) continue
    const value = (data as { active?: unknown }).active
    if (typeof value === 'boolean') active = value
  }
  return active
}
