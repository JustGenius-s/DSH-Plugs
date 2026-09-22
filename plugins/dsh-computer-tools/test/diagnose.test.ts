import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CHROME_PATH,
  chromeCandidates,
  commandOnPath,
  firstExisting,
  parsePrivacyPane,
  privacyUrl,
  resolveCuaCommand,
  resolveDshBin,
} from '../src/diagnose.ts'

describe('chromeCandidates', () => {
  it('returns the macOS default first', () => {
    expect(chromeCandidates('darwin')[0]).toBe(DEFAULT_CHROME_PATH)
  })
})

describe('firstExisting', () => {
  it('returns the first path the probe accepts', () => {
    expect(firstExisting(['/missing', '/opt/chrome'], (path) => path === '/opt/chrome')).toBe('/opt/chrome')
  })

  it('falls back to the first candidate when none exist', () => {
    expect(firstExisting(['/a', '/b'], () => false)).toBe('/a')
  })
})

describe('commandOnPath', () => {
  it('accepts an existing absolute path', () => {
    expect(commandOnPath('/opt/cua-driver', '', (path) => path === '/opt/cua-driver')).toBe(true)
  })

  it('looks up a bare name on PATH', () => {
    expect(commandOnPath('cua-driver', '/usr/bin:/opt/bin', (path) => path === '/opt/bin/cua-driver')).toBe(true)
    expect(commandOnPath('cua-driver', '/usr/bin', () => false)).toBe(false)
  })
})

describe('privacy pane', () => {
  it('builds the Accessibility and Screen Recording URLs', () => {
    expect(privacyUrl('accessibility')).toContain('Privacy_Accessibility')
    expect(privacyUrl('screen')).toContain('Privacy_ScreenCapture')
  })

  it('rejects unknown panes', () => {
    expect(parsePrivacyPane('accessibility')).toBe('accessibility')
    expect(parsePrivacyPane('camera')).toBeNull()
  })
})

describe('resolveDshBin', () => {
  const runtimeShim = '/home/u/.dsh/runtime/node_modules/.bin/dsh'

  it('prefers an existing DSH_BIN', () => {
    expect(resolveDshBin(
      { DSH_BIN: '/opt/dsh', DSH_HOME: '/home/u/.dsh' },
      (path) => path === '/opt/dsh',
    )).toBe('/opt/dsh')
  })

  it('falls back to the runtime shim when PATH has no dsh', () => {
    expect(resolveDshBin({ DSH_HOME: '/home/u/.dsh' }, (path) => path === runtimeShim)).toBe(runtimeShim)
  })

  it('defaults DSH_HOME to ~/.dsh', () => {
    const fromHome = join(homedir(), '.dsh', 'runtime', 'node_modules', '.bin', 'dsh')
    expect(resolveDshBin({}, (path) => path === fromHome)).toBe(fromHome)
  })

  it('keeps the bare name when nothing exists', () => {
    expect(resolveDshBin({ DSH_HOME: '/home/u/.dsh' }, () => false)).toBe('dsh')
  })
})

describe('resolveCuaCommand', () => {
  it('prefers a cua-driver already on PATH', () => {
    expect(resolveCuaCommand({
      pathEnv: '/usr/bin:/opt/homebrew/bin',
      pathExists: (path) => path === '/opt/homebrew/bin/cua-driver',
    })).toBe('/opt/homebrew/bin/cua-driver')
  })

  it('finds the installer symlink when PATH misses ~/.local/bin', () => {
    const installer = '/home/u/.local/bin/cua-driver'
    expect(resolveCuaCommand({
      pathEnv: '/usr/bin:/bin',
      home: '/home/u',
      pathExists: (path) => path === installer,
    })).toBe(installer)
  })

  it('falls back to the app bundle binary', () => {
    const bundled = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
    expect(resolveCuaCommand({
      pathEnv: '/usr/bin',
      pathExists: (path) => path === bundled,
    })).toBe(bundled)
  })

  it('keeps the bare name when nothing exists', () => {
    expect(resolveCuaCommand({ pathEnv: '/usr/bin', pathExists: () => false })).toBe('cua-driver')
  })
})
