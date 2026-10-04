import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection } from '../src/settings-section'

const schema = Schema.object({ enabled: Schema.boolean().default(false) })

function harness(settings: object) {
  const listeners = new Set<() => void>()
  const effects: (() => void)[] = []
  const fiber = { state: 2 }
  const detach = (): void => { effects.splice(0).reverse().forEach(dispose => dispose()) }
  const ctx = {
    fiber,
    on(name: string, listener: () => void) {
      expect(name).toBe('loader/volatile-update')
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    inject(_services: string[], apply: (ctx: unknown) => void) {
      apply({
        get: () => settings,
        effect: (body: () => () => void) => { effects.push(body()) },
      })
      return { dispose: detach }
    },
  } as unknown as Context
  return { ctx, fiber, detach, emit: () => listeners.forEach(listener => listener()) }
}

describe('installSettingsSection', () => {
  it('reads new Config forms and observes live changes on the owning fiber', () => {
    const releasePolicy = vi.fn()
    const configure = vi.fn(() => releasePolicy)
    const { ctx, fiber, emit } = harness({ configure })
    let value = { enabled: true }
    let source = () => ({ enabled: false })
    const onChange = vi.fn()
    const dispose = installSettingsSection(ctx, 'test-settings', schema, { enabled: false }, {
      entrySource: () => value,
      setSource: next => { source = next },
      onChange,
    })
    expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
    expect(source()).toEqual({ enabled: true })
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true })
    value = { enabled: false }
    emit()
    expect(source()).toEqual({ enabled: false })
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false })
    dispose()
    dispose()
    emit()
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(releasePolicy).toHaveBeenCalledTimes(1)
  })

  it('keeps legacy saved values, registration options and provider-detach fallback', () => {
    let stored = { enabled: true }
    let changed = () => {}
    const stop = vi.fn()
    const register = vi.fn(() => ({
      get: () => stored,
      watch: (listener: () => void) => { changed = listener; return stop },
    }))
    const { ctx, detach } = harness({ register })
    let source = () => ({ enabled: false })
    const onChange = vi.fn()
    const validate = vi.fn()
    installSettingsSection(ctx, 'test-settings', schema, { enabled: false }, {
      setSource: next => { source = next }, onChange, validate,
    })
    expect(register).toHaveBeenCalledWith('test-settings', schema, {
      base: { enabled: false }, validate,
    })
    expect(source()).toEqual({ enabled: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    stored = { enabled: false }
    changed()
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false })
    stored = { enabled: true }
    detach()
    expect(source()).toEqual({ enabled: false })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does not re-enable resources while their owning plugin is unloading', () => {
    const { ctx, fiber, detach } = harness({
      register: () => ({ get: () => ({ enabled: true }), watch: () => () => {} }),
    })
    const onChange = vi.fn()
    installSettingsSection(ctx, 'test-settings', schema, { enabled: false }, { onChange })
    fiber.state = 3
    detach()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
