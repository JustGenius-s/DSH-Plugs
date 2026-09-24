import { describe, expect, it } from 'vitest'
import { Config, ConfigSchema, createCodexConfigSource } from '../src/host/settings'
import { DEFAULT_CONFIG } from '../src/shared/config'
import { FONT_PREFERENCE_MAX_LENGTH } from '../src/shared/fonts'

const quickActions = [{
  id: 'saved-action', name: 'Saved command', steps: [{ command: 'pwd', target: 'current' as const }],
}]

describe('Codex settings Config', () => {
  it('exposes all settings, including quick actions, as a live form', () => {
    expect(Config.meta.volatile).toBe(true)
    expect(ConfigSchema.meta.volatile).toBeUndefined()
    const config = Config({ quickActions, stickyUserBubbleEnabled: true, customFilesEnabled: true })
    expect(createCodexConfigSource(config)()).toEqual({
      ...DEFAULT_CONFIG, quickActions, stickyUserBubbleEnabled: true, customFilesEnabled: true,
    })
  })

  it('reads the latest reference without restarting the plugin or losing actions', () => {
    const config = Config({ quickActions })
    const source = createCodexConfigSource(config)
    const updated = Config({ quickActions, customFilesEnabled: true, terminalFontSize: 16 })
    // The loader commits updates through this shared reference protocol.
    Reflect.get(config, Symbol.for('cosmokit.volatile.write'))(updated.get())
    expect(source().customFilesEnabled).toBe(true)
    expect(source().terminalFontSize).toBe(16)
    expect(source().quickActions).toEqual(quickActions)
  })

  it('resolves default and legacy plain entry configurations', () => {
    expect(createCodexConfigSource(Config(undefined))()).toEqual(DEFAULT_CONFIG)
    expect(createCodexConfigSource()()).toEqual(DEFAULT_CONFIG)
    expect(createCodexConfigSource({ quickActions })().quickActions).toEqual(quickActions)
  })

  it('refuses invalid commands and out-of-range settings before persistence', () => {
    expect(() => Config({ terminalFontSize: 100 })).toThrow()
    expect(() => Config({ quickActions: [{ ...quickActions[0], steps: [{ target: 'invalid' }] }] } as never)).toThrow()
  })

  it('retains font preferences through configuration serialization and live updates', () => {
    const saved = { uiFontFamily: 'Inter, PingFang SC', codeFontFamily: 'JetBrains Mono', quickActions }
    const config = Config(JSON.parse(JSON.stringify(saved)))
    const source = createCodexConfigSource(config)
    expect(source()).toMatchObject(saved)
    const reset = Config({ ...saved, uiFontFamily: '' })
    Reflect.get(config, Symbol.for('cosmokit.volatile.write'))(reset.get())
    expect(source()).toMatchObject({ ...saved, uiFontFamily: '' })
  })

  it('bounds stored font names and keeps older profiles on default fonts', () => {
    expect(Config({ quickActions }).get()).toMatchObject({ uiFontFamily: '', codeFontFamily: '' })
    expect(() => Config({ uiFontFamily: 'x'.repeat(FONT_PREFERENCE_MAX_LENGTH + 1) })).toThrow()
    expect(() => Config({ codeFontFamily: 12 } as never)).toThrow()
  })
})
