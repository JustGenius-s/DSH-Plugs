/**
 * The session's event log, across DSH versions.
 *
 * DSH 0.1.1 exposed `session.events`; 0.1.3 made the log private and moved
 * reads to `snapshotEvents()`. The pinned `@deepseek-ai/dsh-session` types in
 * this workspace still declare the old getter, so the direct read type-checked
 * and then threw "events is not iterable" on the newer runtime — which is
 * exactly how `/debug` failed. Reading through this helper works on both.
 */
import type { Session, SessionEvent } from '@just-genius/dsh-plugin-runtime/host'

/** The shapes the helper probes; the cast keeps the compat shim honest. */
export interface EventLogSource {
  /** DSH 0.1.3+ accessor. */
  snapshotEvents?: () => readonly SessionEvent[]
  /** DSH ≤ 0.1.2 accessor, private since 0.1.3. */
  events?: unknown
}

/**
 * Read one session's full event log.
 *
 * @param session - the session, or any object shaped like one (tests).
 * @returns the events in log order, or an empty log when neither accessor
 *   exists — a missing log must not crash the caller.
 */
export function sessionEvents(
  session: Session | EventLogSource,
): readonly SessionEvent[] {
  const source = session as EventLogSource
  if (typeof source.snapshotEvents === 'function') return source.snapshotEvents()
  return Array.isArray(source.events) ? (source.events as readonly SessionEvent[]) : []
}
