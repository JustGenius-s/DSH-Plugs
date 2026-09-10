import type { GitTreeEntry } from '../../../shared/git-graph'
import { createSnapshotChannel } from '../../core/observable'
import { fetchFilesHostInfo, type FilesHostInfo } from './files-actions'
import { fetchTree, fetchTreeSearch } from './files-api'

interface FilesTreeSource {
  key: string
  cwd: string
  showIgnored: boolean
}

export interface FilesTreeSnapshot {
  source?: FilesTreeSource
  childrenByDir: ReadonlyMap<string, readonly GitTreeEntry[]>
  busy: boolean
  error?: string
  query: string
  expanded: ReadonlySet<string>
  matches: readonly GitTreeEntry[] | null
  searchBusy: boolean
  searchKey?: string
  hostInfo?: FilesHostInfo
}

export interface FilesTreeStore {
  getSnapshot(): FilesTreeSnapshot
  subscribe(listener: () => void): () => void
  configure(cwd: string, showIgnored: boolean): void
  refreshOpen(): Promise<void>
  prefetch(dir: string): void
  toggle(dir: string): Promise<void>
  setQuery(query: string): void
  dispose(): void
}

interface FilesTreeStoreDependencies {
  fetchTree: typeof fetchTree
  fetchTreeSearch: typeof fetchTreeSearch
  fetchHostInfo: typeof fetchFilesHostInfo
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  cancel(handle: ReturnType<typeof setTimeout>): void
  searchDelayMs: number
}

const DEFAULT_DEPENDENCIES: FilesTreeStoreDependencies = {
  fetchTree,
  fetchTreeSearch,
  fetchHostInfo: fetchFilesHostInfo,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle),
  searchDelayMs: 200,
}

function sourceKey(cwd: string, showIgnored: boolean): string {
  return `${cwd}\u0000${showIgnored ? 'ignored' : 'tracked'}`
}

/** Preserve the tree snapshot when a catch-up refresh found no real change. */
export function equalTreeEntries(
  current: readonly GitTreeEntry[] | undefined,
  next: readonly GitTreeEntry[],
): boolean {
  if (current === next) return true
  if (current === undefined || current.length !== next.length) return false
  return current.every((entry, index) => {
    const candidate = next[index]
    return candidate !== undefined
      && entry.name === candidate.name
      && entry.path === candidate.path
      && entry.kind === candidate.kind
      && entry.status === candidate.status
      && entry.ignored === candidate.ignored
  })
}

function initialSnapshot(
  source?: FilesTreeSource,
  hostInfo?: FilesHostInfo,
): FilesTreeSnapshot {
  return {
    source,
    childrenByDir: new Map(),
    busy: true,
    error: undefined,
    query: '',
    expanded: new Set(),
    matches: null,
    searchBusy: false,
    searchKey: undefined,
    hostInfo,
  }
}

/**
 * State and requests for one official Sidebar file-tab occurrence.
 *
 * The store deliberately outlives its React body: DSH may unmount an inactive
 * body while keeping the tab record alive. Requests therefore publish here,
 * not into component-local state, and stale workspace/search results are
 * rejected by their source key.
 */
export function createFilesTreeStore(
  overrides: Partial<FilesTreeStoreDependencies> = {},
): FilesTreeStore {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides }
  const channel = createSnapshotChannel<FilesTreeSnapshot>(initialSnapshot())
  const loadingDirs = new Map<string, Promise<boolean>>()
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const update = (
    updater: (current: FilesTreeSnapshot) => FilesTreeSnapshot,
  ): void => {
    if (disposed) return
    const current = channel.getSnapshot()
    const next = updater(current)
    if (next !== current) channel.publish(next)
  }

  const cancelSearch = (): void => {
    if (searchTimer === undefined) return
    dependencies.cancel(searchTimer)
    searchTimer = undefined
  }

  const loadDir = (dir: string, silent = false): Promise<boolean> => {
    const source = channel.getSnapshot().source
    if (disposed || source === undefined) return Promise.resolve(false)
    const requestKey = `${source.key}\u0000${dir}`
    const existing = loadingDirs.get(requestKey)
    if (existing !== undefined) return existing

    if (!silent && dir === '') {
      update(current => current.source?.key !== source.key
        ? current
        : { ...current, busy: true, error: undefined })
    }

    const request = dependencies.fetchTree(source.cwd, dir, source.showIgnored)
      .then((value): boolean => {
        if (disposed || channel.getSnapshot().source?.key !== source.key) return false
        if (!value.ok) {
          if (dir === '') {
            update(current => current.source?.key !== source.key
              ? current
              : { ...current, busy: false, error: value.message })
          }
          return false
        }
        update((current) => {
          if (current.source?.key !== source.key) return current
          const previous = current.childrenByDir.get(dir)
          const entriesChanged = !equalTreeEntries(previous, value.entries)
          const busy = dir === '' ? false : current.busy
          const error = dir === '' ? undefined : current.error
          if (!entriesChanged && busy === current.busy && error === current.error) {
            return current
          }
          const childrenByDir = entriesChanged
            ? new Map(current.childrenByDir).set(dir, value.entries)
            : current.childrenByDir
          return {
            ...current,
            childrenByDir,
            busy,
            error,
          }
        })
        return true
      })
      .catch((error): boolean => {
        if (dir === '') {
          update(current => current.source?.key !== source.key
            ? current
            : {
                ...current,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
              })
        }
        return false
      })
      .finally(() => {
        if (loadingDirs.get(requestKey) === request) loadingDirs.delete(requestKey)
      })
    loadingDirs.set(requestKey, request)
    return request
  }

  void dependencies.fetchHostInfo().then((hostInfo) => {
    update(current => current.hostInfo === hostInfo ? current : { ...current, hostInfo })
  }).catch(() => {})

  const store: FilesTreeStore = {
    getSnapshot: channel.getSnapshot,
    subscribe: channel.subscribe,
    configure(cwd, showIgnored) {
      const key = sourceKey(cwd, showIgnored)
      if (channel.getSnapshot().source?.key === key || disposed) return
      cancelSearch()
      loadingDirs.clear()
      const source: FilesTreeSource = { key, cwd, showIgnored }
      channel.publish(initialSnapshot(source, channel.getSnapshot().hostInfo))
      void loadDir('')
    },
    async refreshOpen() {
      const snapshot = channel.getSnapshot()
      if (snapshot.source === undefined || disposed) return
      await Promise.all(['', ...snapshot.expanded].map(dir => loadDir(dir, true)))
    },
    prefetch(dir) {
      const snapshot = channel.getSnapshot()
      if (snapshot.childrenByDir.has(dir) || snapshot.source === undefined) return
      void loadDir(dir, true)
    },
    async toggle(dir) {
      const current = channel.getSnapshot()
      const source = current.source
      if (source === undefined || disposed) return
      if (current.expanded.has(dir)) {
        update((snapshot) => {
          if (snapshot.source?.key !== source.key) return snapshot
          const expanded = new Set(snapshot.expanded)
          expanded.delete(dir)
          return { ...snapshot, expanded }
        })
        return
      }
      if (!current.childrenByDir.has(dir) && !await loadDir(dir, true)) return
      update((snapshot) => {
        if (snapshot.source?.key !== source.key || !snapshot.childrenByDir.has(dir)) return snapshot
        const expanded = new Set(snapshot.expanded)
        expanded.add(dir)
        return { ...snapshot, expanded }
      })
    },
    setQuery(query) {
      const source = channel.getSnapshot().source
      if (source === undefined || disposed) return
      cancelSearch()
      const needle = query.trim()
      if (needle.length === 0) {
        update(current => ({
          ...current,
          query,
          matches: null,
          searchBusy: false,
          searchKey: undefined,
        }))
        return
      }

      const key = `${source.key}\u0000${needle}`
      update(current => ({
        ...current,
        query,
        matches: null,
        searchBusy: true,
        searchKey: key,
      }))
      searchTimer = dependencies.schedule(() => {
        searchTimer = undefined
        void dependencies.fetchTreeSearch(source.cwd, needle, source.showIgnored)
          .then((value) => {
            update((current) => {
              if (current.searchKey !== key || current.source?.key !== source.key) return current
              return {
                ...current,
                matches: value.ok
                  ? value.entries.filter(entry => entry.kind === 'file')
                  : [],
                searchBusy: false,
              }
            })
          })
          .catch(() => {
            update(current => current.searchKey !== key
              ? current
              : { ...current, matches: [], searchBusy: false })
          })
      }, dependencies.searchDelayMs)
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelSearch()
      loadingDirs.clear()
      channel.dispose()
    },
  }
  return store
}

export interface FilesTabStateRegistry {
  /** Return the durable tree state for one official tab occurrence. */
  acquire(tabId: string, signal: AbortSignal): FilesTreeStore
  dispose(): void
}

interface FilesTabStateEntry {
  signal: AbortSignal
  store: FilesTreeStore
  abort: () => void
}

/** Keep custom Files state until the official tab signal, not its body, ends. */
export function createFilesTabStateRegistry(
  dependencies: Partial<FilesTreeStoreDependencies> = {},
): FilesTabStateRegistry {
  const entries = new Map<string, FilesTabStateEntry>()
  let disposed = false

  const remove = (tabId: string, entry: FilesTabStateEntry): void => {
    if (entries.get(tabId) !== entry) return
    entry.signal.removeEventListener('abort', entry.abort)
    entries.delete(tabId)
    entry.store.dispose()
  }

  return {
    acquire(tabId, signal) {
      if (disposed) throw new Error('FilesTabStateRegistry is disposed')
      const existing = entries.get(tabId)
      if (existing?.signal === signal) return existing.store
      if (existing !== undefined) remove(tabId, existing)

      const store = createFilesTreeStore(dependencies)
      const entry: FilesTabStateEntry = {
        signal,
        store,
        abort: () => remove(tabId, entry),
      }
      entries.set(tabId, entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      if (signal.aborted) remove(tabId, entry)
      return store
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const [tabId, entry] of [...entries]) remove(tabId, entry)
    },
  }
}
