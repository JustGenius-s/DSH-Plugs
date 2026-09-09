import { describe, expect, it, vi } from 'vitest'
import type { GitGraphTreeResponse } from '../src/shared/git-graph'
import {
  createFilesTabStateRegistry,
  createFilesTreeStore,
  equalTreeEntries,
} from '../src/client/features/files/tree-store'

function treeResponse(cwd: string, path: string): GitGraphTreeResponse {
  return {
    ok: true,
    cwd,
    path,
    entries: path === ''
      ? [{ name: 'src', path: 'src', kind: 'dir' }]
      : [{ name: 'index.ts', path: `${path}/index.ts`, kind: 'file' }],
  }
}

function dependencies() {
  return {
    fetchTree: vi.fn(async (cwd: string, path = '') => treeResponse(cwd, path)),
    fetchTreeSearch: vi.fn(async (cwd: string, query: string) => treeResponse(cwd, query)),
    fetchHostInfo: vi.fn(async () => ({ platform: 'darwin' as const, revealSupported: true })),
  }
}

describe('createFilesTreeStore', () => {
  it('recognizes structurally unchanged directory results', () => {
    const entries = [{
      name: 'index.ts',
      path: 'src/index.ts',
      kind: 'file' as const,
      status: 'modified' as const,
    }]

    expect(equalTreeEntries(entries, entries.map(entry => ({ ...entry })))).toBe(true)
    expect(equalTreeEntries(entries, [{ ...entries[0]!, status: 'added' }])).toBe(false)
  })

  it('keeps directory data and expansion when configured again for the same workspace', async () => {
    const deps = dependencies()
    const store = createFilesTreeStore(deps)

    store.configure('/workspace', true)
    await store.refreshOpen()
    await store.toggle('src')
    const retained = store.getSnapshot()

    store.configure('/workspace', true)

    expect(store.getSnapshot()).toBe(retained)
    expect(store.getSnapshot().expanded.has('src')).toBe(true)
    expect(store.getSnapshot().childrenByDir.get('src')?.[0]?.path).toBe('src/index.ts')
    expect(deps.fetchTree.mock.calls.filter(([, path]) => path === '').length).toBe(1)
  })

  it('keeps the same snapshot when a catch-up refresh returns identical entries', async () => {
    const store = createFilesTreeStore(dependencies())
    store.configure('/workspace', true)
    await store.refreshOpen()
    const retained = store.getSnapshot()

    await store.refreshOpen()

    expect(store.getSnapshot()).toBe(retained)
  })

  it('resets state when the workspace source actually changes', async () => {
    const store = createFilesTreeStore(dependencies())
    store.configure('/first', true)
    await store.toggle('src')
    expect(store.getSnapshot().expanded.has('src')).toBe(true)

    store.configure('/second', true)

    expect(store.getSnapshot().source?.cwd).toBe('/second')
    expect(store.getSnapshot().expanded.size).toBe(0)
    expect(store.getSnapshot().query).toBe('')
  })
})

describe('createFilesTabStateRegistry', () => {
  it('retains one store across body remounts and drops it only when the tab aborts', () => {
    const registry = createFilesTabStateRegistry(dependencies())
    const firstOccurrence = new AbortController()
    const first = registry.acquire('tab-1', firstOccurrence.signal)

    expect(registry.acquire('tab-1', firstOccurrence.signal)).toBe(first)

    firstOccurrence.abort()
    const secondOccurrence = new AbortController()
    const second = registry.acquire('tab-1', secondOccurrence.signal)

    expect(second).not.toBe(first)
    expect(second.getSnapshot().source).toBeUndefined()
    registry.dispose()
  })

  it('keeps the search query and results across body remounts', async () => {
    vi.useFakeTimers()
    try {
      const registry = createFilesTabStateRegistry(dependencies())
      const occurrence = new AbortController()
      const store = registry.acquire('tab-1', occurrence.signal)
      store.configure('/workspace', true)
      await store.refreshOpen()

      store.setQuery('entry')
      await vi.advanceTimersByTimeAsync(200)

      const remounted = registry.acquire('tab-1', occurrence.signal)
      expect(remounted.getSnapshot().query).toBe('entry')
      expect(remounted.getSnapshot().matches?.[0]?.path).toBe('entry/index.ts')
      registry.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
