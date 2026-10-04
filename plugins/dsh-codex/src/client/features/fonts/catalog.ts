import { createSnapshotStore } from '@just-genius/dsh-plugin-runtime/client'
import { FONT_PREFERENCE_MAX_LENGTH, type FontPreferenceKey } from '../../../shared/fonts'

export interface LocalFontRecord { family: string }
export type LocalFontReader = () => Promise<readonly LocalFontRecord[]>
export interface LocalFontHost { queryLocalFonts?: LocalFontReader }
export interface FontCatalogSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'denied' | 'error'
  families: readonly string[]
}

/** Collapse weight/style faces into family names the font-family setting accepts. */
export function localFontFamilies(records: readonly LocalFontRecord[]): string[] {
  const families = new Map<string, string>()
  for (const record of records) {
    const family = typeof record?.family === 'string' ? record.family.trim() : ''
    if (family === '' || family.length > FONT_PREFERENCE_MAX_LENGTH) continue
    const key = family.toLocaleLowerCase()
    if (!families.has(key)) families.set(key, family)
  }
  return [...families.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
}

/** Enumerate on a user gesture, cache across both fields, and ignore late unloads. */
export function createFontCatalog(reader?: LocalFontReader) {
  const store = createSnapshotStore<FontCatalogSnapshot>({ status: 'idle', families: [] })
  let pending: Promise<void> | undefined
  let disposed = false
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    load(refresh = false): Promise<void> {
      if (disposed) return Promise.resolve()
      if (pending !== undefined) return pending
      if (!refresh && store.getSnapshot().status !== 'idle') return Promise.resolve()
      if (reader === undefined) {
        store.set({ status: 'unavailable', families: [] })
        return Promise.resolve()
      }
      store.set({ ...store.getSnapshot(), status: 'loading' })
      // Invoke before the first await: Local Font Access requires the click's
      // transient activation. Only family names are retained; no font blobs.
      let request: Promise<readonly LocalFontRecord[]>
      try { request = reader() } catch (error) { request = Promise.reject(error) }
      pending = request.then(records => {
        if (!disposed) store.set({ status: 'ready', families: localFontFamilies(records) })
      }, (error: unknown) => {
        if (disposed) return
        const name = error instanceof Error ? error.name : ''
        store.set({ ...store.getSnapshot(), status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error' })
      }).finally(() => { pending = undefined })
      return pending
    },
    dispose() { disposed = true },
  }
}

export type FontCatalog = ReturnType<typeof createFontCatalog>

export function createBrowserFontCatalog(host: LocalFontHost): FontCatalog {
  return createFontCatalog(typeof host.queryLocalFonts === 'function' ? () => host.queryLocalFonts!() : undefined)
}

const MONOSPACE_NAMES = /mono|code|consolas|menlo|courier|inconsolata|iosevka|cascadia|\bhack\b/i
const searchKey = (value: string): string => value.toLocaleLowerCase().replace(/[\s_-]/g, '')

/** Code fonts are ranked first, never used to hide the rest of the installed list. */
export function filterFontFamilies(families: readonly string[], query: string, field: FontPreferenceKey): string[] {
  const key = searchKey(query)
  const matches = families.filter(family => searchKey(family).includes(key))
  if (field === 'codeFontFamily') matches.sort((a, b) => Number(MONOSPACE_NAMES.test(b)) - Number(MONOSPACE_NAMES.test(a)))
  return matches
}

/** Shared keyboard policy for the picker input and its portaled menu buttons. */
export function fontMenuIndex(length: number, current: number, key: string): number | undefined {
  if (length === 0) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % length
  if (key === 'ArrowUp') return current < 0 ? length - 1 : (current - 1 + length) % length
  return undefined
}
