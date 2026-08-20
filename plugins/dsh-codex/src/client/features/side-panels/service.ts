/**
 * The side-panels store and the imperative `ctx.sidePanels` service.
 *
 * The store is a tiny observable: open flag, panel width, and the OPEN PANEL
 * INSTANCES for the current session plus which one is active (persisted to
 * localStorage). The service is the thin imperative face other plugins use to
 * drive the shell (open / close / activate); the shell reads the same store
 * through useSyncExternalStore. One instance per client activation — created
 * in the feature's activate, never a module singleton.
 *
 * Instances, not panels, are the unit of state. A panel that declares
 * `multi` can be opened several times over (one terminal per tab); a
 * single-instance panel reuses its one instance no matter how often it is
 * opened. Each instance carries a `key` the shell also uses as the React key
 * of its rendered subtree, so instances keep independent component state.
 */

import type { PanelIconName } from './icons'

/** One open panel instance: a tab in the strip. */
export interface SidePanelInstance {
  /**
   * Stable per-instance identity, `<panelId>#<n>`. Also the React key of the
   * instance's rendered subtree, so its component state survives tab switches
   * and sibling opens/closes.
   */
  key: string
  /** The registered `side.panel` entry this instance renders. */
  panelId: string
  /**
   * Optional navigation payload for this instance, carried so an opening call
   * can locate a panel (e.g. which file a `files` instance is showing). Stored
   * on the instance so it survives tab restore and sibling switches.
   */
  state?: PanelNavState
}

/**
 * Where a panel instance should navigate when it mounts. `files` uses
 * `mode`/`file`/`sha`; the git panel uses `view`/`title`. Other panels may
 * add their own shapes over time.
 */
export interface PanelNavState {
  mode?: 'tree' | 'preview' | 'diff'
  /** Absolute or relative file path the instance focuses on. */
  file?: string
  /** A commit the file is shown against (diff mode); absent = working tree. */
  sha?: string
  /** Git panel: which view the instance shows (default = changes). */
  view?: 'changes' | 'graph'
  /** Tab caption override (the git graph tab reads "Graph", not "Git 2"). */
  title?: string
}

export interface SidePanelSessionSnapshot {
  /** Session owning these panel instances. */
  sessionId: string
  /** Open instances for this session, in tab order. */
  instances: readonly SidePanelInstance[]
  /** Active instance key (null = none). */
  activeKey: string | null
}

export interface SidePanelsSnapshot {
  /** Whether the sidebar is open. */
  open: boolean
  /** Panel width in px. */
  width: number
  /** Session currently shown by the host session store. */
  currentSessionId: string | undefined
  /** Open instances for the current session, in tab order. */
  instances: readonly SidePanelInstance[]
  /** Active instance key (null = none). */
  activeKey: string | null
  /** Recently used session panels kept mounted for fast switching. */
  retainedSessions: readonly SidePanelSessionSnapshot[]
}

/**
 * What a panel tells the host about itself, beyond its slot registration.
 *
 * The `side.panel` slot contract is closed (`{ id, order?, label?, priority? }`),
 * so presentation extras cannot ride the registration. A panel reports them
 * here instead. Everything is optional.
 */
export interface SidePanelDescriptor {
  /**
   * Leading glyph for the panel's launcher row and tab.
   *
   * Prefer a NAME from the host's panel glyph set (`'terminal'`, `'git'`,
   * `'files'`, `'browser'`, `'chat'`, `'command'`, `'panel'`): the host owns
   * the drawing, so every row stays on one visual language and a panel ships
   * no icon code. A thunk is the escape hatch for a glyph outside that set.
   * Omit entirely and the row falls back to the generic panel mark.
   */
  icon?: PanelIconName | (() => unknown)
  /**
   * Whether this panel supports several concurrent instances (several
   * terminals, each its own tab). Default false — a single-instance panel
   * reuses its one instance, so opening it again just activates it.
   *
   * A panel opting in MUST tolerate being mounted more than once at the same
   * time: each instance gets its own React subtree (keyed by instance key) and
   * receives its `instanceKey` in owner props, so any per-instance backend
   * resource has to be keyed off that rather than off the session alone.
   */
  multi?: boolean
}

export interface SidePanelsService {
  /**
   * Report presentation facts for a panel id (see {@link SidePanelDescriptor}).
   * Call from the panel plugin's `apply`, wrapped in `ctx.effect` so the
   * descriptor retracts when that plugin unloads. Returns the disposer.
   *
   * Keyed by panel id, independent of slot registration order: reporting
   * before or after `ctx.slots.register` both work.
   */
  describe(id: string, descriptor: SidePanelDescriptor): () => void
  /** The descriptor reported for `id`, or undefined when none was. */
  descriptor(id: string): SidePanelDescriptor | undefined
  /**
   * Open the sidebar. With `id`, ensure that panel has an instance and
   * activate it: a `multi` panel gets a NEW instance every call, a
   * single-instance panel reuses its existing one. When `state` is given, a
   * reused single instance updates its navigation state in place.
   */
  open(id?: string, state?: PanelNavState): void
  /** Close the sidebar (instances stay open, so reopening restores the tabs). */
  close(): void
  /** Toggle the sidebar; `id` also opens/activates that panel. */
  toggle(id?: string): void
  /** Same as {@link open} with an id — kept as the intent-named alias. */
  activate(id: string): void
  /** Activate an already-open instance by its key. */
  activateInstance(key: string): void
  /**
   * Close one instance. Activation falls to its neighbour (right, else left);
   * closing the last instance also closes the sidebar, so no empty shell is
   * left behind.
   */
  closeInstance(key: string): void
  /** Close every instance except `key`, and activate it. */
  closeOthers(key: string): void
  /**
   * Close every instance to the right of `key`. When the active instance is
   * among them, activation falls back to `key`.
   */
  closeToRight(key: string): void
  /** Close all instances and the sidebar itself. */
  closeAll(): void
  /**
   * Override one instance's tab caption (stored on its nav state, so the
   * name persists with the tab). An empty title clears the override and
   * restores the default caption.
   */
  renameInstance(key: string, title: string): void
  /** Move one instance to `toIndex` in the tab strip (clamped). */
  moveInstance(key: string, toIndex: number): void
  /** Current snapshot. */
  getSnapshot(): SidePanelsSnapshot
  /** Subscribe to store changes. Returns the unsubscriber. */
  subscribe(listener: () => void): () => void
}

const WIDTH_KEY = 'dsh-side-panels:width'
const OPEN_KEY = 'dsh-side-panels:open'
/** Per-session open instances (JSON). */
const TABS_KEY_PREFIX = 'dsh-side-panels:tabs:'
/** Legacy per-session single active panel id, migrated on read. */
const LEGACY_ACTIVE_KEY_PREFIX = 'dsh-side-panels:active:'
// Panel is a right-docked column, so its clamp mirrors AppFrame's details
// column (DETAILS_MIN / DETAILS_MAX / DETAILS_DEFAULT in ui-layout columns.ts)
// rather than a free-form width. The ceiling is config-driven
// (`panelMaxWidth`); DEFAULT_MAX_WIDTH only seeds a store that never received
// a preference.
const DEFAULT_WIDTH = 360
const MIN_WIDTH = 300
const DEFAULT_MAX_WIDTH = 720
const MAX_RETAINED_SESSIONS = 8

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? NaN : Number.parseInt(raw, 10)
    return Number.isNaN(value) ? fallback : value
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private mode, quota) — stay in-memory
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export interface SidePanelsStore extends SidePanelsService {
  /** Switch the active session: loads that session's remembered tabs. */
  setSession(sessionId: string | undefined): void
  /** Drop cached panel subtrees for sessions that no longer exist. */
  pruneSessions(sessionIds: readonly string[]): void
  /** Current session id. */
  currentSession(): string | undefined
  /** Set the panel width (clamped, persisted). */
  setWidth(width: number): void
  /** Update config-driven defaults without overwriting a dragged width. */
  setPreferences(preferences: SidePanelsStoreOptions): void
}

/** Persisted per-session tab state. */
interface StoredTabs {
  instances: SidePanelInstance[]
  activeKey: string | null
}

/**
 * Restore a session's tabs, tolerating both shapes on disk: the current tab
 * record, and the legacy single-`activeId` key from before instances existed
 * (promoted to a one-instance strip so an upgrade keeps the user's panel).
 * @param id - session id, or undefined outside a session.
 * @returns instances and the active key.
 */
function readTabs(id: string | undefined, rememberTabs: boolean): StoredTabs {
  if (id === undefined || !rememberTabs) return { instances: [], activeKey: null }
  const raw = readStorage(TABS_KEY_PREFIX + id)
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown
      // Hand-editable storage: validate rather than trust the shape.
      if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as StoredTabs).instances)) {
        const instances = (parsed as StoredTabs).instances.filter(
          (i): i is SidePanelInstance =>
            typeof i === 'object' && i !== null
            && typeof i.key === 'string' && typeof i.panelId === 'string',
        )
        const stored = (parsed as StoredTabs).activeKey
        const activeKey = typeof stored === 'string' && instances.some(i => i.key === stored)
          ? stored
          : instances[0]?.key ?? null
        return { instances, activeKey }
      }
    } catch {
      // corrupt record — fall through to the legacy read, then to empty
    }
  }
  const legacy = readStorage(LEGACY_ACTIVE_KEY_PREFIX + id)
  if (legacy !== null && legacy !== '') {
    const key = legacy + '#1'
    return { instances: [{ key, panelId: legacy }], activeKey: key }
  }
  return { instances: [], activeKey: null }
}

/** Create the store + service pair for one client activation. */
export interface SidePanelsStoreOptions {
  defaultWidth?: number
  maxWidth?: number
  rememberTabs?: boolean
}

export function createSidePanelsStore(options: SidePanelsStoreOptions = {}): SidePanelsStore {
  let sessionId: string | undefined
  let rememberTabs = options.rememberTabs ?? true
  let maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
  const clampWidth = (width: number): number =>
    Math.min(maxWidth, Math.max(MIN_WIDTH, width))
  // Panel-reported presentation facts, keyed by panel id. Held outside the
  // snapshot: descriptors are not user state and never persist.
  const descriptors = new Map<string, SidePanelDescriptor>()
  // Monotonic per-panel counter backing instance keys. Never reused within a
  // page: a closed-and-reopened tab must not collide with the React subtree of
  // the one it replaced.
  const counters = new Map<string, number>()
  const retained = new Map<string, SidePanelSessionSnapshot>()
  let snapshot: SidePanelsSnapshot = {
    open: readBool(OPEN_KEY, false),
    width: clampWidth(readNumber(WIDTH_KEY, clampWidth(options.defaultWidth ?? DEFAULT_WIDTH))),
    currentSessionId: undefined,
    instances: [],
    activeKey: null,
    retainedSessions: [],
  }
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const retainCurrentSession = (next: SidePanelsSnapshot): void => {
    if (sessionId === undefined) return
    retained.delete(sessionId)
    retained.set(sessionId, {
      sessionId,
      instances: next.instances,
      activeKey: next.activeKey,
    })
    while (retained.size > MAX_RETAINED_SESSIONS) {
      const oldest = retained.keys().next().value
      if (oldest === undefined) break
      retained.delete(oldest)
    }
  }

  const setSnapshot = (patch: Partial<SidePanelsSnapshot>): void => {
    const next = { ...snapshot, ...patch, currentSessionId: sessionId }
    retainCurrentSession(next)
    snapshot = { ...next, retainedSessions: [...retained.values()] }
    emit()
  }

  /** Persist the current session's tab strip. */
  const saveTabs = (): void => {
    if (sessionId === undefined || !rememberTabs) return
    writeStorage(TABS_KEY_PREFIX + sessionId, JSON.stringify({
      instances: snapshot.instances,
      activeKey: snapshot.activeKey,
    }))
  }

  /**
   * Seed the counter for a panel above every restored key, so a fresh instance
   * cannot take a key a restored tab already holds.
   */
  const seedCounters = (instances: readonly SidePanelInstance[]): void => {
    for (const instance of instances) {
      const n = Number.parseInt(instance.key.slice(instance.panelId.length + 1), 10)
      if (Number.isNaN(n)) continue
      counters.set(instance.panelId, Math.max(counters.get(instance.panelId) ?? 0, n))
    }
  }

  const nextKey = (panelId: string): string => {
    const n = (counters.get(panelId) ?? 0) + 1
    counters.set(panelId, n)
    return panelId + '#' + String(n)
  }

  const store: SidePanelsStore = {
    describe(id, descriptor) {
      descriptors.set(id, descriptor)
      // A late report must repaint an already-open launcher card.
      emit()
      return () => {
        if (descriptors.get(id) !== descriptor) return
        descriptors.delete(id)
        emit()
      }
    },
    descriptor(id) {
      return descriptors.get(id)
    },
    open(id, state) {
      if (id === undefined) {
        setSnapshot({ open: true })
        writeStorage(OPEN_KEY, '1')
        return
      }
      // Single-instance panels reuse their tab; multi panels add one.
      const existing = descriptors.get(id)?.multi === true
        ? undefined
        : snapshot.instances.find(i => i.panelId === id)
      if (existing !== undefined) {
        const instance = state === undefined
          ? existing
          : { ...existing, state }
        const instances = instance === existing
          ? snapshot.instances
          : snapshot.instances.map(i => i.key === existing.key ? instance : i)
        setSnapshot({ open: true, activeKey: existing.key, instances })
      } else {
        const instance: SidePanelInstance = { key: nextKey(id), panelId: id }
        if (state !== undefined) instance.state = state
        setSnapshot({
          open: true,
          instances: [...snapshot.instances, instance],
          activeKey: instance.key,
        })
      }
      writeStorage(OPEN_KEY, '1')
      saveTabs()
    },
    close() {
      setSnapshot({ open: false })
      writeStorage(OPEN_KEY, '0')
    },
    toggle(id) {
      if (snapshot.open) {
        store.close()
      } else {
        store.open(id)
      }
    },
    activate(id) {
      store.open(id)
    },
    activateInstance(key) {
      if (!snapshot.instances.some(i => i.key === key)) return
      setSnapshot({ open: true, activeKey: key })
      writeStorage(OPEN_KEY, '1')
      saveTabs()
    },
    closeInstance(key) {
      const index = snapshot.instances.findIndex(i => i.key === key)
      if (index === -1) return
      const instances = snapshot.instances.filter(i => i.key !== key)
      if (instances.length === 0) {
        // No empty shell: closing the last tab closes the sidebar.
        setSnapshot({ open: false, instances, activeKey: null })
        writeStorage(OPEN_KEY, '0')
        saveTabs()
        return
      }
      // Activation falls to the right neighbour, else the left.
      const activeKey = snapshot.activeKey === key
        ? (instances[Math.min(index, instances.length - 1)]?.key ?? null)
        : snapshot.activeKey
      setSnapshot({ instances, activeKey })
      saveTabs()
    },
    closeOthers(key) {
      const instance = snapshot.instances.find(i => i.key === key)
      if (instance === undefined || snapshot.instances.length < 2) return
      setSnapshot({ instances: [instance], activeKey: key })
      saveTabs()
    },
    closeToRight(key) {
      const index = snapshot.instances.findIndex(i => i.key === key)
      if (index === -1 || index === snapshot.instances.length - 1) return
      const instances = snapshot.instances.slice(0, index + 1)
      const activeKey = instances.some(i => i.key === snapshot.activeKey)
        ? snapshot.activeKey
        : key
      setSnapshot({ instances, activeKey })
      saveTabs()
    },
    closeAll() {
      if (snapshot.instances.length === 0) return
      // Same contract as closing the last tab: no empty shell left behind.
      setSnapshot({ open: false, instances: [], activeKey: null })
      writeStorage(OPEN_KEY, '0')
      saveTabs()
    },
    renameInstance(key, title) {
      const trimmed = title.trim()
      let found = false
      const instances = snapshot.instances.map(i => {
        if (i.key !== key) return i
        found = true
        const state = { ...i.state }
        if (trimmed === '') delete state.title
        else state.title = trimmed
        return { ...i, state }
      })
      if (!found) return
      setSnapshot({ instances })
      saveTabs()
    },
    moveInstance(key, toIndex) {
      const from = snapshot.instances.findIndex(i => i.key === key)
      if (from === -1) return
      const to = Math.max(0, Math.min(snapshot.instances.length - 1, toIndex))
      if (to === from) return
      const instances = [...snapshot.instances]
      const moved = instances.splice(from, 1)[0]
      if (moved === undefined) return
      instances.splice(to, 0, moved)
      setSnapshot({ instances })
      saveTabs()
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setSession(next) {
      if (next === sessionId) return
      sessionId = next
      const { instances, activeKey } = readTabs(next, rememberTabs)
      seedCounters(instances)
      setSnapshot({ instances, activeKey })
    },
    pruneSessions(ids) {
      const allowed = new Set(ids)
      let changed = false
      for (const id of retained.keys()) {
        if (allowed.has(id)) continue
        retained.delete(id)
        changed = true
      }
      if (changed) {
        snapshot = { ...snapshot, retainedSessions: [...retained.values()] }
        emit()
      }
    },
    currentSession() {
      return sessionId
    },
    setWidth(width) {
      const clamped = clampWidth(width)
      setSnapshot({ width: clamped })
      writeStorage(WIDTH_KEY, String(clamped))
    },
    setPreferences(preferences) {
      if (preferences.rememberTabs !== undefined) rememberTabs = preferences.rememberTabs
      const nextMax = preferences.maxWidth ?? maxWidth
      if (nextMax !== maxWidth) {
        maxWidth = nextMax
        // A lowered ceiling re-clamps the remembered width so the panel never
        // renders wider than the new limit; a raised one leaves it alone.
        const width = clampWidth(snapshot.width)
        if (width !== snapshot.width) {
          setSnapshot({ width })
          writeStorage(WIDTH_KEY, String(width))
        }
      }
      if (preferences.defaultWidth === undefined || readStorage(WIDTH_KEY) !== null) return
      const width = clampWidth(preferences.defaultWidth)
      if (width !== snapshot.width) setSnapshot({ width })
    },
  }
  return store
}
