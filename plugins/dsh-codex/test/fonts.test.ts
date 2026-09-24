import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../src/shared/config'
import { fontFamilyStack, TERMINAL_FONT_FALLBACK } from '../src/shared/fonts'
import { bindFontPreferences, saveFontPreference, whenFontReady, type FontStyleTarget } from '../src/client/features/fonts/controller'
import { measureCells } from '../src/client/features/terminal/cell-render'

function preferences(initial: Partial<DshCodexConfig> = {}) {
  let snapshot: ReturnType<SettingsScope<DshCodexConfig>['getSnapshot']> = {
    status: 'ready', writable: true, mode: 'host', revision: 1,
    base: {}, user: {}, value: { ...DEFAULT_CONFIG, ...initial },
  }
  const listeners = new Set<() => void>()
  const publish = (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }
  const scope: SettingsScope<DshCodexConfig> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(async (field, value) => {
      publish({ value: { ...snapshot.value!, [field]: value }, revision: (snapshot.revision ?? 0) + 1 })
    }),
    unset: vi.fn(async () => {}),
  }
  return { scope, listeners, publish }
}

// Exercise the style capability contract without a document or rendered components.
function styleFixture() {
  const entries = new Map<string, { value: string; priority: string }>()
  const style: FontStyleTarget = {
    getPropertyValue: property => entries.get(property)?.value ?? '',
    getPropertyPriority: property => entries.get(property)?.priority ?? '',
    setProperty(property, value, priority) {
      entries.set(property, { value: value ?? '', priority: priority ?? '' })
    },
    removeProperty(property) {
      const previous = entries.get(property)?.value ?? ''
      entries.delete(property)
      return previous
    },
  }
  const readDefault = (property: string) => style.getPropertyValue(property) || (property === '--dsw-font-family' ? 'system-ui' : 'monospace')
  return { style, readDefault }
}

describe('font families', () => {
  it('quotes named fonts, preserves ordered CJK fallbacks and CSS generic families', () => {
    expect(fontFamilyStack(' "Inter", PingFang SC, sans-serif ', 'system-ui'))
      .toBe('"Inter", "PingFang SC", sans-serif, system-ui')
    expect(fontFamilyStack('', TERMINAL_FONT_FALLBACK)).toBe(TERMINAL_FONT_FALLBACK)
    expect(fontFamilyStack(undefined, 'system-ui')).toBe('system-ui')
  })

  it('treats punctuation as a font name rather than an injected declaration', () => {
    expect(fontFamilyStack('Acme"; color: red; /*', 'monospace'))
      .toBe('"Acme\\"; color: red; /*", monospace')
    expect(fontFamilyStack('Line\nBreak', 'monospace')).toBe('"LineBreak", monospace')
  })
})

describe('live font preferences', () => {
  it('leaves platform defaults untouched until a font is selected', () => {
    const { scope } = preferences()
    const { style, readDefault } = styleFixture()
    const set = vi.spyOn(style, 'setProperty')
    const remove = vi.spyOn(style, 'removeProperty')
    const dispose = bindFontPreferences(scope, style, readDefault)
    dispose()
    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('updates each font independently and resets or disposes back to inherited defaults', async () => {
    const { scope, listeners } = preferences({ uiFontFamily: 'Inter', codeFontFamily: 'Menlo' })
    const { style, readDefault } = styleFixture()
    const dispose = bindFontPreferences(scope, style, readDefault)
    expect(style.getPropertyValue('--dsw-font-family')).toBe('"Inter", system-ui')
    expect(style.getPropertyValue('--ds-font-family-code')).toBe('"Menlo", monospace')
    await saveFontPreference(scope, 'uiFontFamily', 'PingFang SC')
    expect(style.getPropertyValue('--dsw-font-family')).toBe('"PingFang SC", system-ui')
    await saveFontPreference(scope, 'codeFontFamily', '')
    expect(style.getPropertyValue('--ds-font-family-code')).toBe('')
    dispose()
    expect(listeners.size).toBe(0)
    expect(style.getPropertyValue('--dsw-font-family')).toBe('')
    await scope.set('uiFontFamily', 'Inter')
    expect(style.getPropertyValue('--dsw-font-family')).toBe('')
  })

  it('restores an existing inline value and its priority', () => {
    const { scope } = preferences({ uiFontFamily: 'Inter' })
    const { style, readDefault } = styleFixture()
    style.setProperty('--dsw-font-family', 'ExistingFont', 'important')
    const dispose = bindFontPreferences(scope, style, readDefault)
    expect(style.getPropertyValue('--dsw-font-family')).toBe('"Inter", ExistingFont')
    dispose()
    expect(style.getPropertyValue('--dsw-font-family')).toBe('ExistingFont')
    expect(style.getPropertyPriority('--dsw-font-family')).toBe('important')
  })

  it('does not erase a later override from another owner', () => {
    const { scope } = preferences({ codeFontFamily: 'Fira Code' })
    const { style, readDefault } = styleFixture()
    const dispose = bindFontPreferences(scope, style, readDefault)
    style.setProperty('--ds-font-family-code', 'AnotherOwner')
    dispose()
    expect(style.getPropertyValue('--ds-font-family-code')).toBe('AnotherOwner')
  })

  it('restores the latest owner if a subsequent font change temporarily replaces it', async () => {
    const { scope } = preferences({ codeFontFamily: 'Fira Code' })
    const { style, readDefault } = styleFixture()
    const dispose = bindFontPreferences(scope, style, readDefault)
    style.setProperty('--ds-font-family-code', 'AnotherOwner', 'important')
    await saveFontPreference(scope, 'codeFontFamily', 'Menlo')
    expect(style.getPropertyValue('--ds-font-family-code')).toBe('"Menlo", AnotherOwner')
    dispose()
    expect(style.getPropertyValue('--ds-font-family-code')).toBe('AnotherOwner')
    expect(style.getPropertyPriority('--ds-font-family-code')).toBe('important')
  })

  it('ignores unrelated preference updates and releases fonts when the form disappears', async () => {
    const { scope, publish } = preferences({ uiFontFamily: 'Inter' })
    const { style, readDefault } = styleFixture()
    const set = vi.spyOn(style, 'setProperty')
    const dispose = bindFontPreferences(scope, style, readDefault)
    await scope.set('terminalFontSize', 16)
    expect(set).toHaveBeenCalledTimes(1)
    publish({ status: 'unavailable', writable: false })
    expect(style.getPropertyValue('--dsw-font-family')).toBe('')
    dispose()
  })
})

describe('font saves', () => {
  it('persists trimmed names and reports rejected writes without losing accepted values', async () => {
    const { scope } = preferences()
    await saveFontPreference(scope, 'uiFontFamily', '  Inter, PingFang SC  ')
    expect(scope.getSnapshot().value?.uiFontFamily).toBe('Inter, PingFang SC')
    const rejected = { ...scope, set: vi.fn(async () => {}) }
    await expect(saveFontPreference(rejected, 'uiFontFamily', 'Missing update')).rejects.toThrow('not saved')
    expect(scope.getSnapshot().value?.uiFontFamily).toBe('Inter, PingFang SC')
  })

  it('does not write unchanged or read-only settings', async () => {
    const { scope, publish } = preferences({ codeFontFamily: 'Menlo' })
    await saveFontPreference(scope, 'codeFontFamily', 'Menlo')
    expect(scope.set).not.toHaveBeenCalled()
    publish({ writable: false })
    await expect(saveFontPreference(scope, 'codeFontFamily', 'Fira Code')).rejects.toThrow('not writable')
    expect(scope.set).not.toHaveBeenCalled()
  })
})

describe('terminal font metrics', () => {
  it('measures the selected family when calculating terminal columns', () => {
    const measurement = {
      font: '',
      measureText: () => ({ width: measurement.font.includes('Wide Mono') ? 100 : 80 }),
    }
    const context = measurement as unknown as CanvasRenderingContext2D
    const narrow = measureCells(context, fontFamilyStack('Narrow Mono', TERMINAL_FONT_FALLBACK), 12, 1.2)
    const wide = measureCells(context, fontFamilyStack('Wide Mono', TERMINAL_FONT_FALLBACK), 12, 1.2)
    expect(context.font).toBe(`12px "Wide Mono", ${TERMINAL_FONT_FALLBACK}`)
    expect(Math.floor(800 / narrow.cellWidth)).toBe(100)
    expect(Math.floor(800 / wide.cellWidth)).toBe(80)
  })

  it('remeasures after font loading, cancelling stale callbacks after a font switch or disposal', async () => {
    let resolve!: (faces: FontFace[]) => void
    const fonts = { load: vi.fn(() => new Promise<FontFace[]>(done => { resolve = done })) }
    const stale = vi.fn()
    const cancel = whenFontReady(fonts, '12px "Old Mono"', stale)
    cancel()
    resolve([])
    await Promise.resolve()
    expect(stale).not.toHaveBeenCalled()
    const current = vi.fn()
    whenFontReady(fonts, '12px "New Mono"', current)
    resolve([])
    await Promise.resolve()
    expect(current).toHaveBeenCalledTimes(1)
    expect(fonts.load).toHaveBeenLastCalledWith('12px "New Mono"')
  })

  it('keeps the fallback metrics when the requested font cannot load', async () => {
    const callback = vi.fn()
    whenFontReady({ load: async () => { throw new Error('unavailable font') } }, '12px monospace', callback)
    whenFontReady(undefined, '12px monospace', callback)()
    await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()
  })
})
