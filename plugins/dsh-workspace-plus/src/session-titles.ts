import type { Context, SessionEvent, SessionHeader } from '@just-genius/dsh-plugin-runtime/host'
import { fallbackSessionTitle, SessionId } from '@just-genius/dsh-plugin-runtime/host'

import { selectSessionHeader } from './session-reference.ts'
import type { SessionTitleFact, SessionTitleLookup } from './shared.ts'

export const MAX_SESSION_TITLE_LOOKUPS = 250

function eventData(event: SessionEvent): Record<string, unknown> {
  return event.data !== null && typeof event.data === 'object'
    ? event.data as unknown as Record<string, unknown>
    : {}
}

function userText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const data = eventData(event)
  const source = data.source
  if (source === null || typeof source !== 'object' || (source as { kind?: unknown }).kind !== 'user') return undefined
  const content = data.content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block) => {
    if (block === null || typeof block !== 'object') return []
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
  return text.trim() === '' ? undefined : text
}

/** Fold the two facts the sidebar needs from a validated logical event log. */
export function sessionTitleFactFromEvents(
  lookup: SessionTitleLookup,
  events: readonly SessionEvent[],
): SessionTitleFact {
  let title: string | undefined
  let firstUserText: string | undefined
  let blank = true
  for (const event of events) {
    if (event.type === 'turn/start') blank = false
    if (firstUserText === undefined) firstUserText = userText(event)
    if (event.type !== 'session/title') continue
    const candidate = eventData(event).title
    if (typeof candidate === 'string' && candidate.trim() !== '') title = candidate.trim()
  }
  if (title !== undefined) return { ...lookup, blank, title, source: 'event' }
  if (firstUserText !== undefined) {
    const fallback = fallbackSessionTitle(firstUserText, 5, 40)
    if (fallback !== '') return { ...lookup, blank, title: fallback, source: 'fallback' }
  }
  return { ...lookup, blank }
}

export function persistenceHeaders(listed: unknown): SessionHeader[] {
  if (!Array.isArray(listed)) return []
  const headers: SessionHeader[] = []
  for (const item of listed) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const nested = record.header
    if (nested !== null && typeof nested === 'object' && typeof (nested as { id?: unknown }).id === 'string') {
      headers.push(nested as SessionHeader)
      continue
    }
    if (typeof record.id === 'string') headers.push(item as SessionHeader)
  }
  return headers
}

function eventsOf(value: unknown): SessionEvent[] | undefined {
  if (Array.isArray(value)) return value as SessionEvent[]
  if (value === null || typeof value !== 'object') return undefined
  if (typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') return undefined
  try {
    return [...value as Iterable<SessionEvent>]
  } catch {
    return undefined
  }
}

function liveSession(ctx: Context, id: string): {
  header?: SessionHeader
  events?: unknown
  snapshotEvents?: () => unknown
} | undefined {
  return ctx.sessions.get(SessionId(id)) as {
    header?: SessionHeader
    events?: unknown
    snapshotEvents?: () => unknown
  } | undefined
}

function sameRequestedSession(header: SessionHeader | undefined, lookup: SessionTitleLookup): boolean {
  if (header === undefined || String(header.id) !== lookup.id) return false
  return lookup.cwd === undefined || header.cwd === lookup.cwd
}

async function persistedEvents(
  ctx: Context,
  header: SessionHeader,
): Promise<SessionEvent[] | undefined> {
  const persistence = ctx.sessionPersistence as unknown as {
    inspect?: (id: string) => Promise<{ meta?: SessionHeader; header?: SessionHeader; events?: unknown }>
    open?: (id: string, access?: 'read') => Promise<{
      header?: SessionHeader
      read: () => Promise<{ events?: unknown }>
      close?: () => Promise<void>
    }>
  }
  if (typeof persistence.inspect === 'function') {
    const inspection = await persistence.inspect(String(header.id))
    const inspectedHeader = inspection.meta ?? inspection.header
    if (inspectedHeader !== undefined && String(inspectedHeader.id) !== String(header.id)) return undefined
    return eventsOf(inspection.events)
  }
  if (typeof persistence.open !== 'function') return undefined
  const reader = await persistence.open(String(header.id), 'read')
  try {
    const value = await reader.read()
    return eventsOf(value.events)
  } finally {
    await reader.close?.()
  }
}

async function resolveOne(
  ctx: Context,
  headers: readonly SessionHeader[],
  lookup: SessionTitleLookup,
): Promise<SessionTitleFact | undefined> {
  const live = liveSession(ctx, lookup.id)
  if (live !== undefined && sameRequestedSession(live.header, lookup)) {
    const events = eventsOf(typeof live.snapshotEvents === 'function' ? live.snapshotEvents() : live.events)
    if (events !== undefined) return sessionTitleFactFromEvents(lookup, events)
  }
  const header = selectSessionHeader(headers, lookup.id, lookup.cwd)
  if (header === undefined) return undefined
  const events = await persistedEvents(ctx, header)
  return events === undefined ? undefined : sessionTitleFactFromEvents(lookup, events)
}

/** Resolve cold titles with bounded concurrency so sidebar repair cannot flood disk IO. */
export async function resolveSessionTitleFacts(
  ctx: Context,
  lookups: readonly SessionTitleLookup[],
): Promise<SessionTitleFact[]> {
  const unique = [...new Map(lookups.slice(0, MAX_SESSION_TITLE_LOOKUPS).map((item) => [item.id, item])).values()]
  const headers = persistenceHeaders(await ctx.sessionPersistence.list())
  const facts: SessionTitleFact[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (cursor < unique.length) {
      const lookup = unique[cursor]
      cursor += 1
      if (lookup === undefined) continue
      try {
        const fact = await resolveOne(ctx, headers, lookup)
        if (fact !== undefined) facts.push(fact)
      } catch {
        // A corrupt or concurrently replaced session must not fail the batch.
      }
    }
  })
  await Promise.all(workers)
  return facts
}
