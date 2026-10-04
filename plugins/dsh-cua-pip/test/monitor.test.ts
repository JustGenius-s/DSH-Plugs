import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CuaError } from '../src/cua.ts'
import { PreviewMonitor } from '../src/monitor.ts'
import { WatcherRegistry } from '../src/watcher.ts'
import type { Frame, CuaWindow } from '../src/shared/types.ts'

const target = { pid: 42, windowId: 73 }
const name = 'mcp__cua-driver-mcp__click'
const delivery = { messageId: 'pip-context', attachmentId: 'pip-image' }
const requestImage = [{ id: delivery.messageId, content: [{ type: 'image', attachment: { attachmentId: delivery.attachmentId } }] }]
const registries: WatcherRegistry[] = []
function harness() {
  let open = true
  let openedAt = 1000
  let count = 0
  const frame = (): Frame => ({
    mime: 'image/jpeg', base64: 'test', width: 100, height: 80, appName: 'App', windowTitle: '',
    frameId: `native:${++count}`, imageHash: 'same-pixels', capturedAt: Date.now(),
  })
  const capture = vi.fn(async (): Promise<Frame | null> => frame())
  const windows: CuaWindow[] = [{ ...target, appName: 'App', title: '', isOnScreen: true, bounds: { x: 0, y: 0, width: 800, height: 640 } }]
  const release = vi.fn()
  const registry = new WatcherRegistry({
    fps: 30, backgroundFps: 1, maxDimension: 1024, maxWatchers: 3, idleTtlMs: 45_000,
    autoStart: false, capture, release, listWindows: async () => windows,
  })
  registries.push(registry)
  const monitor = new PreviewMonitor(registry, () => ({ open, openedAt }))
  registry.watch('s1', target, { retained: true })
  const observe = async () => {
    const ticket = await monitor.observe('s1')
    expect(ticket).not.toBeNull()
    monitor.acknowledge(ticket!, delivery)
    monitor.deliver('s1', requestImage)
    return ticket!
  }
  return { registry, monitor, capture, release, frame, observe, scope: (nextOpen: boolean, epoch = openedAt) => { open = nextOpen; openedAt = epoch } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000) })
afterEach(() => { for (const registry of registries.splice(0)) registry.dispose(); vi.useRealTimers() })

describe('monitored application input', () => {
  it('tracks overlapping direct inputs without gating them or treating a partial finish as idle', async () => {
    const h = harness()
    const first = h.monitor.track('s1', name)
    const second = h.monitor.track('s1', name)
    second()
    await expect(h.monitor.observe('s1')).rejects.toThrow('in-flight')
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_action_in_flight')
    first()
    first()
    await vi.advanceTimersByTimeAsync(1)
    await h.registry.tickNow('s1')
    await h.observe()
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
  })

  it('refuses input before first frame and then until the actual PiP image is delivered', async () => {
    const h = harness()
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_not_ready')
    expect(h.monitor.summary('s1')).toMatchObject({ recording: { state: 'starting' }, needsObservation: true })
    await h.registry.tickNow('s1')
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
    const ticket = await h.monitor.observe('s1')
    expect(ticket?.frame).toBe(h.registry.snapshot('s1')!.frame)
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
    h.monitor.acknowledge(ticket!, delivery)
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_pending')
    expect(h.monitor.summary('s1').observationDelivery).toBe('queued')
    h.monitor.deliver('s1', requestImage)
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
    expect(h.monitor.summary('s1').observationDelivery).toBe('delivered')
  })

  it('invalidates observation after every actual input, even if the input result failed', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    await h.observe()
    const finish = h.monitor.begin('s1', name, target)
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_action_in_flight')
    expect(() => h.monitor.begin('s1', name, target)).toThrow('pip_action_in_flight')
    await expect(h.monitor.observe('s1')).rejects.toThrow('in-flight')
    finish()
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
    let delivered = false
    const observation = h.monitor.observe('s1').then((value) => { delivered = true; return value })
    await Promise.resolve()
    expect(delivered).toBe(false)
    vi.setSystemTime(1001)
    await h.registry.tickNow('s1')
    const ticket = await observation
    h.monitor.acknowledge(ticket!, delivery)
    h.monitor.deliver('s1', requestImage)
    expect(ticket!.sample.capturedAt).toBe(1001)
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
  })

  it('does not equate new sample IDs with visible application changes', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    const first = await h.observe()
    h.monitor.begin('s1', name, target)()
    vi.setSystemTime(1001)
    await h.registry.tickNow('s1')
    const second = await h.observe()
    expect(second.sample.frameId).not.toBe(first.sample.frameId)
    expect(second.sample.imageHash).toBe(first.sample.imageHash)
    expect(h.monitor.context('s1')).toContain('not proof of application progress')
  })

  it('lets read-only discovery continue while input is gated, and respects explicit desktop degradation', () => {
    const h = harness()
    expect(h.monitor.refusal('s1', 'mcp__cua-driver-mcp__get_window_state', target)).toBeUndefined()
    expect(h.monitor.refusal('s1', name, target, true)).toBeUndefined()
    expect(h.monitor.summary('s1').recording.ready).toBe(false)
    h.scope(false)
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
    expect(h.monitor.refusal(undefined, name, target)).toBeUndefined()
    expect(h.monitor.context('s1')).toBeNull()
  })

  it('rejects a different action target and invalidates rights on retarget or stream restart', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    await h.observe()
    expect(h.monitor.refusal('s1', name, { pid: 42, windowId: 74 })).toContain('pip_target_mismatch')
    h.registry.refresh('s1')
    await h.registry.tickNow('s1')
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
    await h.observe()
    h.registry.watch('s1', { pid: 43, windowId: 74 })
    await h.registry.tickNow('s1')
    expect(h.monitor.refusal('s1', name, { pid: 43, windowId: 74 })).toContain('pip_observation_required')
  })

  it('waits through a same-window capture failure and observes the recovered stream before input', async () => {
    const h = harness()
    h.capture.mockRejectedValueOnce(new CuaError('metadata temporarily missing', 'window_gone'))
    await h.registry.tickNow('s1')
    expect(h.monitor.summary('s1').recording).toMatchObject({ ready: false, state: 'recovering', retryCount: 1 })
    expect(h.release).toHaveBeenCalledWith('s1')
    const waiting = h.monitor.observe('s1')
    vi.setSystemTime(1500)
    await h.registry.tickNow('s1')
    const ticket = await waiting
    expect(ticket?.sample.generation).toBe(1)
    h.monitor.acknowledge(ticket!, delivery)
    h.monitor.deliver('s1', requestImage)
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
  })

  it.each(['capture_stopped', 'permission_denied'] as const)('does not restart a %s recorder during observation or tool activity', async (code) => {
    const h = harness()
    h.capture.mockRejectedValueOnce(new CuaError('stopped', code))
    await h.registry.tickNow('s1')
    expect(await h.monitor.observe('s1')).toBeNull()
    h.registry.watch('s1', target, { restartStopped: false })
    await h.registry.tickNow('s1')
    expect(h.capture).toHaveBeenCalledOnce()
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_not_ready')
  })

  it('times out a recorder with no sample without pretending it is ready', async () => {
    const h = harness()
    h.capture.mockResolvedValue(null)
    const waiting = h.monitor.observe('s1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await waiting).toBeNull()
    expect(h.monitor.summary('s1')).toMatchObject({ recording: { ready: false }, observation: null })
  })

  it('cancels a pending observation and leaves the existing watcher owned by its session', async () => {
    const h = harness()
    const abort = new AbortController()
    const waiting = h.monitor.observe('s1', abort.signal)
    const rejected = expect(waiting).rejects.toThrow('cancelled')
    abort.abort(new Error('cancelled'))
    await rejected
    expect(h.registry.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not acknowledge an image after close/reopen, a delayed mutation, or another policy refusal', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    const ticket = await h.observe()
    h.scope(false)
    expect(() => h.monitor.acknowledge(ticket, delivery)).toThrow('changed')
    h.scope(true, 2000)
    expect(() => h.monitor.acknowledge(ticket, delivery)).toThrow('changed')
    await h.observe()
    h.monitor.rejectObservation('s1')
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
  })

  it('invalidates stale frames and expired observations instead of relying on an open stream', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    await h.observe()
    vi.setSystemTime(5000)
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_not_ready')
    vi.setSystemTime(32_000)
    await h.registry.tickNow('s1')
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
  })

  it('requires the exact queued image in this session request, not just a matching message or attachment elsewhere', async () => {
    const h = harness()
    await h.registry.tickNow('s1')
    h.monitor.acknowledge((await h.monitor.observe('s1'))!, delivery)
    h.monitor.deliver('s2', requestImage)
    for (const messages of [
      [], [{ id: delivery.messageId, content: [{ type: 'text' }] }],
      [{ id: 'another-message', content: requestImage[0]!.content }],
      [{ id: delivery.messageId, content: [{ type: 'image', attachment: { attachmentId: 'another-image' } }] }],
    ]) {
      h.monitor.deliver('s1', messages)
      expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_pending')
    }
    h.monitor.deliver('s1', requestImage)
    expect(h.monitor.refusal('s1', name, target)).toBeUndefined()
    h.monitor.begin('s1', name, target)()
    h.monitor.deliver('s1', requestImage)
    expect(h.monitor.refusal('s1', name, target)).toContain('pip_observation_required')
  })
})
