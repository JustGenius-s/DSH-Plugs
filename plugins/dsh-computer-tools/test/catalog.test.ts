import { describe, expect, it } from 'vitest'
import {
  blockingUnmanaged,
  desiredEntries,
  formatInstallCommand,
  inferDesired,
  missingPackages,
  normalizeDesired,
  parseDesired,
  requiredPackages,
  unmanagedOfficial,
  validateDesired,
} from '../src/catalog.ts'
import { IDS, PACKAGES, type PatchEntry } from '../src/shared.ts'

describe('required packages', () => {
  it('lists browser + playwright when browser is on', () => {
    expect(requiredPackages({
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'launch',
        headless: false,
        executablePath: '',
        endpoint: '',
      },
      computer: { enabled: false },
    })).toEqual([PACKAGES.browserUse, PACKAGES.playwright])
  })

  it('lists computer + native provider', () => {
    expect(requiredPackages({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-native' },
    })).toEqual([PACKAGES.computerUse, PACKAGES.cuaNative])
  })

  it('lists computer + mcp provider', () => {
    expect(requiredPackages({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp'] },
    })).toEqual([PACKAGES.computerUse, PACKAGES.cuaMcp])
  })

  it('reports missing against the profile lockfile', () => {
    expect(missingPackages({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-native' },
    }, { [PACKAGES.computerUse]: '0.1.6-alpha.1' })).toEqual([PACKAGES.cuaNative])
  })
})

describe('desired round-trip', () => {
  it('emits canonical ids and infers them back', () => {
    const desired = normalizeDesired({
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'attach',
        headless: true,
        executablePath: '',
        endpoint: 'http://127.0.0.1:9222',
      },
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp', '--direct'] },
    })
    const inferred = inferDesired(desiredEntries(desired))
    expect(inferred).toEqual(desired)
  })

  it('treats omitted headless as headed', () => {
    const desired = normalizeDesired({
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'launch',
        headless: false,
        executablePath: '/opt/chrome',
        endpoint: '',
      },
      computer: { enabled: false },
    })
    expect(inferDesired(desiredEntries(desired))).toEqual(desired)
    expect(inferDesired([{
      id: IDS.playwright,
      name: PACKAGES.playwright,
      config: { mode: 'launch' },
    }]).browser).toMatchObject({ enabled: true, headless: false })
  })

  it('rejects attach without an endpoint', () => {
    expect(validateDesired({
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'attach',
        headless: false,
        executablePath: '',
        endpoint: '  ',
      },
      computer: { enabled: false },
    })).toBe('attach mode needs an endpoint')
  })

  it('parses a JSON body into a desired state', () => {
    expect(parseDesired({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: 'mcp --direct' },
    })).toEqual({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp', '--direct'] },
    })
  })
})

describe('unmanaged official entries', () => {
  const handwritten: PatchEntry[] = [
    { id: 'custom-browser', name: PACKAGES.playwright, config: { mode: 'launch' } },
    { id: IDS.playwright, name: PACKAGES.playwright, config: {} },
  ]

  it('treats foreign ids as unmanaged even when the package is official', () => {
    expect(unmanagedOfficial(handwritten)).toEqual([
      { id: 'custom-browser', name: PACKAGES.playwright, capability: 'browser' },
    ])
  })

  it('only blocks takeover for the capability being enabled', () => {
    const unmanaged = unmanagedOfficial(handwritten)
    expect(blockingUnmanaged(unmanaged, {
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-native' },
    })).toEqual([])
    expect(blockingUnmanaged(unmanaged, {
      browser: {
        enabled: true,
        provider: 'playwright-mcp',
        mode: 'launch',
        headless: false,
        executablePath: '',
        endpoint: '',
      },
      computer: { enabled: false },
    })).toHaveLength(1)
  })
})

describe('install command', () => {
  it('pins the target release', () => {
    const command = formatInstallCommand('dsh', [PACKAGES.browserUse, PACKAGES.playwright])
    expect(command).toContain('dsh plugin --profile web add')
    expect(command).toContain(`${PACKAGES.browserUse}@0.1.6-alpha.1`)
    expect(command).toContain(`${PACKAGES.playwright}@0.1.6-alpha.1`)
  })
})
