import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { apply } from '../src/client/index'
import manifest from '../package.json'

// Exercise slot registration only: no React rendering, DOM, polling or IPC.
vi.mock('../src/client/card', () => ({ UpdateCard: () => { throw new Error('Do not render in contract tests') } }))
vi.mock('../src/client/update-store', () => ({ createUpdateStore: () => ({ dispose() {} }) }))
vi.mock('../src/client/seats', () => ({ installDesktopSeats: () => () => {} }))

function registrations(modern: boolean) {
  const entries: Record<string, any>[] = []
  const expectedSlot = modern ? 'plugins.bundle.config' : 'settings.plugin.item'
  const scope = { getSnapshot: () => ({ status: 'ready', value: { dshChannel: 'alpha' } }) }
  const ctx = {
    get: (name: string) => name === 'configForms'
      ? modern ? { get: () => scope } : undefined
      : { bind: () => scope },
    effect: (body: () => unknown) => body(),
    locale: { register: () => () => {}, bind: () => () => '软件更新' },
    slots: {
      inject: (name: string, register: () => void) => { if (name === expectedSlot) register() },
      register: (options: Record<string, any>) => { entries.push(options); return () => {} },
    },
  } as unknown as ClientContext
  apply(ctx)
  return entries
}

describe('software update settings entry', () => {
  it('configures this installed bundle from the sidebar Plugins page', () => {
    const entries = registrations(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: 'plugins.bundle.config',
      key: manifest.name,
      locale: 'desktop-update',
    })
    expect(entries[0]!.inject().scope.getSnapshot().status).toBe('ready')
  })

  it('loads the plugin manager that owns the bundle configuration slot', () => {
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-settings-plugins')
  })

  it('keeps the old card registration on legacy settings providers', () => {
    expect(registrations(false)).toEqual([
      expect.objectContaining({ name: 'settings.plugin.item', key: 'desktop-update' }),
    ])
  })
})
