import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComputerControl, DESKTOP_FALLBACK_TTL_MS, type ControlRequest } from '../src/control.ts'
import type { CuaWindow } from '../src/shared/types.ts'

const windows: CuaWindow[] = [
  { pid: 42, windowId: 73, appName: 'Clock', title: 'Clock' },
  { pid: 43, windowId: 74, appName: 'ima', title: 'ima' },
].map((window) => ({ ...window, isOnScreen: true, bounds: { x: 0, y: 0, width: 800, height: 600 } }))
const request: ControlRequest = {
  controlMode: 'desktop', pid: 42, windowId: 73,
  reason: 'The driver refused background input for the exact window',
}
const instances: ComputerControl[] = []
function harness() {
  const listWindows = vi.fn(async () => windows)
  const control = new ComputerControl(listWindows)
  instances.push(control)
  return { control, listWindows }
}
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000) })
afterEach(() => { for (const control of instances.splice(0)) control.dispose(); vi.useRealTimers() })

describe('temporary desktop control', () => {
  it('defaults to background and grants a declared, exact-window fallback without application input', async () => {
    const { control, listWindows } = harness()
    expect(control.status('s1')).toEqual({ mode: 'background', scope: null, target: null, reason: null, expiresAt: null })
    expect(await control.setMode('s1', request)).toEqual({
      mode: 'desktop', scope: 'window', target: { pid: 42, windowId: 73 },
      reason: request.reason, expiresAt: 301_000,
    })
    expect(listWindows).toHaveBeenCalledOnce()
    expect(control.status('s2').mode).toBe('background')
    const args = { pid: 42, window_id: 73, delivery_mode: 'foreground' }
    expect(control.refusal('s1', 'cua_driver_native__click', args)).toBeUndefined()
    expect(control.refusal('s2', 'cua_driver_native__click', args)).toContain('background_first')
    expect(control.refusal(undefined, 'cua_driver_native__click', args)).toContain('background_first')
    expect(control.refusal('s1', 'cua_driver_native__invoke_menu', { pid: 43, window_id: 74 })).toContain('another window')
    expect(control.refusal('s1', 'unrelated_tool', {})).toBeUndefined()
  })

  it('declares a desktop surface without a surrogate application window', async () => {
    const { control, listWindows } = harness()
    const input = { controlMode: 'desktop', controlScope: 'desktop', reason: 'Menu bar has no application window' } as const
    expect(await control.setMode('s1', input)).toMatchObject({ mode: 'desktop', scope: 'desktop', target: null })
    expect(listWindows).not.toHaveBeenCalled()
    expect(control.refusal('s1', 'mcp__cua-driver-mcp__get_desktop_state', {})).toBeUndefined()
    expect(control.refusal('s1', 'mcp__cua-driver-mcp__click', { scope: 'desktop', x: 2, y: 3 })).toBeUndefined()
    expect(control.refusal('s1', 'mcp__cua-driver-mcp__click', { pid: 42, window_id: 73, x: 2, y: 3 })).toContain('only explicit desktop')
    expect(control.refusal('s2', 'mcp__cua-driver-mcp__get_desktop_state', {})).toContain('background_first')
    await expect(control.setMode('s2', input)).rejects.toThrow('Another session')
    await vi.advanceTimersByTimeAsync(DESKTOP_FALLBACK_TTL_MS)
    expect(control.refusal('s1', 'mcp__cua-driver-mcp__get_desktop_state', {})).toContain('background_first')
    await control.setMode('s2', input)
    control.endTurn('s2')
    expect(control.status('s2').scope).toBeNull()
  })

  it.each([{ pid: 42 }, { windowId: 73 }, { controlScope: 'auto' }, { reason: '' }])(
    'rejects malformed desktop-surface declarations: %j', async (overrides) => {
      const { control } = harness()
      await expect(control.setMode('s1', {
        controlMode: 'desktop', controlScope: 'desktop', reason: 'menu bar', ...overrides,
      } as ControlRequest)).rejects.toThrow()
    },
  )

  it.each([
    { controlMode: 'auto' }, { pid: undefined }, { pid: 0 }, { windowId: -1 }, { windowId: 1.5 },
    { reason: '' }, { reason: '   ' }, { reason: undefined }, { reason: 'x'.repeat(1001) },
  ])('rejects invalid fallback declarations before discovery: %j', async (over) => {
    const { control, listWindows } = harness()
    await expect(control.setMode('s1', { ...request, ...over } as ControlRequest)).rejects.toThrow()
    expect(listWindows).not.toHaveBeenCalled()
    expect(control.status('s1').mode).toBe('background')
  })

  it.each([
    { inventory: [] },
    { inventory: [{ ...windows[0]!, pid: 43 }] },
    { inventory: [{ ...windows[0]!, windowId: 74 }] },
    { inventory: [{ ...windows[0]!, appName: 'universalAccessAuthWarn', title: 'Screen Recording' }] },
  ])('refuses stale, mismatched, and consent-dialog targets: %j', async ({ inventory }) => {
    const { control, listWindows } = harness()
    listWindows.mockResolvedValue(inventory)
    await expect(control.setMode('s1', request)).rejects.toThrow('no longer available')
    expect(control.status('s1').mode).toBe('background')
  })

  it('never exposes the mutable target or caller request as live permission state', async () => {
    const { control } = harness()
    const input = { ...request }
    const declared = await control.setMode('s1', input)
    declared.target!.pid = 99
    input.windowId = 99
    expect(control.status('s1').target).toEqual({ pid: 42, windowId: 73 })
  })

  it('returns to background without focus restoration or discovery', async () => {
    const { control, listWindows } = harness()
    await control.setMode('s1', request)
    listWindows.mockClear()
    expect(await control.setMode('s1', { controlMode: 'background' })).toMatchObject({ mode: 'background' })
    expect(listWindows).not.toHaveBeenCalled()
    expect(control.refusal('s1', 'mcp__cua-driver__get_desktop_state', {})).toContain('background_first')
  })

  it('does not let another session take the desktop until the owner releases it', async () => {
    const { control } = harness()
    await control.setMode('s1', request)
    await expect(control.setMode('s2', { ...request, pid: 43, windowId: 74 })).rejects.toThrow('Another session')
    control.reset('s2')
    expect(control.status('s1').mode).toBe('desktop')
    control.endTurn('s1')
    expect(await control.setMode('s2', { ...request, pid: 43, windowId: 74 })).toMatchObject({ mode: 'desktop' })
  })

  it('resolves simultaneous declarations atomically after asynchronous discovery', async () => {
    const { control, listWindows } = harness()
    const a = pending<CuaWindow[]>()
    const b = pending<CuaWindow[]>()
    listWindows.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const first = control.setMode('s1', request)
    const second = control.setMode('s2', request)
    const refused = expect(first).rejects.toThrow('Another session')
    b.resolve(windows)
    await second
    a.resolve(windows)
    await refused
    expect(control.status('s2').mode).toBe('desktop')
  })

  it('invalidates pending declarations on release, turn end, or disposal', async () => {
    for (const action of ['release', 'end', 'dispose']) {
      const { control, listWindows } = harness()
      const waiting = pending<CuaWindow[]>()
      listWindows.mockReturnValueOnce(waiting.promise)
      const declared = control.setMode('s1', request)
      const refused = expect(declared).rejects.toThrow('cancelled or superseded')
      if (action === 'release') control.reset('s1')
      else if (action === 'end') control.endTurn('s1')
      else control.dispose()
      waiting.resolve(windows)
      await refused
      expect(control.status('s1').mode).toBe('background')
    }
  })

  it('keeps a slow older request from replacing the latest target', async () => {
    const { control, listWindows } = harness()
    const waiting = pending<CuaWindow[]>()
    listWindows.mockReturnValueOnce(waiting.promise)
    const first = control.setMode('s1', request)
    const refused = expect(first).rejects.toThrow('cancelled or superseded')
    await control.setMode('s1', { ...request, pid: 43, windowId: 74 })
    waiting.resolve(windows)
    await refused
    expect(control.status('s1').target).toEqual({ pid: 43, windowId: 74 })
  })

  it('checks cancellation on both sides of discovery', async () => {
    const { control, listWindows } = harness()
    const cancelled = AbortSignal.abort(new Error('cancelled'))
    await expect(control.setMode('s1', request, cancelled)).rejects.toThrow('cancelled')
    expect(listWindows).not.toHaveBeenCalled()
    const signal = new AbortController()
    listWindows.mockImplementationOnce(async () => { signal.abort(new Error('cancelled')); return windows })
    await expect(control.setMode('s1', request, signal.signal)).rejects.toThrow('cancelled')
    expect(control.status('s1').mode).toBe('background')
  })

  it('uses the turn cancellation lifetime instead of a completed Code Mode subcall', async () => {
    const { control } = harness()
    const turn = new AbortController()
    const code = new AbortController()
    control.bindTurn('s1', turn.signal)
    await control.setMode('s1', request, code.signal)
    code.abort('run_code settled')
    expect(control.status('s1').mode).toBe('desktop')
    control.bindTurn('s1', turn.signal)
    expect(control.status('s1').mode).toBe('desktop')
    turn.abort('user interrupted')
    expect(control.status('s1').mode).toBe('background')
    expect(control.sessionIds()).toEqual([])
  })

  it('clears fallback at a new turn and isolates old abort notifications', async () => {
    const { control } = harness()
    const previous = new AbortController()
    const current = new AbortController()
    control.bindTurn('s1', previous.signal)
    await control.setMode('s1', request)
    control.bindTurn('s1', current.signal)
    expect(control.status('s1').mode).toBe('background')
    await control.setMode('s1', request)
    previous.abort()
    expect(control.status('s1').mode).toBe('desktop')
    control.bindTurn('s1', AbortSignal.abort())
    expect(control.status('s1').mode).toBe('background')
  })

  it('expires after five minutes, including lazy expiry when timer delivery is delayed', async () => {
    const { control } = harness()
    await control.setMode('s1', request)
    await vi.advanceTimersByTimeAsync(DESKTOP_FALLBACK_TTL_MS - 1)
    expect(control.status('s1').mode).toBe('desktop')
    await vi.advanceTimersByTimeAsync(1)
    expect(control.status('s1').mode).toBe('background')
    await control.setMode('s1', request)
    vi.setSystemTime(Date.now() + DESKTOP_FALLBACK_TTL_MS)
    expect(control.status('s1').mode).toBe('background')
  })

  it('clears stale expiry timers on explicit renewal', async () => {
    const { control } = harness()
    await control.setMode('s1', request)
    await vi.advanceTimersByTimeAsync(1000)
    await control.setMode('s1', request)
    await vi.advanceTimersByTimeAsync(DESKTOP_FALLBACK_TTL_MS - 1000)
    expect(control.status('s1').mode).toBe('desktop')
    await vi.advanceTimersByTimeAsync(1000)
    expect(control.status('s1').mode).toBe('background')
  })

  it('preserves the current lease if a replacement target cannot be verified', async () => {
    const { control, listWindows } = harness()
    await control.setMode('s1', request)
    listWindows.mockRejectedValueOnce(new Error('driver unavailable'))
    await expect(control.setMode('s1', { ...request, pid: 43, windowId: 74 })).rejects.toThrow('driver unavailable')
    expect(control.status('s1').target).toEqual({ pid: 42, windowId: 73 })
    control.dispose()
    expect(control.sessionIds()).toEqual([])
    await expect(control.setMode('s1', request)).rejects.toThrow('unloaded')
  })
})
