import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserFontCatalog,
  createFontCatalog,
  filterFontFamilies,
  fontMenuIndex,
  localFontFamilies,
  type LocalFontRecord,
} from '../src/client/features/fonts/catalog'

function deferredFonts() {
  let resolve!: (fonts: readonly LocalFontRecord[]) => void
  const promise = new Promise<readonly LocalFontRecord[]>(next => { resolve = next })
  return { promise, resolve }
}

describe('installed font families', () => {
  it('deduplicates styles and weights without limiting the available families', () => {
    const fonts = Array.from({ length: 252 }, (_, i) => ({ family: `Family ${i}` }))
    const families = localFontFamilies([
      ...fonts, ...fonts, { family: ' family 1 ' }, { family: '' }, { family: 'x'.repeat(257) },
    ])
    expect(families).toHaveLength(252)
    expect(families.slice(0, 4)).toEqual(['Family 0', 'Family 1', 'Family 2', 'Family 3'])
    expect(families.at(-1)).toBe('Family 251')
  })

  it('searches case-insensitively and accepts spaces, hyphens, and CJK names', () => {
    const families = ['JetBrains Mono', 'Noto Sans CJK SC', '思源黑体']
    expect(filterFontFamilies(families, 'jetbrains-mono', 'uiFontFamily')).toEqual(['JetBrains Mono'])
    expect(filterFontFamilies(families, 'notosans', 'uiFontFamily')).toEqual(['Noto Sans CJK SC'])
    expect(filterFontFamilies(families, '黑体', 'uiFontFamily')).toEqual(['思源黑体'])
    expect(filterFontFamilies(families, 'not installed', 'uiFontFamily')).toEqual([])
  })

  it('prioritizes code fonts while keeping other fonts available and preserving the source order', () => {
    const families = ['Arial', 'Fira Code', 'Menlo', 'PingFang SC', 'SF Mono']
    expect(filterFontFamilies(families, '', 'codeFontFamily'))
      .toEqual(['Fira Code', 'Menlo', 'SF Mono', 'Arial', 'PingFang SC'])
    expect(filterFontFamilies(families, '', 'uiFontFamily')).toEqual(families)
    expect(filterFontFamilies(families, 'pingfang', 'codeFontFamily')).toEqual(['PingFang SC'])
    expect(families[0]).toBe('Arial')
  })
})

describe('local font access', () => {
  it('calls the browser in the user gesture and shares one pending request between both fields', async () => {
    const deferred = deferredFonts()
    const reader = vi.fn(() => deferred.promise)
    const catalog = createFontCatalog(reader)
    const changed = vi.fn()
    const unsubscribe = catalog.subscribe(changed)
    const pending = catalog.load()
    expect(reader).toHaveBeenCalledTimes(1) // Synchronous: no lost transient activation.
    expect(catalog.getSnapshot().status).toBe('loading')
    expect(catalog.load()).toBe(pending)
    deferred.resolve([{ family: 'Menlo' }, { family: 'Menlo' }])
    await pending
    expect(catalog.getSnapshot()).toEqual({ status: 'ready', families: ['Menlo'] })
    expect(changed).toHaveBeenCalledTimes(2)
    await catalog.load()
    expect(reader).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('refreshes on demand to discover newly installed fonts', async () => {
    const reader = vi.fn().mockResolvedValueOnce([{ family: 'Menlo' }])
      .mockResolvedValueOnce([{ family: 'Menlo' }, { family: 'Fira Code' }])
    const catalog = createFontCatalog(reader)
    await catalog.load()
    await catalog.load(true)
    expect(reader).toHaveBeenCalledTimes(2)
    expect(catalog.getSnapshot().families).toEqual(['Fira Code', 'Menlo'])
  })

  it('reports unavailable capability instead of pretending a preset is the local list', async () => {
    const catalog = createBrowserFontCatalog({})
    await catalog.load()
    expect(catalog.getSnapshot()).toEqual({ status: 'unavailable', families: [] })
  })

  it.each(['NotAllowedError', 'SecurityError'])('respects %s and only retries an explicit refresh', async name => {
    const denied = Object.assign(new Error('Access denied'), { name })
    const reader = vi.fn().mockRejectedValueOnce(denied).mockResolvedValueOnce([{ family: 'Menlo' }])
    const catalog = createFontCatalog(reader)
    await catalog.load()
    expect(catalog.getSnapshot().status).toBe('denied')
    await catalog.load()
    expect(reader).toHaveBeenCalledTimes(1)
    await catalog.load(true)
    expect(catalog.getSnapshot()).toEqual({ status: 'ready', families: ['Menlo'] })
  })

  it('keeps the last successful list when a refresh fails', async () => {
    const reader = vi.fn().mockResolvedValueOnce([{ family: 'Menlo' }]).mockRejectedValueOnce(new Error('Read failed'))
    const catalog = createFontCatalog(reader)
    await catalog.load()
    await catalog.load(true)
    expect(catalog.getSnapshot()).toEqual({ status: 'error', families: ['Menlo'] })
  })

  it('handles synchronous capability errors', async () => {
    const catalog = createFontCatalog(() => { throw new Error('Read failed') })
    await expect(catalog.load()).resolves.toBeUndefined()
    expect(catalog.getSnapshot().status).toBe('error')
  })

  it('ignores results after disposal', async () => {
    const deferred = deferredFonts()
    const catalog = createFontCatalog(() => deferred.promise)
    const pending = catalog.load()
    catalog.dispose()
    const snapshot = catalog.getSnapshot()
    deferred.resolve([{ family: 'Menlo' }])
    await pending
    expect(catalog.getSnapshot()).toBe(snapshot)
  })

  it('retains the browser method receiver', async () => {
    const host = {
      async queryLocalFonts() {
        expect(this).toBe(host)
        return [{ family: 'PingFang SC' }]
      },
    }
    const catalog = createBrowserFontCatalog(host)
    await catalog.load()
    expect(catalog.getSnapshot().families).toEqual(['PingFang SC'])
  })
})

describe('font menu keyboard navigation', () => {
  it('wraps arrows, supports first/last keys, and handles focus entering an empty or populated list', () => {
    expect(fontMenuIndex(5, 4, 'ArrowDown')).toBe(0)
    expect(fontMenuIndex(5, 0, 'ArrowUp')).toBe(4)
    expect(fontMenuIndex(5, -1, 'ArrowUp')).toBe(4)
    expect(fontMenuIndex(5, -1, 'ArrowDown')).toBe(0)
    expect(fontMenuIndex(5, 2, 'Home')).toBe(0)
    expect(fontMenuIndex(5, 2, 'End')).toBe(4)
    expect(fontMenuIndex(5, 2, 'Enter')).toBeUndefined()
    expect(fontMenuIndex(0, -1, 'ArrowDown')).toBeUndefined()
  })
})
