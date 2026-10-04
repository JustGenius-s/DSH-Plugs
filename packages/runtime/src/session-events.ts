/**
 * Defensive session-log access.
 *
 * Older DSH sessions expose an `events` getter; newer ones expose
 * `snapshotEvents()`. Read either shape without assuming a caller holds a live
 * Session. A missing or non-iterable log degrades to an empty list.
 *
 * @param session - object expected to carry an event log.
 * @returns the log, or an empty array when it is absent or not iterable.
 */
export function sessionEventsOf(session: {
  events?: unknown
  snapshotEvents?: () => unknown
} | null | undefined): readonly unknown[] {
  const events = typeof session?.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session?.events
  if (events === undefined || events === null) return []
  if (Array.isArray(events)) return events
  // Strings are iterable but are never an event log — spreading one would
  // yield its characters, turning a bad input into a subtly worse one.
  if (typeof events === 'string') return []
  if (typeof (events as Iterable<unknown>)[Symbol.iterator] === 'function') {
    return [...events as Iterable<unknown>]
  }
  return []
}
