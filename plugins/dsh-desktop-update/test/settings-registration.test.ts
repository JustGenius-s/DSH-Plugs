import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { apply, Config } from '../src/index'
import { STATE_PATH, type DesktopUpdateState } from '../src/shared'
import { detectUpdates } from '../src/updater'

vi.mock('../src/updater', () => ({
  installedDshVersion: () => '0.1.7-alpha.2',
  detectUpdates: vi.fn(async () => ({ app: null, dsh: null })),
  readSkipped: () => ({}),
  writeSkipped: vi.fn(),
}))

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.mocked(detectUpdates).mockReset().mockResolvedValue({ app: null, dsh: null })
})
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()) })

function mount(raw = { checkApp: true, checkDsh: true, dshChannel: 'alpha' as const, dshVersion: '' }) {
  const config = Config(raw)
  const listeners = new Set<() => void>()
  const routes = new Map<string, (req: unknown, res: unknown) => void>()
  const configure = vi.fn(() => () => {})
  const ctx = {
    fiber: { state: 2 },
    get: () => ({ configure }),
    on: (_name: string, listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    effect: (body: () => (() => void)) => { cleanups.push(body()) },
    inject: (_services: string[], callback: (ctx: unknown) => void) => {
      callback(ctx)
      return { dispose: () => {} }
    },
    webServer: {
      register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  } as unknown as Context
  apply(ctx, config)
  return {
    configure,
    change(next: Parameters<typeof Config>[0]) {
      Reflect.get(config, Symbol.for('cosmokit.volatile.write'))(Config(next).get())
      listeners.forEach(listener => listener())
    },
    state(): DesktopUpdateState {
      let result: DesktopUpdateState | undefined
      routes.get(STATE_PATH)!({}, {
        writeHead: () => {},
        end: (body: string) => { result = JSON.parse(body) },
      })
      return result!
    },
  }
}

describe('desktop update settings on DSH 0.1.7', () => {
  it('publishes an editable Config form and uses the saved update channel', async () => {
    expect(Config.meta.volatile).toBe(true)
    const host = mount()
    expect(host.configure).toHaveBeenCalled()
    expect(host.state().config.dshChannel).toBe('alpha')
    await vi.waitFor(() => expect(host.state().checking).toBe(false))
    expect(detectUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ dshChannel: 'alpha' }), '')
  })

  it('uses changed gates and a custom version without remounting the routes', async () => {
    const host = mount()
    await vi.waitFor(() => expect(host.state().checking).toBe(false))
    host.change({ checkApp: false, checkDsh: true, dshChannel: 'custom', dshVersion: '0.1.7-alpha.2' })
    await vi.waitFor(() => expect(host.state().checking).toBe(false))
    expect(host.state().config).toEqual({
      checkApp: false, checkDsh: true, dshChannel: 'custom', dshVersion: '0.1.7-alpha.2',
    })
    expect(detectUpdates).toHaveBeenLastCalledWith(host.state().config, '')
    expect(host.configure).toHaveBeenCalledTimes(1)
  })

  it('rechecks the latest settings when the previous channel is still being checked', async () => {
    let finish!: (value: { app: null; dsh: null }) => void
    vi.mocked(detectUpdates).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const host = mount()
    host.change({ checkApp: false, checkDsh: false, dshChannel: 'next', dshVersion: '' })
    finish({ app: null, dsh: null })
    await vi.waitFor(() => expect(host.state().checking).toBe(false))
    expect(detectUpdates).toHaveBeenCalledTimes(2)
    expect(host.state().config.dshChannel).toBe('next')
    expect(detectUpdates).toHaveBeenLastCalledWith(host.state().config, '')
  })
})
