/** State shared by the official tab title and its retained side-chat body. */
export interface SideChatTabState {
  title?: string
  sideSessionId?: string
}

export interface SideChatTabStateHandle {
  getSnapshot(): Readonly<SideChatTabState>
  subscribe(listener: () => void): () => void
}

export interface SideChatTabStateRegistry {
  readonly size: number
  acquire(key: string, signal: AbortSignal): SideChatTabStateHandle | undefined
  update(key: string, patch: SideChatTabState): void
  dispose(): void
}

interface SideChatTabStateEntry {
  signal: AbortSignal
  state: Readonly<SideChatTabState>
  listeners: Set<() => void>
  handle: SideChatTabStateHandle
  abort: () => void
}

/**
 * Keep metadata for one official tab occurrence until its `tab.signal` ends.
 *
 * DSH mounts the title and active body independently. This channel lets the
 * retained body publish its side-session id and first-message title without
 * depending on either component's mount order or on the removed custom shell.
 */
export function createSideChatTabStateRegistry(): SideChatTabStateRegistry {
  const entries = new Map<string, SideChatTabStateEntry>()
  let disposed = false

  const release = (key: string, entry: SideChatTabStateEntry): void => {
    if (entries.get(key) !== entry) return
    entries.delete(key)
    entry.signal.removeEventListener('abort', entry.abort)
    entry.listeners.clear()
  }

  const acquire = (
    key: string,
    signal: AbortSignal,
  ): SideChatTabStateHandle | undefined => {
    if (disposed) return undefined
    const current = entries.get(key)
    if (current?.signal === signal) return current.handle
    if (current !== undefined) release(key, current)
    if (signal.aborted) return undefined

    const listeners = new Set<() => void>()
    const entry = {} as SideChatTabStateEntry
    const handle: SideChatTabStateHandle = {
      getSnapshot: () => entry.state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    Object.assign(entry, {
      signal,
      state: {},
      listeners,
      handle,
      abort: () => release(key, entry),
    })
    entries.set(key, entry)
    signal.addEventListener('abort', entry.abort, { once: true })
    // AbortSignal does not replay an abort that raced with addEventListener.
    if (signal.aborted) {
      release(key, entry)
      return undefined
    }
    return handle
  }

  return {
    get size() {
      return entries.size
    },
    acquire,
    update(key, patch) {
      const entry = entries.get(key)
      if (entry === undefined) return
      const next = { ...entry.state, ...patch }
      if (
        next.title === entry.state.title
        && next.sideSessionId === entry.state.sideSessionId
      ) return
      entry.state = next
      for (const listener of [...entry.listeners]) listener()
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const [key, entry] of [...entries]) release(key, entry)
    },
  }
}
