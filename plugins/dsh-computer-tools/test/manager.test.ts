import { describe, expect, it } from 'vitest'
import { ComputerToolsManager, parseInstallRequest, parseMutateRequest, type ComputerToolsPorts } from '../src/manager.ts'
import { EMPTY_LEDGER, type Ledger } from '../src/ledger.ts'
import { IDS, PACKAGES, type DesiredState, type ToolchainHealth } from '../src/shared.ts'
import type { LoaderRow } from '../src/status.ts'
import type { CuaDriverInfo } from '../src/cua-driver.ts'
import type { PluginProfileSnapshot } from '@just-genius/dsh-plugin-runtime'

const browserOn: DesiredState = {
  browser: {
    enabled: true,
    provider: 'playwright-mcp',
    mode: 'launch',
    headless: false,
    executablePath: '/opt/chrome',
    endpoint: '',
  },
  computer: { enabled: false },
}

function ports(init: {
  snapshot?: PluginProfileSnapshot
  ledger?: Ledger
  exists?: Set<string>
  driver?: CuaDriverInfo
  restartOk?: boolean
  toolchain?: ToolchainHealth
  loader?: LoaderRow[]
}): {
  manager: ComputerToolsManager
  getPatch: () => string
  getLedger: () => Ledger
  getSpecs: () => string[]
  getRestarts: () => number
} {
  let snapshot: PluginProfileSnapshot = init.snapshot ?? {
    dependencies: {
      [PACKAGES.browserUse]: '0.1.6-alpha.1',
      [PACKAGES.playwright]: '0.1.6-alpha.1',
    },
    patchText: '- id: dsh-memory\n  name: \'@just-genius/dsh-memory\'\n',
    modifiedAt: 10,
  }
  let ledger = init.ledger ?? { ...EMPTY_LEDGER }
  const exists = init.exists ?? new Set(['/opt/chrome'])
  const specs: string[] = []
  let restarts = 0
  const impl: ComputerToolsPorts = {
    snapshot: () => snapshot,
    reconcile: async (input) => {
      if (input.expectedModifiedAt !== undefined && input.expectedModifiedAt !== snapshot.modifiedAt) {
        throw new Error('profile changed since it was loaded')
      }
      snapshot = {
        dependencies: { ...input.dependencies },
        patchText: input.patchText,
        modifiedAt: (snapshot.modifiedAt ?? 0) + 1,
      }
      return { added: [], removed: [], failed: [], patchChanged: true, needsRestart: true }
    },
    install: async (spec) => {
      specs.push(spec)
      return { detail: `added ${spec}`, needsRestart: true }
    },
    probeDriver: async () => init.driver ?? { permissions: null, running: false, pid: null, error: null },
    ...(init.toolchain === undefined ? {} : { probeToolchain: async () => init.toolchain! }),
    restartDriver: async () => {
      restarts += 1
      return init.restartOk === false
        ? { ok: false, error: 'open failed' }
        : { ok: true, error: null }
    },
    wait: async () => {},
    loaderRows: () => init.loader ?? [],
    pathExists: (path) => exists.has(path),
    dshBin: () => 'dsh',
    now: () => 50,
    hostStartedAt: 1,
    platform: 'darwin',
    pathEnv: '/usr/bin',
    readLedger: () => ledger,
    writeLedger: (next) => {
      ledger = next
    },
  }
  return {
    manager: new ComputerToolsManager(impl),
    getPatch: () => snapshot.patchText,
    getLedger: () => ledger,
    getSpecs: () => specs,
    getRestarts: () => restarts,
  }
}

describe('ComputerToolsManager', () => {
  it('blocks enable when packages are missing', async () => {
    const { manager } = ports({
      snapshot: { dependencies: {}, patchText: '', modifiedAt: 1 },
    })
    const result = await manager.apply({
      desired: browserOn,
      expectedModifiedAt: 1,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('missing-packages')
    expect(result.installCommand).toContain('plugin --profile web add')
  })

  it('writes a managed insert without changing unrelated rows', async () => {
    const { manager, getPatch, getLedger } = ports({})
    const result = await manager.apply({
      desired: browserOn,
      expectedModifiedAt: 10,
    })
    expect(result.ok).toBe(true)
    expect(getPatch()).toContain('dsh-memory')
    expect(getPatch()).toContain('browser-use-playwright')
    expect(getLedger().owned).toBe(true)
  })

  it('requires takeover before replacing a handwritten provider', async () => {
    const { manager, getPatch } = ports({
      snapshot: {
        dependencies: {
          [PACKAGES.browserUse]: '0.1.6-alpha.1',
          [PACKAGES.playwright]: '0.1.6-alpha.1',
        },
        patchText: `- insert:\n    - id: custom-browser\n      name: '${PACKAGES.playwright}'\n      config:\n        mode: attach\n`,
        modifiedAt: 3,
      },
    })
    const blocked = await manager.apply({
      desired: browserOn,
      expectedModifiedAt: 3,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('takeover-required')
    const applied = await manager.apply({
      desired: browserOn,
      expectedModifiedAt: 3,
      takeover: true,
    })
    expect(applied.ok).toBe(true)
    expect(getPatch()).not.toContain('custom-browser')
    expect(getPatch()).toContain('browser-use-playwright')
  })

  it('fails closed when the profile changed under the caller', async () => {
    const { manager } = ports({})
    const result = await manager.apply({
      desired: browserOn,
      expectedModifiedAt: 99,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('profile-changed')
  })

})

describe('package install', () => {
  it('installs only what the named card needs, pinned to the target release', async () => {
    const { manager, getSpecs } = ports({
      snapshot: { dependencies: {}, patchText: '', modifiedAt: 1 },
    })
    const result = await manager.install('browser', browserOn)
    expect(result.ok).toBe(true)
    expect(result.added).toEqual([PACKAGES.browserUse, PACKAGES.playwright])
    expect(getSpecs()).toEqual([
      `${PACKAGES.browserUse}@0.1.6-alpha.1`,
      `${PACKAGES.playwright}@0.1.6-alpha.1`,
    ])
  })

  it('never installs another card\'s packages', async () => {
    const { manager, getSpecs } = ports({
      snapshot: { dependencies: {}, patchText: '', modifiedAt: 1 },
    })
    // A draft that wants both capabilities still installs only the browser half.
    const both: DesiredState = {
      browser: browserOn.browser,
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp'] },
    }
    await manager.install('browser', both)
    expect(getSpecs()).not.toContain(`${PACKAGES.computerUse}@0.1.6-alpha.1`)
    expect(getSpecs()).not.toContain(`${PACKAGES.cuaMcp}@0.1.6-alpha.1`)
    expect(getSpecs()).toContain(`${PACKAGES.browserUse}@0.1.6-alpha.1`)
  })

  it('is a no-op when every package is present', async () => {
    const { manager, getSpecs } = ports({})
    const result = await manager.install('browser', browserOn)
    expect(result.ok).toBe(true)
    expect(result.added).toEqual([])
    expect(result.needsRestart).toBe(false)
    expect(getSpecs()).toEqual([])
  })

  it('reports failure without claiming success', async () => {
    let snapshot: PluginProfileSnapshot = { dependencies: {}, patchText: '', modifiedAt: 1 }
    const manager = new ComputerToolsManager({
      snapshot: () => snapshot,
      reconcile: async () => ({ added: [], removed: [], failed: [], patchChanged: false, needsRestart: false }),
      install: async () => { throw new Error('ERR_PNPM_UNEXPECTED_STORE') },
      loaderRows: () => [],
      pathExists: () => true,
      dshBin: () => 'dsh',
      now: () => 50,
      hostStartedAt: 1,
      platform: 'darwin',
      pathEnv: '/usr/bin',
      readLedger: () => ({ ...EMPTY_LEDGER }),
      writeLedger: () => {},
    })
    expect(snapshot.dependencies).toEqual({})
    const result = await manager.install('browser', browserOn)
    expect(result.ok).toBe(false)
    expect(result.added).toEqual([])
    expect(result.message).toContain('ERR_PNPM_UNEXPECTED_STORE')
  })
})

describe('driver probe', () => {
  it('marks an active plugin failed when the real MCP chain is broken despite granted permissions', async () => {
    const { manager } = ports({
      snapshot: {
        dependencies: { [PACKAGES.computerUse]: '0.1.6-alpha.1', [PACKAGES.cuaMcp]: '0.1.6-alpha.1' },
        patchText: `- id: ${IDS.cuaMcp}\n  name: '${PACKAGES.cuaMcp}'\n`,
        modifiedAt: 5,
      },
      loader: [{ localId: IDS.cuaMcp, moduleName: PACKAGES.cuaMcp, disabled: false, fiberPhase: 'active' }],
      driver: {
        permissions: { accessibility: 'granted', screenRecording: 'granted', directCapture: null, bundleId: 'com.trycua.driver', pid: 123 },
        running: true, pid: 123, error: null,
      },
      toolchain: { state: 'failed', tool: 'mcp__cua-driver-mcp__list_windows', checkedAt: 1000, error: 'session has ended' },
    })
    const status = await manager.status()
    expect(status.driver.running).toBe(true)
    expect(status.computer.phase).toBe('failed')
    expect(status.driver.toolchain?.state).toBe('failed')
    expect(status.diagnostics).toContainEqual({ id: 'cua-toolchain', level: 'error', detail: 'session has ended' })
  })

  const computerOn: DesiredState = {
    browser: { enabled: false },
    computer: { enabled: true, provider: 'cua-mcp', command: '/Users/x/.local/bin/cua-driver', args: ['mcp'] },
  }

  it('surfaces the driver permissions when Computer Use uses MCP', async () => {
    const { manager } = ports({
      snapshot: {
        dependencies: {
          [PACKAGES.computerUse]: '0.1.6-alpha.1',
          [PACKAGES.cuaMcp]: '0.1.6-alpha.1',
        },
        patchText: '- id: computer-use-cua-mcp\n  name: \'@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp\'\n',
        modifiedAt: 5,
      },
      driver: {
        permissions: {
          accessibility: 'granted',
          screenRecording: 'granted',
          directCapture: 'not_checked',
          bundleId: 'com.trycua.driver',
          pid: 54750,
        },
        running: true,
        pid: 54750,
        error: null,
      },
    })
    const status = await manager.status()
    expect(status.driver.running).toBe(true)
    expect(status.driver.permissions?.accessibility).toBe('granted')
    expect(status.diagnostics.some((d) => d.id.startsWith('cua-permission'))).toBe(false)
  })

  it('turns a denied grant into an error diagnostic', async () => {
    const { manager } = ports({
      snapshot: {
        dependencies: {
          [PACKAGES.computerUse]: '0.1.6-alpha.1',
          [PACKAGES.cuaMcp]: '0.1.6-alpha.1',
        },
        patchText: '- id: computer-use-cua-mcp\n  name: \'@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp\'\n',
        modifiedAt: 5,
      },
      driver: {
        permissions: {
          accessibility: 'granted',
          screenRecording: 'denied',
          directCapture: 'not_checked',
          bundleId: 'com.trycua.driver',
          pid: 1,
        },
        running: true,
        pid: 1,
        error: null,
      },
    })
    const status = await manager.status()
    expect(status.diagnostics.some((d) => d.id === 'cua-permission-screen-recording')).toBe(true)
  })

  it('does not probe the driver when Computer Use is off', async () => {
    let probed = 0
    const { manager } = ports({})
    const impl: ComputerToolsPorts = {
      snapshot: () => ({ dependencies: {}, patchText: '', modifiedAt: 1 }),
      reconcile: async () => ({ added: [], removed: [], failed: [], patchChanged: false, needsRestart: false }),
      install: async () => ({ detail: '', needsRestart: false }),
      probeDriver: async () => {
        probed += 1
        return { permissions: null, running: false, pid: null, error: null }
      },
      restartDriver: async () => ({ ok: true, error: null }),
      wait: async () => {},
      loaderRows: () => [],
      pathExists: () => true,
      dshBin: () => 'dsh',
      now: () => 50,
      hostStartedAt: 1,
      platform: 'darwin',
      pathEnv: '/usr/bin',
      readLedger: () => ({ ...EMPTY_LEDGER }),
      writeLedger: () => {},
    }
    void manager
    const probe = new ComputerToolsManager(impl)
    await probe.status()
    expect(probed).toBe(0)
    void computerOn
  })

  it('restarts the driver and returns a refreshed status', async () => {
    const { manager, getRestarts } = ports({
      snapshot: {
        dependencies: {
          [PACKAGES.computerUse]: '0.1.6-alpha.1',
          [PACKAGES.cuaMcp]: '0.1.6-alpha.1',
        },
        patchText: '- id: computer-use-cua-mcp\n  name: \'@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp\'\n',
        modifiedAt: 5,
      },
    })
    const result = await manager.restartDriver()
    expect(getRestarts()).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status?.driver).toBeDefined()
  })

  it('reports a failed restart instead of claiming success', async () => {
    const { manager } = ports({
      snapshot: {
        dependencies: { [PACKAGES.computerUse]: '0.1.6-alpha.1', [PACKAGES.cuaMcp]: '0.1.6-alpha.1' },
        patchText: '',
        modifiedAt: 5,
      },
      restartOk: false,
    })
    const result = await manager.restartDriver()
    expect(result.ok).toBe(false)
  })
})

describe('request parsers', () => {
  it('accepts a mutate body and rejects a bad timestamp', () => {
    expect(parseMutateRequest({
      desired: browserOn,
      expectedModifiedAt: 10,
    })).toEqual({
      desired: browserOn,
      expectedModifiedAt: 10,
      takeover: false,
    })
    expect(parseMutateRequest({
      desired: browserOn,
      expectedModifiedAt: '10',
    })).toBeNull()
  })

  it('accepts only a known card and never a package name', () => {
    expect(parseInstallRequest({ card: 'browser' })).toEqual({ card: 'browser' })
    expect(parseInstallRequest({ card: 'computer', desired: browserOn })).toEqual({
      card: 'computer',
      desired: browserOn,
    })
    expect(parseInstallRequest({ card: 'browser', packages: ['evil-pkg'] })).toEqual({ card: 'browser' })
    expect(parseInstallRequest({ card: 'evil-pkg' })).toBeNull()
    expect(parseInstallRequest({ packages: ['evil-pkg'] })).toBeNull()
    expect(parseInstallRequest(null)).toBeNull()
  })
})
