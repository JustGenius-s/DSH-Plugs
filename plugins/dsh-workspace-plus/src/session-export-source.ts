import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { SessionId } from '@just-genius/dsh-plugin-runtime/host'

export interface SessionExportSource {
  header: {
    id: string
    createdAt: number
    cwd?: string
    parentSession?: string
  }
  events: readonly unknown[]
}

export class SessionExportSourceError extends Error {
  readonly status: 404 | 500 | 501

  constructor(message: string, status: 404 | 500 | 501 = 500, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SessionExportSourceError'
    this.status = status
  }
}

interface ExportContext {
  get?: (name: string) => unknown
  sessionQuery?: { readSession?: (id: string) => Promise<unknown> }
  sessions?: { get?: (id: string) => unknown }
  sessionPersistence?: {
    inspect?: (id: string) => Promise<unknown>
    open?: (id: string, access: 'read') => Promise<{
      header?: unknown
      read: () => Promise<{ events?: unknown }>
      close: () => Promise<void>
    }>
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function service<K extends 'sessionQuery' | 'sessions' | 'sessionPersistence'>(
  ctx: ExportContext,
  key: K,
): ExportContext[K] {
  // Cordis exposes optional services through get(); property access would
  // require making sessionQuery a hard dependency on older hosts.
  return (typeof ctx.get === 'function' ? ctx.get(key) : ctx[key]) as ExportContext[K]
}

function sourceFrom(headerValue: unknown, eventsValue: unknown, sessionId: string): SessionExportSource {
  const header = record(headerValue)
  if (header?.id !== sessionId) {
    throw new SessionExportSourceError('Session export source does not match the requested session')
  }
  if (typeof header.createdAt !== 'number' || !Number.isFinite(header.createdAt)) {
    throw new SessionExportSourceError('Session export source has invalid creation metadata')
  }
  if (eventsValue === null || typeof eventsValue !== 'object'
    || typeof (eventsValue as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw new SessionExportSourceError('Session export source has no readable event log')
  }
  return {
    header: {
      id: sessionId,
      createdAt: header.createdAt,
      ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
      ...(typeof header.parentSession === 'string' ? { parentSession: header.parentSession } : {}),
    },
    // Capture the outer array now so a live append cannot change the export
    // while the caller serializes the immutable event values.
    events: [...eventsValue as Iterable<unknown>],
  }
}

function missingSession(error: unknown, sessionId: string): boolean {
  const value = record(error)
  return value?.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
    || value?.code === 'ENOENT'
    || value?.name === 'SessionPersistenceNotFoundError'
    // The 0.1.1 persistence coordinator predates a typed not-found error.
    || value?.message === `session "${sessionId}" not found`
}

/**
 * Read a complete logical log without activating an agent or mutating storage.
 *
 * Query reads work across modern host versions. Older deployments can expose
 * only a live log or the inspect persistence contract; the current handle
 * contract is also supported when the optional query service is absent.
 * Do not use readSurface(): model compaction removes earlier conversation
 * messages from that view, even though they remain in the raw event log.
 */
export async function readSessionExportSource(ctx: Context, sessionId: string): Promise<SessionExportSource> {
  const services = ctx as unknown as ExportContext
  const id = SessionId(sessionId)
  try {
    const query = service(services, 'sessionQuery')
    if (typeof query?.readSession === 'function') {
      const snapshot = record(await query.readSession(id))
      return sourceFrom(snapshot?.session, snapshot?.events, sessionId)
    }

    const sessions = service(services, 'sessions')
    const live = record(sessions?.get?.(id))
    if (live !== undefined) {
      const snapshot = live.snapshotEvents
      if (typeof snapshot === 'function') {
        return sourceFrom(live.header, snapshot.call(live), sessionId)
      }
      if (live.events !== undefined) return sourceFrom(live.header, live.events, sessionId)
    }

    const persistence = service(services, 'sessionPersistence')
    if (typeof persistence?.inspect === 'function') {
      const inspection = record(await persistence.inspect(id))
      return sourceFrom(inspection?.meta ?? inspection?.header, inspection?.events, sessionId)
    }
    if (typeof persistence?.open === 'function') {
      const handle = await persistence.open(id, 'read')
      let source: SessionExportSource
      try {
        const value = await handle.read()
        source = sourceFrom(handle.header, value.events, sessionId)
      } catch (error) {
        // Preserve the read failure when release fails too; both paths still
        // release the read-only handle exactly once.
        try { await handle.close() } catch { /* retain the original failure */ }
        throw error
      }
      await handle.close()
      return source
    }
    throw new SessionExportSourceError('This host does not expose a readable session history', 501)
  } catch (error) {
    if (missingSession(error, sessionId)) {
      throw new SessionExportSourceError('The requested session was not found', 404, { cause: error })
    }
    throw error
  }
}
