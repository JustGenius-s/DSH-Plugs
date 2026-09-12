/** State shared by the official tab title and its retained side-chat body. */
export interface SideChatTabState {
  /**
   * Number to draw before this window's label, absent when it needs none.
   *
   * Windows are numbered by their RANK among the side chats open in their
   * Session: the first carries no number, the second is 1, the third 2 — so a
   * lone side chat is never captioned "侧聊 1". The number exists only to tell
   * windows apart, and one window needs no separating from itself.
   */
  ordinal?: number
  title?: string
  sideSessionId?: string
}

export interface SideChatTabStateHandle {
  getSnapshot(): Readonly<SideChatTabState>
  subscribe(listener: () => void): () => void
}

/**
 * Which occurrences share one numbering sequence.
 *
 * Passed by a caller that wants its occurrence NUMBERED. Omitting it keeps the
 * occurrence out of the sequence entirely, which is what the guide's page tab
 * needs: it is a holder that renders nothing and is replaced by its own
 * resource tab one commit later, so ranking it would shift every real window's
 * number by one.
 */
export interface SideChatNumberingScope {
  sessionId: string
}

export interface SideChatTabStateRegistry {
  readonly size: number
  acquire(
    key: string,
    signal: AbortSignal,
    numbering?: SideChatNumberingScope,
  ): SideChatTabStateHandle | undefined
  update(key: string, patch: SideChatTabState): void
  dispose(): void
}

interface SideChatTabStateEntry {
  /** Numbering scope, absent when this occurrence holds no number. */
  scope?: SideChatNumberingScope
  /**
   * Creation order inside the scope, never reused.
   *
   * Kept apart from `state.ordinal` because the two answer different
   * questions: `sequence` is "when did this window open" and never changes,
   * while the published number is a rank over the windows currently open and
   * therefore DOES change when a sibling closes. Ranking from a mutable
   * counter would report the wrong order after a close.
   */
  sequence?: number
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
 * depending on either component's mount order, and it is also where a window's
 * number is assigned — the title must read the SAME number when it remounts on
 * its own, so the number cannot live in either component.
 *
 * Numbers are derived here rather than passed in because two seats need them
 * and neither can compute the other's: the title seat would have to know about
 * the body's side session, and the body cannot know what the title already
 * showed. Deriving them from the live entries keeps one source of truth.
 */
export function createSideChatTabStateRegistry(): SideChatTabStateRegistry {
  const entries = new Map<string, SideChatTabStateEntry>()
  /** Last creation order handed out per Session; monotonic, never reused. */
  const sequences = new Map<string, number>()
  let disposed = false

  /** Write one entry's published number, waking its reader only on a change. */
  const publishOrdinal = (
    entry: SideChatTabStateEntry,
    ordinal: number | undefined,
  ): void => {
    if (entry.state.ordinal === ordinal) return
    entry.state = { ...entry.state, ordinal }
    for (const listener of [...entry.listeners]) listener()
  }

  /**
   * Re-rank one Session's windows after its membership changed.
   *
   * The rank is positional over what is open right now, which is what makes
   * "a single side chat has no number" hold in every case rather than only on
   * a fresh open — close the first of three and the remaining two become the
   * unnumbered one and 1, instead of leaving a gap at the front.
   */
  const rerank = (sessionId: string): void => {
    if (disposed) return
    const ranked = [...entries.values()]
      .filter(entry => entry.scope?.sessionId === sessionId && entry.sequence !== undefined)
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
    ranked.forEach((entry, index) => {
      // index 0 is the first window, which carries no number; the second is 1.
      publishOrdinal(entry, index === 0 ? undefined : index)
    })
  }

  const release = (key: string, entry: SideChatTabStateEntry): void => {
    if (entries.get(key) !== entry) return
    entries.delete(key)
    entry.signal.removeEventListener('abort', entry.abort)
    entry.listeners.clear()
    // A closing window renumbers its siblings: they are one shorter a list now.
    if (entry.scope !== undefined) rerank(entry.scope.sessionId)
  }

  const acquire = (
    key: string,
    signal: AbortSignal,
    numbering?: SideChatNumberingScope,
  ): SideChatTabStateHandle | undefined => {
    if (disposed) return undefined
    const current = entries.get(key)
    if (current?.signal === signal) {
      // The same occurrence, re-read after it became a real window: it was
      // acquired with no scope while it was still the guide's page tab, so it
      // must join the sequence now. Without this the entry would keep its
      // scope-less state forever and the window would never be numbered —
      // correct only as long as the page tab is always replaced by a tab with
      // a NEW id, which is store behaviour this feature should not depend on.
      if (numbering !== undefined && current.scope === undefined) {
        const sequence = (sequences.get(numbering.sessionId) ?? 0) + 1
        sequences.set(numbering.sessionId, sequence)
        current.scope = numbering
        current.sequence = sequence
        rerank(numbering.sessionId)
      }
      return current.handle
    }
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
    const sequence = numbering === undefined
      ? undefined
      : (sequences.get(numbering.sessionId) ?? 0) + 1
    Object.assign(entry, {
      scope: numbering,
      sequence,
      signal,
      state: {},
      listeners,
      handle,
      abort: () => release(key, entry),
    })
    if (numbering !== undefined && sequence !== undefined) {
      sequences.set(numbering.sessionId, sequence)
    }
    entries.set(key, entry)
    signal.addEventListener('abort', entry.abort, { once: true })
    // AbortSignal does not replay an abort that raced with addEventListener.
    if (signal.aborted) {
      release(key, entry)
      return undefined
    }
    if (numbering !== undefined) rerank(numbering.sessionId)
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
        && next.ordinal === entry.state.ordinal
      ) return
      entry.state = next
      for (const listener of [...entry.listeners]) listener()
    },
    dispose() {
      if (disposed) return
      disposed = true
      // Marked disposed first: teardown must not re-rank (or notify) the
      // windows it is about to release anyway.
      for (const [key, entry] of [...entries]) release(key, entry)
      sequences.clear()
    },
  }
}

/**
 * The official tab caption for one side-chat occurrence.
 *
 * A window that already has a conversation title shows just that title: the
 * title is the better identifier once it exists, and a leading number beside
 * every tab is noise. The number is therefore a placeholder for the moment
 * before the first message — which is exactly the moment several identical
 * "侧聊" tabs are indistinguishable.
 *
 * Plain function rather than component logic so the caption contract is
 * testable without rendering anything.
 *
 * @param state - the occurrence's shared state, absent before it registers.
 * @param t - locale lookup, for a window with no message yet.
 * @returns the caption to draw in the title seat.
 */
export function sideChatTabCaption(
  state: Readonly<SideChatTabState> | undefined,
  t: (key: string) => string,
): string {
  const title = state?.title
  if (title !== undefined && title !== '') return title
  const index = state?.ordinal
  if (index === undefined) return t('view.sideChat')
  return t('sideChat.numbered').replace('{index}', String(index))
}
