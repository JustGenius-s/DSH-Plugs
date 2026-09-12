/**
 * Defensive session-log access.
 *
 * `Session.events` is a prototype getter that snapshots an append-only log, so
 * a caller can hold an object that is not a live `Session` — a plain
 * projection, or an instance built by a second copy of dsh-session — and read
 * `undefined` from it. Iterating that throws
 * `TypeError: <expr> is not iterable`, which is exactly how this surfaced: a
 * crash while opening a side chat, with no hint that the session object had the
 * wrong shape.
 *
 * Reads routed through here degrade a missing log to "no events" instead.
 *
 * @param session - object expected to carry an event log.
 * @returns the log, or an empty array when it is absent or not iterable.
 */
export function sessionEventsOf(session: {
  events?: unknown
} | null | undefined): readonly unknown[] {
  const events = session?.events
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
