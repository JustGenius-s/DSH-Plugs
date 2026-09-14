import type {
  ClientContext,
  SessionId,
  SessionListState,
} from '@just-genius/dsh-plugin-runtime/client'
import { getSessions } from '@just-genius/dsh-plugin-runtime/client'

import {
  SESSION_TITLES_PATH,
  type SessionTitleFact,
  type SessionTitleLookup,
  type SessionTitlePayload,
} from '../shared.ts'
import { postJson } from './http.ts'

interface MutableSessionListStore {
  getSnapshot: () => SessionListState
  subscribe: (listener: () => void) => () => void
}

const TITLE_REPAIR_BATCH_SIZE = 100

function hasDurableTitle(value: { title?: string }): boolean {
  return typeof value.title === 'string' && value.title.trim() !== ''
}

export function titleRepairLookups(state: SessionListState): SessionTitleLookup[] {
  const lookups: SessionTitleLookup[] = []
  for (const id of state.ids) {
    const session = state.byId[id]
    if (session === undefined || hasDurableTitle(session) || session.origin === 'subagent') continue
    lookups.push({
      id: String(session.id),
      updatedAt: session.updatedAt,
      listedBlank: session.blank,
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    })
  }
  return lookups
}

/** Apply only repairs derived from the exact list revision that requested them. */
export function applySessionTitleFacts(
  state: SessionListState,
  facts: ReadonlyMap<string, SessionTitleFact>,
): SessionListState {
  let byId: SessionListState['byId'] | undefined
  for (const [rawId, fact] of facts) {
    const id = rawId as SessionId
    const session = state.byId[id]
    if (
      session === undefined
      || session.updatedAt !== fact.updatedAt
      || session.blank !== fact.listedBlank
      || session.cwd !== fact.cwd
      || hasDurableTitle(session)
    ) continue
    const nextDisplayTitle = fact.title ?? session.displayTitle
    const nextTitle = fact.source === 'event' && fact.title !== undefined ? fact.title : session.title
    if (
      session.blank === fact.blank
      && session.displayTitle === nextDisplayTitle
      && session.title === nextTitle
    ) continue
    byId ??= { ...state.byId }
    byId[id] = {
      ...session,
      blank: fact.blank,
      displayTitle: nextDisplayTitle,
      ...(nextTitle === undefined ? {} : { title: nextTitle }),
    }
  }
  return byId === undefined ? state : { ...state, byId }
}

function lookupKey(lookup: SessionTitleLookup): string {
  return `${lookup.id}\0${lookup.cwd ?? ''}\0${lookup.updatedAt}\0${lookup.listedBlank ? '1' : '0'}`
}

/** Patch the official list read face until DSH carries complete cold projections. */
export function installSessionTitleRepair(ctx: ClientContext): () => void {
  const sessions = getSessions(ctx)
  const store = sessions.list as unknown as MutableSessionListStore
  const originalGetSnapshot = store.getSnapshot
  const repairs = new Map<string, SessionTitleFact>()
  const resolved = new Set<string>()
  let repairRevision = 0
  let cachedBase: SessionListState | undefined
  let cachedRevision = -1
  let cachedSnapshot: SessionListState | undefined

  const patchedGetSnapshot = (): SessionListState => {
    const base = originalGetSnapshot.call(store)
    if (base === cachedBase && repairRevision === cachedRevision && cachedSnapshot !== undefined) {
      return cachedSnapshot
    }
    cachedBase = base
    cachedRevision = repairRevision
    cachedSnapshot = applySessionTitleFacts(base, repairs)
    return cachedSnapshot
  }
  store.getSnapshot = patchedGetSnapshot

  let stopped = false
  let timer = 0
  let running = false
  const schedule = (delay = 50): void => {
    if (stopped || running || timer !== 0) return
    timer = window.setTimeout(() => {
      timer = 0
      void refresh()
    }, delay)
  }
  const refresh = async (): Promise<void> => {
    if (stopped || running) return
    const pending = titleRepairLookups(originalGetSnapshot.call(store))
      .filter((lookup) => !resolved.has(lookupKey(lookup)))
      .slice(0, TITLE_REPAIR_BATCH_SIZE)
    if (pending.length === 0) return
    running = true
    let retry = false
    let continueBatches = false
    try {
      const payload = await postJson<SessionTitlePayload>(SESSION_TITLES_PATH, { sessions: pending })
      for (const lookup of pending) resolved.add(lookupKey(lookup))
      continueBatches = true
      let changed = false
      for (const fact of payload.sessions) {
        const previous = repairs.get(fact.id)
        if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(fact)) changed = true
        repairs.set(fact.id, fact)
      }
      if (changed) {
        repairRevision += 1
        const refreshSessions = sessions as { refresh?: () => Promise<unknown> }
        await refreshSessions.refresh?.().catch(() => undefined)
      }
    } catch {
      retry = true
    } finally {
      running = false
      if (retry) schedule(2_000)
      else if (continueBatches) schedule(0)
    }
  }

  const unsubscribe = store.subscribe(() => { schedule() })
  schedule(0)
  return () => {
    stopped = true
    unsubscribe()
    if (timer !== 0) window.clearTimeout(timer)
    if (store.getSnapshot === patchedGetSnapshot) store.getSnapshot = originalGetSnapshot
  }
}
