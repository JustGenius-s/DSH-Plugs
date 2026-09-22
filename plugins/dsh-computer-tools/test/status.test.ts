import { describe, expect, it } from 'vitest'
import { collectDiagnostics, deriveCapability, needsRestartFlag, type StatusInput } from '../src/status.ts'
import { IDS, PACKAGES } from '../src/shared.ts'

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    desired: {
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'launch',
        headless: false,
        executablePath: '/opt/chrome',
        endpoint: '',
      },
      computer: { enabled: false },
    },
    dependencies: {
      [PACKAGES.browserUse]: '0.1.6-alpha.1',
      [PACKAGES.playwright]: '0.1.6-alpha.1',
    },
    loader: [],
    versions: {},
    lastAppliedAt: null,
    hostStartedAt: 1_000,
    pathExists: () => true,
    runtimeVersion: '0.1.6-alpha.1',
    ...overrides,
  }
}

describe('capability phase', () => {
  it('is off when disabled', () => {
    const view = deriveCapability('computer', input())
    expect(view.phase).toBe('off')
  })

  it('is missing-deps when the provider package is absent', () => {
    const view = deriveCapability('browser', input({ dependencies: {} }))
    expect(view.phase).toBe('missing-deps')
    expect(view.missingPackages).toContain(PACKAGES.playwright)
  })

  it('is active when the provider fiber is running', () => {
    const view = deriveCapability('browser', input({
      loader: [{
        localId: IDS.playwright,
        moduleName: PACKAGES.playwright,
        disabled: false,
        fiberPhase: 'active',
      }],
    }))
    expect(view.phase).toBe('active')
  })

  it('is pending-restart after a write newer than host start', () => {
    const view = deriveCapability('browser', input({ lastAppliedAt: 2_000 }))
    expect(view.phase).toBe('pending-restart')
    expect(needsRestartFlag(2_000, 1_000, [view])).toBe(true)
  })

  it('is failed when the fiber failed', () => {
    const view = deriveCapability('browser', input({
      loader: [{
        localId: IDS.playwright,
        moduleName: PACKAGES.playwright,
        disabled: false,
        fiberPhase: 'failed',
      }],
    }))
    expect(view.phase).toBe('failed')
  })
})

describe('diagnostics', () => {
  it('flags a missing launch executable', () => {
    const found = collectDiagnostics(input({ pathExists: () => false }))
    expect(found.some((item) => item.id === 'browser-executable')).toBe(true)
  })

  it('flags duplicate live browser providers', () => {
    const found = collectDiagnostics(input({
      loader: [
        { localId: IDS.playwright, moduleName: PACKAGES.playwright, disabled: false, fiberPhase: 'active' },
        { localId: IDS.chromeDevtools, moduleName: PACKAGES.chromeDevtools, disabled: false, fiberPhase: 'active' },
      ],
    }))
    expect(found.some((item) => item.id === 'browser-duplicate')).toBe(true)
  })
})
