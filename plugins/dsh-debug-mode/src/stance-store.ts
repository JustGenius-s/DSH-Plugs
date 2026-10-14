/**
 * Durable debug-mode stance for one session, on the storage hub.
 *
 * The stance used to be appended to the session log as `debug/mode` with
 * `{ ignorable: true }`. No shipped Session accepts that option — `append`
 * reads only `surfaceOp` and `sourceEventSeqs` — so the marker was silently
 * dropped and the record landed as an UNKNOWN, non-ignorable event. That is
 * the one thing the envelope contract forbids: a reader meeting an unknown
 * required type MUST refuse to reconstruct the session rather than skip it.
 * Real logs were left unloadable:
 *
 *   SessionFormatUnsupportedError: … contains event type "debug/mode" (seq …)
 *   unknown to this harness and not marked ignorable; refusing to interpret
 *   the log
 *
 * So the stance lives here instead: a small schema-validated domain keyed by
 * session id. The session log is never written, which keeps every log readable
 * by any harness build, and the stance still survives reload/resume.
 *
 * Reads are synchronous from the domain's authoritative in-memory state, so
 * the synchronous paths (`systemPrompt` assembly, the state route) can consult
 * it directly. Writes queue on the domain's own chain and are therefore
 * ordered; they deliberately never consult {@link StanceAccess.active} to skip
 * a redundant `put`, because a queued write has not reached memory yet and a
 * cheap "unchanged" check would drop the toggle that lands after it.
 *
 * A session id is a UUID, so a record is never inherited by a later session.
 */
import { defineDomain, domainTable, type Domain } from '@just-genius/dsh-plugin-runtime/host'
import { z } from 'zod'

/**
 * The json backend stores one document per record and requires path-safe keys,
 * so an unusual session id would reject at write time. Such an id is simply
 * kept in process memory instead.
 */
const SAFE_KEY = /^[a-zA-Z0-9_-]+$/

/** One session's persisted stance. `updatedAt` is diagnostic, never a TTL. */
const stanceRecord = z.object({
  active: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
})

/** Durable stance, one record per session. The log carries no stance at all. */
export const DEBUG_STANCE_DOMAIN = defineDomain({
  name: 'debug_stance',
  version: 1,
  tables: { sessions: domainTable(stanceRecord) },
})

/** A stored stance record. */
export type StanceRecord = z.infer<typeof stanceRecord>

/**
 * The stance seam every read and write goes through. Kept structural — rather
 * than a `Domain` — so the callers stay testable with a plain in-memory fake.
 */
export interface StanceAccess {
  /** Whether this session's last committed stance was on. */
  active(sessionId: string): boolean
  /** Record this session's stance durably. */
  set(sessionId: string, active: boolean): void
}

/** The handle `openStanceStore` returns: the seam plus its own teardown. */
export interface StanceStore extends StanceAccess {
  /** Release the domain (idempotent); the facility also closes on unmount. */
  close(): Promise<void>
}

/**
 * Stance of a host whose storage hub is unavailable: nothing is remembered
 * across reload, which is the pre-migration behavior, and in-process toggles
 * still work because the caller keeps them in `SessionDebugState.active`.
 */
export const NO_STANCE: StanceAccess = {
  active: () => false,
  set: () => {},
}

/** The declared table this store reads and writes. */
interface StanceTable {
  get(key: string): StanceRecord | undefined
  put(key: string, value: StanceRecord): Promise<void>
}

/** The opened domain, narrowed to what this store uses. */
interface StanceDomain {
  table(name: 'sessions'): StanceTable
  close(): Promise<void>
}

/**
 * The storage facility, as much of it as this store needs. A real `Context`
 * satisfies it; a test supplies an in-memory domain.
 */
export interface StanceHost {
  storageDomain: { open(spec: typeof DEBUG_STANCE_DOMAIN): Promise<StanceDomain> }
}

/**
 * The record key for a session, or `null` when the id cannot be a safe key.
 * @param sessionId - the session's id.
 */
export function stanceKey(sessionId: string): string | null {
  return SAFE_KEY.test(sessionId) ? sessionId : null
}

/**
 * Open the durable stance domain.
 *
 * @param host - a context carrying `storageDomain`.
 * @returns the store, or {@link NO_STANCE} when the domain cannot be opened
 *   (an unroutable backend, a version-mismatch medium) — a missing stance
 *   store must degrade to memory-only, never take `/debug` down with it.
 */
export async function openStanceStore(host: StanceHost): Promise<StanceStore> {
  let domain: StanceDomain
  try {
    domain = await host.storageDomain.open(DEBUG_STANCE_DOMAIN)
  } catch (error) {
    console.warn('[dsh-debug] stance store unavailable; debug mode will not persist across reload', error)
    return { ...NO_STANCE, close: async () => {} }
  }
  const table = domain.table('sessions')
  return {
    active: (sessionId) => {
      const key = stanceKey(sessionId)
      return key === null ? false : table.get(key)?.active === true
    },
    set: (sessionId, active) => {
      const key = stanceKey(sessionId)
      if (key === null) return
      void table.put(key, { active, updatedAt: Date.now() }).catch((error: unknown) => {
        console.warn('[dsh-debug] could not record the debug stance', error)
      })
    },
    close: () => domain.close(),
  }
}
