import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { getSettingsScope } from '../src/settings-scope'

function formFixture() {
  let snapshot: SettingsScopeSnapshot<unknown> = {
    status: 'ready', value: { enabled: true }, base: {}, user: {},
    revision: 1, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
  const mirror = { getSnapshot: () => ({ status: 'ready' }) }
  const forms = { get: vi.fn(() => form), describe: () => mirror }
  return {
    form, forms, mirror, listeners,
    publish(next: Partial<typeof snapshot>) {
      snapshot = { ...snapshot, ...next }
      for (const listener of listeners) listener()
    },
  }
}

describe('settings service compatibility', () => {
  it.each(['settingsScope', 'configForms'])('activates after the %s provider starts', async (service) => {
    const ctx = new Context()
    const fixture = formFixture()
    const legacy = { bind: vi.fn(() => fixture.form), describe: () => fixture.mirror }
    const applied = vi.fn()
    const consumer = ctx.plugin({
      inject: ['settingsSchema'],
      apply(child) {
        const binder = getSettingsScope(child)
        const scope = binder.bind({ namespace: 'plugin.example' })
        applied(scope.getSnapshot(), binder.describe())
      },
    })
    await consumer
    expect(applied).not.toHaveBeenCalled()
    const provider = ctx.plugin((child) => {
      child.provide('settingsSchema', {})
      child.provide(service, service === 'configForms' ? fixture.forms : legacy)
    })
    await provider
    await consumer
    expect(applied).toHaveBeenCalledWith(fixture.form.getSnapshot(), fixture.mirror)
    expect(applied).toHaveBeenCalledTimes(1)
    await consumer.dispose()
    await provider.dispose()
  })

  it('shares the new provider mirror and forwards writes to its form', async () => {
    const ctx = new Context()
    const fixture = formFixture()
    ctx.provide('configForms', fixture.forms)
    const binder = getSettingsScope(ctx)
    const scope = binder.bind({ namespace: 'plugin.example' })
    expect(fixture.forms.get).toHaveBeenCalledWith('plugin.example')
    expect(binder.describe()).toBe(fixture.mirror)
    expect(scope.getSnapshot()).toBe(fixture.form.getSnapshot())
    await scope.set('enabled', false)
    await scope.unset('enabled')
    expect(fixture.form.set).toHaveBeenCalledWith('enabled', false)
    expect(fixture.form.unset).toHaveBeenCalledWith('enabled')
  })

  it('preserves decoded values and stable snapshots across rejected values', () => {
    const ctx = new Context()
    const fixture = formFixture()
    ctx.provide('configForms', fixture.forms)
    const scope = getSettingsScope(ctx).bind({
      namespace: 'plugin.example',
      decode: (section) => typeof section === 'object' && section !== null && 'enabled' in section
        ? { accepted: section.enabled }
        : undefined,
    })
    const first = scope.getSnapshot()
    expect(first.value).toEqual({ accepted: true })
    expect(scope.getSnapshot()).toBe(first)
    fixture.publish({ value: { invalid: true }, revision: 2 })
    expect(scope.getSnapshot()).toMatchObject({ value: { accepted: true }, revision: 2 })
    fixture.publish({ value: { enabled: false }, revision: 3 })
    expect(scope.getSnapshot().value).toEqual({ accepted: false })
    expect(scope.getSnapshot()).toBe(scope.getSnapshot())
  })

  it('uses the Host entry id for renamed forms while retaining the legacy namespace', () => {
    const fixture = formFixture()
    const spec = { namespace: 'ui-onboarding', entryId: 'ui-settings-general' }
    const modern = new Context()
    modern.provide('configForms', fixture.forms)
    getSettingsScope(modern).bind(spec)
    expect(fixture.forms.get).toHaveBeenCalledWith('ui-settings-general')

    const legacy = new Context()
    const bind = vi.fn(() => fixture.form)
    legacy.provide('settingsScope', { bind, describe: () => fixture.mirror })
    getSettingsScope(legacy).bind(spec)
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'ui-onboarding' }))
  })

  it('keeps memory-mode preferences unavailable and does not decode missing values', () => {
    const ctx = new Context()
    const fixture = formFixture()
    fixture.publish({ mode: 'memory', status: 'unavailable', value: undefined, writable: false })
    ctx.provide('configForms', fixture.forms)
    const decode = vi.fn(() => ({}))
    const scope = getSettingsScope(ctx).bind({ namespace: 'plugin.example', decode })
    expect(scope.getSnapshot()).toMatchObject({ mode: 'memory', status: 'unavailable', value: undefined })
    expect(decode).not.toHaveBeenCalled()
  })

  it('disposes consumer subscriptions without stopping other users of the shared form', async () => {
    const ctx = new Context()
    const fixture = formFixture()
    ctx.provide('configForms', fixture.forms)
    const outside = vi.fn()
    const stopOutside = fixture.form.subscribe(outside)
    const changed = vi.fn()
    let scope: ReturnType<ReturnType<typeof getSettingsScope>['bind']>
    const consumer = ctx.plugin((child) => {
      scope = getSettingsScope(child).bind({ namespace: 'plugin.example' })
      scope.subscribe(changed)
    })
    await consumer
    fixture.publish({ revision: 2 })
    expect(changed).toHaveBeenCalledTimes(1)
    await consumer.dispose()
    fixture.publish({ revision: 3 })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(outside).toHaveBeenCalledTimes(2)
    await scope!.set('enabled', false)
    expect(fixture.form.set).not.toHaveBeenCalled()
    stopOutside()
    expect(fixture.listeners.size).toBe(0)
  })

  it('reports a missing provider instead of returning an undefined scope', () => {
    expect(() => getSettingsScope(new Context())).toThrow('Settings service is unavailable')
  })
})
