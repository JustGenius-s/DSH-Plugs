import { getResult, postResult } from '@just-genius/dsh-plugin-runtime/client'
import { MODE_PATH, STATE_PATH, type FlowActionResult, type FlowStateResponse } from '../shared.ts'

export interface FlowClientState extends FlowStateResponse {
  changing: boolean
  error: string | null
}

const EMPTY: FlowClientState = {
  plan: null,
  mode: false,
  modePending: null,
  degraded: false,
  degradedReason: null,
  changing: false,
  error: null,
}

interface Entry {
  sessionId: string
  state: FlowClientState
  listeners: Set<() => void>
  timer?: ReturnType<typeof setInterval>
  revision: number
  reading: number | null
}

interface Transport {
  read(sessionId: string): Promise<FlowStateResponse>
  write(sessionId: string, on: boolean): Promise<void>
}

/** One poller per session keeps the sidebar and composer chip in sync. */
export function createFlowStateStore(transport: Transport) {
  const entries = new Map<string, Entry>()
  const entryFor = (sessionId: string): Entry => {
    let entry = entries.get(sessionId)
    if (entry === undefined) {
      entry = { sessionId, state: EMPTY, listeners: new Set(), revision: 0, reading: null }
      entries.set(sessionId, entry)
    }
    return entry
  }
  const publish = (entry: Entry, patch: Partial<FlowClientState>) => {
    entry.state = { ...entry.state, ...patch }
    for (const listener of entry.listeners) listener()
  }
  const release = (entry: Entry) => {
    if (entry.listeners.size !== 0 || entry.state.changing) return
    entry.revision++
    if (entries.get(entry.sessionId) === entry) entries.delete(entry.sessionId)
  }
  const pull = async (entry: Entry) => {
    if (entry.state.changing || entry.reading === entry.revision) return
    const revision = ++entry.revision
    entry.reading = revision
    try {
      const value = await transport.read(entry.sessionId)
      if (revision === entry.revision) publish(entry, value)
    } catch {
      // Retain the last good snapshot; the next tick retries.
    } finally {
      if (entry.reading === revision) entry.reading = null
    }
  }

  return {
    getSnapshot: (sessionId: string) => entryFor(sessionId).state,
    async refresh(sessionId: string): Promise<void> {
      const entry = entryFor(sessionId)
      // A command mutation invalidates any read that began before it completed.
      entry.revision++
      publish(entry, { error: null })
      try {
        await pull(entry)
      } finally {
        release(entry)
      }
    },
    subscribe(sessionId: string, listener: () => void) {
      const entry = entryFor(sessionId)
      entry.listeners.add(listener)
      if (entry.listeners.size === 1) {
        void pull(entry)
        entry.timer = setInterval(() => void pull(entry), 1200)
      }
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          clearInterval(entry.timer)
          entry.timer = undefined
          release(entry)
        }
      }
    },
    async setMode(sessionId: string, on: boolean): Promise<void> {
      const entry = entryFor(sessionId)
      if (entry.state.changing) return
      entry.revision++
      publish(entry, { changing: true, error: null })
      try {
        await transport.write(sessionId, on)
        publish(entry, { mode: on, modePending: null, changing: false })
        await pull(entry)
      } catch (cause) {
        publish(entry, {
          changing: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        release(entry)
      }
    },
  }
}

export const flowState = createFlowStateStore({
  read: sessionId => getResult<FlowStateResponse>(
    `${STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
  ),
  async write(sessionId, on) {
    const result = await postResult<FlowActionResult>(
      `${MODE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { on },
    )
    if (!result.ok) throw new Error(result.message ?? 'Flow mode change failed')
  },
})
