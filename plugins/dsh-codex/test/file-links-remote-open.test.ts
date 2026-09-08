import { describe, expect, it, vi } from 'vitest'
import { createFileLinksFeature } from '../src/client/features/file-links'

/**
 * Verifies the Host-Remote patch that reroutes chat file links into the
 * `files` side panel. The Gateway installs namespace methods as own
 * configurable getters, so these cases model that shape exactly.
 */

interface Harness {
  ctx: any
  dispose: () => void
  remoteCalls: string[]
  panelOpens: Array<{ mode: string; file: string }>
  activations: string[]
  setConfig(next: { fileLinksInPanel?: boolean; filesEnabled?: boolean }): void
  /** Swap the closure the namespace getter yields, the way a Remote remount does. */
  remount(next: (request: { path: string }) => Promise<unknown>): void
}

function harness(overrides: { config?: Record<string, unknown>, cwd?: string } = {}): Harness {
  const remoteCalls: string[] = []
  const panelOpens: Array<{ mode: string; file: string }> = []
  const activations: string[] = []

  const session = {} as { openWorkspacePath: (request: { path: string }) => Promise<unknown> }
  // The Gateway's getter reads its live `methods` record and returns a NEW
  // closure per read; `current` stands in for that record so a test can swap
  // the implementation the way a Remote remount does.
  let current: (request: { path: string }) => Promise<unknown> = async (request) => {
    remoteCalls.push(request.path)
    return { ok: true, value: { opened: true } }
  }
  Object.defineProperty(session, 'openWorkspacePath', {
    configurable: true,
    enumerable: true,
    get: () => current,
  })

  const config = { fileLinksInPanel: true, filesEnabled: true, ...overrides.config }
  const scope = { getSnapshot: () => ({ value: config }) }

  const ctx: any = {
    remote: { session },
    sidePanels: {
      currentSession: () => 'session-1',
      setSession: () => {},
      activateInstance: (key: string) => activations.push(key),
      getSnapshot: () => ({ instances: [] as any[] }),
      open: (_id: string, state: any) => panelOpens.push(state),
    },
    sessions: {
      list: {
        getSnapshot: () => ({
          current: 'session-1',
          byId: { 'session-1': { cwd: overrides.cwd ?? '/work/repo' } },
        }),
      },
    },
  }

  const feature = createFileLinksFeature(ctx, scope as any)
  const dispose = feature.activate()
  return {
    ctx,
    dispose,
    remoteCalls,
    panelOpens,
    activations,
    setConfig: (next) => Object.assign(config, next),
    remount: (next: (request: { path: string }) => Promise<unknown>) => {
      current = next
    },
  }
}

describe('file-links: session/openWorkspacePath patch', () => {
  it('reroutes a file inside the workspace to a panel preview', async () => {
    const h = harness()
    const result = await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/src/a.ts' })

    expect(result).toEqual({ ok: true, value: { opened: true } })
    expect(h.remoteCalls).toEqual([])
    expect(h.panelOpens).toEqual([{ mode: 'preview', file: 'src/a.ts' }])
  })

  it('reroutes an outside path as an absolute preview', async () => {
    const h = harness()
    await h.ctx.remote.session.openWorkspacePath({ path: '/elsewhere/notes.md' })
    expect(h.panelOpens).toEqual([{ mode: 'preview', file: '/elsewhere/notes.md' }])
    expect(h.remoteCalls).toEqual([])
  })

  it('lets the workspace folder itself reach the system opener', async () => {
    const h = harness()
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo' })
    expect(h.panelOpens).toEqual([])
    expect(h.remoteCalls).toEqual(['/work/repo'])
  })

  it('lets a relative path with no absolute form reach the system opener', async () => {
    const h = harness()
    await h.ctx.remote.session.openWorkspacePath({ path: 'src/a.ts' })
    expect(h.panelOpens).toEqual([])
    expect(h.remoteCalls).toEqual(['src/a.ts'])
  })

  it('falls through to the native opener when the setting is off', async () => {
    const h = harness({ config: { fileLinksInPanel: false } })
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/src/a.ts' })
    expect(h.panelOpens).toEqual([])
    expect(h.remoteCalls).toEqual(['/work/repo/src/a.ts'])
  })

  it('honours a config change made after activation', async () => {
    const h = harness()
    h.setConfig({ filesEnabled: false })
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/src/a.ts' })
    expect(h.remoteCalls).toEqual(['/work/repo/src/a.ts'])
  })

  it('reads the live getter, so a remounted namespace is not stale', async () => {
    const h = harness()
    // Simulate a Remote remount: the getter stays, but it now yields a NEW
    // closure than the one present when the patch was applied.
    const seen: string[] = []
    h.remount(async (request) => {
      seen.push(request.path)
      return { ok: true, value: { opened: true } }
    })
    h.setConfig({ fileLinksInPanel: false })
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/a.ts' })
    expect(seen).toEqual(['/work/repo/a.ts'])
    expect(h.remoteCalls).toEqual([])
  })

  it('restores the descriptor on dispose, leaving the method usable', async () => {
    const h = harness()
    h.dispose()
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/src/a.ts' })
    expect(h.remoteCalls).toEqual(['/work/repo/src/a.ts'])
    // The descriptor must be an accessor again, not a data property.
    const descriptor = Object.getOwnPropertyDescriptor(h.ctx.remote.session, 'openWorkspacePath')
    expect(descriptor?.get).toBeTypeOf('function')
    expect(descriptor?.configurable).toBe(true)
  })

  it('reuses an existing preview tab instead of stacking duplicates', async () => {
    const h = harness()
    h.ctx.sidePanels.getSnapshot = () => ({
      instances: [{ key: 'k1', panelId: 'files', state: { mode: 'preview', file: 'src/a.ts' } }],
    })
    await h.ctx.remote.session.openWorkspacePath({ path: '/work/repo/src/a.ts' })
    expect(h.activations).toEqual(['k1'])
    expect(h.panelOpens).toEqual([])
  })

  it('does nothing when the session namespace is absent', () => {
    const feature = createFileLinksFeature({ remote: {} } as any, {
      getSnapshot: () => ({ value: {} }),
    } as any)
    expect(() => feature.activate()).not.toThrow()
    expect(feature.activate()()).toBeUndefined()
  })
})
