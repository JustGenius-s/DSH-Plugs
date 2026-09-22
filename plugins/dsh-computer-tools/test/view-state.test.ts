import { describe, expect, it } from 'vitest'
import {
  canSave,
  driverBlockVisible,
  driverRestartOffered,
  driverRows,
  needsNativeConfirm,
  partsEqual,
} from '../src/view-state.ts'
import type { ComputerDraft, DriverView } from '../src/shared.ts'

const off: ComputerDraft = { enabled: false }
const native: ComputerDraft = { enabled: true, provider: 'cua-native' }
const mcp: ComputerDraft = { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp'] }

function driver(init: Partial<DriverView> & { permissions?: DriverView['permissions'] } = {}): DriverView {
  return {
    permissions: init.permissions === undefined
      ? { accessibility: 'granted', screenRecording: 'granted', directCapture: 'not_checked', bundleId: 'com.trycua.driver' }
      : init.permissions,
    running: init.running ?? true,
    pid: init.pid ?? 54750,
    error: init.error ?? null,
  }
}

describe('canSave', () => {
  it('requires a dirty, valid draft with packages present', () => {
    expect(canSave({
      dirty: true,
      busy: false,
      validationError: null,
      missingPackages: [],
    })).toBe(true)
    expect(canSave({
      dirty: false,
      busy: false,
      validationError: null,
      missingPackages: [],
    })).toBe(false)
    expect(canSave({
      dirty: true,
      busy: false,
      validationError: null,
      missingPackages: ['@deepseek-ai/dsh-browser-use'],
    })).toBe(false)
  })
})

describe('native confirmation', () => {
  it('asks when turning Native on', () => {
    expect(needsNativeConfirm(native, off)).toBe(true)
    expect(needsNativeConfirm(native, mcp)).toBe(true)
    expect(needsNativeConfirm(native, native)).toBe(false)
    expect(needsNativeConfirm(mcp, off)).toBe(false)
  })
})

describe('partsEqual', () => {
  it('compares one card draft by value', () => {
    expect(partsEqual(mcp, { ...mcp, args: ['mcp'] })).toBe(true)
    expect(partsEqual(mcp, native)).toBe(false)
    expect(partsEqual(off, { enabled: false })).toBe(true)
  })
})

describe('driver rows', () => {
  it('keeps granted rows static: no action to read past', () => {
    const rows = driverRows(driver())
    expect(rows).toEqual([
      { pane: 'accessibility', state: 'granted', actionable: false },
      { pane: 'screen', state: 'granted', actionable: false },
    ])
    // Nothing unresolved, so no restart button either.
    expect(driverRestartOffered(driver())).toBe(false)
  })

  it('makes an unresolved row the affordance for fixing it', () => {
    const rows = driverRows(driver({
      permissions: { accessibility: 'denied', screenRecording: 'granted', directCapture: null, bundleId: null },
    }))
    expect(rows[0]).toEqual({ pane: 'accessibility', state: 'denied', actionable: true })
    expect(rows[1]).toEqual({ pane: 'screen', state: 'granted', actionable: false })
    expect(driverRestartOffered(driver({
      permissions: { accessibility: 'denied', screenRecording: 'granted', directCapture: null, bundleId: null },
    }))).toBe(true)
  })

  it('treats an undecided permission as unresolved too', () => {
    const view = driver({
      permissions: { accessibility: 'unknown', screenRecording: 'unknown', directCapture: null, bundleId: null },
    })
    expect(driverRows(view).every((row) => row.actionable)).toBe(true)
    expect(driverRestartOffered(view)).toBe(true)
  })

  it('renders nothing when the probe could not answer and no daemon runs', () => {
    expect(driverBlockVisible(driver({ permissions: null, running: false }))).toBe(false)
    expect(driverRows(driver({ permissions: null, running: false }))).toEqual([])
  })

  it('still shows a running daemon with an unreadable answer', () => {
    expect(driverBlockVisible(driver({ permissions: null, running: true }))).toBe(true)
  })
})
