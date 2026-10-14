import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseNativeFrame, WindowCaptureSource } from '../src/native-capture.ts'
import { WatcherRegistry } from '../src/watcher.ts'
import { recordingStatus, sampleAfter } from '../src/shared/recording-state.ts'

const target = { pid: 42, windowId: 73 }
const packet = {
  protocol: 1, type: 'frame', source: 'screencapturekit-window', ...target,
  sequence: 1, capturedAt: 1000, width: 800, height: 600,
  mime: 'image/jpeg', base64: Buffer.from([255, 216, 255, 217]).toString('base64'),
  appName: 'Clock', windowTitle: 'Clock', windowBounds: { x: 40, y: 70, width: 1200, height: 900 },
}

function harness() {
  const children: (EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn>;
    exitCode: number | null; signalCode: null;
  })[] = []
  const launch = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: vi.fn(), exitCode: null, signalCode: null,
    })
    children.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  const source = new WindowCaptureSource({ platform: 'darwin', launch, bin: '/local/window-capture', startupTimeoutMs: 100 })
  const write = (value: unknown, index = 0) => children[index]!.stdout.write(JSON.stringify(value) + '\n')
  return { source, launch, children, write }
}

afterEach(() => vi.useRealTimers())

describe('native window capture protocol', () => {
  it('preserves native sample timestamps and separates screenshot pixels from window geometry', () => {
    expect(parseNativeFrame(JSON.stringify(packet), target, 1024)).toMatchObject({
      capturedAt: 1000, sequence: 1, width: 800, height: 600, windowBounds: packet.windowBounds,
    })
  })
  it.each([
    { pid: 43 }, { windowId: 74 }, { source: 'display-crop' }, { protocol: 2 },
    { width: 2048 }, { height: -1 }, { mime: 'image/png' }, { sequence: 0 }, { capturedAt: null },
    { base64: 'invalid' }, { appName: null }, { windowBounds: { width: 0 } },
  ])('rejects unsafe frames: %j', (over) => {
    expect(() => parseNativeFrame(JSON.stringify({ ...packet, ...over }), target, 1024)).toThrow()
  })
  it.each(['window_gone', 'permission_denied', 'capture_stopped', 'capture_interrupted'])('preserves native error %s', (code) => {
    expect(() => parseNativeFrame(JSON.stringify({ protocol: 1, type: 'error', code, message: 'refused' }), target, 1024))
      .toThrowError(expect.objectContaining({ code }))
  })
})

describe('persistent native stream lifecycle', () => {
  it('starts one exact-window stream, consumes fresh samples and never polls the driver', async () => {
    const h = harness()
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    expect(h.launch).toHaveBeenCalledWith('/local/window-capture', [
      '--pid', '42', '--window-id', '73', '--max-dimension', '1024', '--fps', '30',
    ])
    h.write(packet)
    expect(await h.source.capture(target, 1024, 's1')).toMatchObject({ capturedAt: 1000 })
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    h.write({ ...packet, sequence: 2, capturedAt: 2000 })
    expect(await h.source.capture(target, 1024, 's1')).toMatchObject({ capturedAt: 2000 })
    expect(h.launch).toHaveBeenCalledTimes(1)
    h.source.dispose()
  })
  it('gives restarted samples distinct identities without claiming identical pixels changed', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.write(packet)
    const first = await h.source.capture(target, 1024, 's1')
    h.source.release('s1')
    await h.source.capture(target, 1024, 's1')
    h.write(packet, 1)
    const next = await h.source.capture(target, 1024, 's1')
    expect(next?.frameId).not.toBe(first?.frameId)
    expect(next?.imageHash).toBe(first?.imageHash)
    expect(first?.imageHash).toMatch(/^[a-f0-9]{64}$/)
    h.source.dispose()
  })
  it('shares the stream but not frame cursors between sessions and stops at the last release', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    await h.source.capture(target, 1024, 's2')
    h.write(packet)
    expect(await h.source.capture(target, 1024, 's1')).not.toBeNull()
    expect(await h.source.capture(target, 1024, 's2')).not.toBeNull()
    h.source.release('s1')
    expect(h.children[0]!.stdin.writableEnded).toBe(false)
    h.source.release('s2')
    expect(h.children[0]!.stdin.writableEnded).toBe(true)
    expect(h.children[0]!.stdin.read()?.toString()).toBe('stop\n')
    expect(h.launch).toHaveBeenCalledTimes(1)
    h.source.dispose()
  })
  it('tears down the old stream on retarget and ignores its late frames', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    const next = { pid: 43, windowId: 74 }
    expect(await h.source.capture(next, 1024, 's1')).toBeNull()
    h.write(packet)
    expect(h.children[0]!.stdin.writableEnded).toBe(true)
    expect(await h.source.capture(next, 1024, 's1')).toBeNull()
    h.write({ ...packet, ...next }, 1)
    expect(await h.source.capture(next, 1024, 's1')).not.toBeNull()
    h.source.dispose()
  })
  it('keeps only the latest frame under backpressure and supports split protocol lines', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    const data = JSON.stringify(packet)
    h.children[0]!.stdout.write(data.slice(0, 40))
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    h.children[0]!.stdout.write(data.slice(40) + '\n')
    for (let sequence = 2; sequence < 40; sequence++) h.write({ ...packet, sequence })
    expect(await h.source.capture(target, 1024, 's1')).toMatchObject({ sequence: 39 })
    h.source.dispose()
  })
  it('does not restart a denied or system-stopped recording without release/reopen', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.write({ protocol: 1, type: 'error', code: 'permission_denied', message: 'grant permission' })
    await expect(h.source.capture(target, 1024, 's1')).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(h.source.capture(target, 1024, 's1')).rejects.toMatchObject({ code: 'permission_denied' })
    expect(h.launch).toHaveBeenCalledTimes(1)
    h.source.release('s1')
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    expect(h.launch).toHaveBeenCalledTimes(2)
    h.source.dispose()
  })
  it('fails closed on a wrong-window frame, oversized message, or corrupt JSON', async () => {
    for (const input of [JSON.stringify({ ...packet, pid: 99 }) + '\n', '{oops}\n', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
      const h = harness()
      await h.source.capture(target, 1024, 's1')
      h.children[0]!.stdout.write(input)
      await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow()
      expect(h.children[0]!.stdin.writableEnded).toBe(true)
      expect(h.launch).toHaveBeenCalledTimes(1)
      h.source.dispose()
    }
  })
  it('can explicitly reopen a failed shared stream without restarting its other stopped owner', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    await h.source.capture(target, 1024, 's2')
    h.write({ protocol: 1, type: 'error', code: 'capture_stopped', message: 'user ended sharing' })
    await expect(h.source.capture(target, 1024, 's2')).rejects.toThrow('user ended sharing')
    h.source.release('s1')
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    h.write(packet, 1)
    expect(await h.source.capture(target, 1024, 's1')).not.toBeNull()
    await expect(h.source.capture(target, 1024, 's2')).rejects.toThrow('user ended sharing')
    h.source.release('s2')
    expect(h.children[1]!.stdin.writableEnded).toBe(false)
    h.source.release('s1')
    expect(h.children[1]!.stdin.writableEnded).toBe(true)
    h.source.dispose()
  })
  it('times out startup and forces a hung helper to exit after release', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(h.source.capture(target, 1024, 's1')).rejects.toMatchObject({ code: 'capture_interrupted' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.children[0]!.kill).toHaveBeenCalledWith('SIGKILL')
    h.source.dispose()
  })
  it('distinguishes native idle heartbeats from new frame samples', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.write(packet)
    expect(await h.source.capture(target, 1024, 's1')).not.toBeNull()
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      h.write({ protocol: 1, type: 'status', ...target, status: 'idle' })
      expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    }
    expect(h.source.observation('s1')).toEqual({ status: 'idle', checkedAt: 9000 })
    expect(h.children[0]!.stdin.writableEnded).toBe(false)
    await vi.advanceTimersByTimeAsync(6000)
    await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow('stopped responding')
    h.source.dispose()
  })
  it('does not advance native sampling time when repeating a healthy idle heartbeat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.write(packet)
    await h.source.capture(target, 1024, 's1')
    h.write({ protocol: 1, type: 'status', ...target, status: 'idle', sampleAt: 1000 })
    vi.setSystemTime(2000)
    h.write({ protocol: 1, type: 'status', ...target, status: 'idle', sampleAt: 1000 })
    expect(h.source.observation('s1')).toEqual({ status: 'idle', checkedAt: 2000, sampleAt: 1000 })
    expect(await h.source.capture(target, 1024, 's1')).toBeNull()
    h.source.dispose()
  })
  it('does not let a status heartbeat substitute for the first frame or target identity', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.write({ protocol: 1, type: 'status', ...target, status: 'idle' })
    await vi.advanceTimersByTimeAsync(100)
    await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow('produced no frame')
    h.source.release('s1')
    await h.source.capture(target, 1024, 's1')
    h.write({ protocol: 1, type: 'status', ...target, windowId: 74, status: 'idle' }, 1)
    await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow('Invalid native capture heartbeat')
    h.source.dispose()
  })
  it('surfaces process spawn and exit errors without a screenshot fallback', async () => {
    const h = harness()
    await h.source.capture(target, 1024, 's1')
    h.children[0]!.emit('error', new Error('ENOENT'))
    await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow('no screenshot fallback')
    h.source.release('s1')
    await h.source.capture(target, 1024, 's1')
    h.children[1]!.exitCode = 1
    h.children[1]!.emit('exit', 1, null)
    await expect(h.source.capture(target, 1024, 's1')).rejects.toMatchObject({ code: 'capture_interrupted' })
    h.source.dispose()
    await expect(h.source.capture(target, 1024, 's1')).rejects.toThrow('disposed')
  })
  it('rejects unsupported platforms and invalid targets before starting a process', async () => {
    const launch = vi.fn()
    const source = new WindowCaptureSource({ platform: 'linux', launch })
    await expect(source.capture(target, 1024, 's1')).rejects.toThrow('fallback is disabled')
    expect(launch).not.toHaveBeenCalled()
    const h = harness()
    await expect(h.source.capture({ pid: -1, windowId: 73 }, 1024, 's1')).rejects.toThrow()
    expect(h.launch).not.toHaveBeenCalled()
    h.source.dispose()
  })
})

describe('native stream and watcher recovery integration', () => {
  function watched() {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const h = harness()
    const registry = new WatcherRegistry({
      fps: 30, backgroundFps: 1, maxDimension: 1024, maxWatchers: 3, idleTtlMs: 45_000, autoStart: false,
      capture: (target, dimension, session) => h.source.capture(target, dimension, session),
      release: (session) => h.source.release(session),
      captureHealth: (session) => h.source.observation(session),
      listWindows: async () => [{ ...target, appName: 'Clock', title: 'Clock', isOnScreen: true, bounds: packet.windowBounds }],
    })
    registry.watch('s1', target, { retained: true })
    return { ...h, registry, dispose: () => { registry.dispose(); h.source.dispose() } }
  }

  it('releases the cached failed source and rebuilds even when discovery returns the same window', async () => {
    const h = watched()
    try {
      await h.registry.tickNow('s1')
      h.write(packet)
      await h.registry.tickNow('s1')
      const old = h.registry.snapshot('s1')!.frame
      h.write({ protocol: 1, type: 'error', code: 'window_gone', message: 'temporarily unavailable' })
      await h.registry.tickNow('s1')
      expect(h.registry.snapshot('s1')).toMatchObject({
        target, frame: null, captureLifecycle: { phase: 'recovering', generation: 1, retryCount: 1, nextRetryAt: 1500 },
      })
      h.registry.watch('s1', target, { restartStopped: false })
      await h.registry.tickNow('s1')
      expect(h.launch).toHaveBeenCalledOnce()
      vi.setSystemTime(1500)
      await h.registry.tickNow('s1')
      expect(h.launch).toHaveBeenCalledTimes(2)
      h.write({ ...packet, capturedAt: 1500 }, 1)
      await h.registry.tickNow('s1')
      const recovered = h.registry.snapshot('s1')!
      expect(recordingStatus(recovered, 1500)).toMatchObject({ ready: true, generation: 1 })
      expect(recovered.frame?.frameId).not.toBe(old?.frameId)
      expect(recovered.frame?.imageHash).toBe(old?.imageHash)
    } finally { h.dispose() }
  })

  it.each(['permission_denied', 'capture_stopped'] as const)('does not retry %s after fresh discovery, subscriptions or input activity', async (code) => {
    const h = watched()
    try {
      await h.registry.tickNow('s1')
      h.write({ protocol: 1, type: 'error', code, message: 'stopped' })
      await h.registry.tickNow('s1')
      const unsubscribe = h.registry.subscribe('s1', () => {})
      h.registry.watch('s1', target, { restartStopped: false })
      h.registry.refresh('s1')
      vi.setSystemTime(5000)
      await h.registry.tickNow('s1')
      expect(h.launch).toHaveBeenCalledOnce()
      expect(h.registry.snapshot('s1')).toMatchObject({ frame: null, captureLifecycle: { phase: 'paused', errorCode: code } })
      unsubscribe()
    } finally { h.dispose() }
  })

  it('does not restart after closing during the recovery backoff', async () => {
    const h = watched()
    try {
      await h.registry.tickNow('s1')
      h.write({ protocol: 1, type: 'error', code: 'capture_interrupted', message: 'connection lost' })
      await h.registry.tickNow('s1')
      h.registry.unwatch('s1')
      vi.setSystemTime(10_000)
      await h.registry.tickNow('s1')
      expect(h.registry.snapshot('s1')).toBeNull()
      expect(h.launch).toHaveBeenCalledOnce()
    } finally { h.dispose() }
  })

  it('accepts only a post-action native sample notification, not a repeated heartbeat', async () => {
    const h = watched()
    try {
      await h.registry.tickNow('s1')
      h.write(packet)
      await h.registry.tickNow('s1')
      vi.setSystemTime(2000)
      h.write({ protocol: 1, type: 'status', ...target, status: 'idle', sampleAt: 1000 })
      await h.registry.tickNow('s1')
      expect(sampleAfter(h.registry.snapshot('s1')!, 1500)).toBe(false)
      h.write({ protocol: 1, type: 'status', ...target, status: 'idle', sampleAt: 2000 })
      await h.registry.tickNow('s1')
      expect(sampleAfter(h.registry.snapshot('s1')!, 1500)).toBe(true)
      expect(h.registry.snapshot('s1')).toMatchObject({ frames: 1, updatedAt: 1000 })
    } finally { h.dispose() }
  })
})
