import { describe, expect, it } from 'vitest'
import { recordingStatus, sampleAfter } from '../src/shared/recording-state.ts'
import type { WatcherSnapshot } from '../src/shared/types.ts'

const snapshot = (over: Partial<WatcherSnapshot> = {}): WatcherSnapshot => ({
  sessionId: 's1', target: { pid: 1, windowId: 10 }, frames: 1, updatedAt: 10_000,
  lastFetchAt: 10_000, error: null,
  frame: { mime: 'image/jpeg', base64: 'frame', width: 100, height: 100, appName: 'App', windowTitle: '' },
  ...over,
})

describe('recording readiness', () => {
  it('distinguishes an open watcher from an available first frame', () => {
    expect(recordingStatus(null, 10_000)).toMatchObject({ state: 'closed', ready: false })
    expect(recordingStatus(snapshot({ frame: null }), 10_000)).toMatchObject({ state: 'starting', ready: false })
    expect(recordingStatus(snapshot(), 10_000)).toMatchObject({ state: 'ready', ready: true })
    expect(recordingStatus(snapshot(), 14_000)).toMatchObject({ state: 'stale', ready: false })
  })

  it('accepts native idle without treating its heartbeat as new pixels', () => {
    const idle = snapshot({ captureHealth: { status: 'idle', checkedAt: 20_000 } })
    expect(recordingStatus(idle, 20_000)).toMatchObject({ ready: true })
    expect(idle.updatedAt).toBe(10_000)
    expect(recordingStatus(idle, 24_000)).toMatchObject({ ready: false, state: 'stale' })
    expect(recordingStatus(snapshot({ captureHealth: { status: 'complete', checkedAt: 20_000 } }), 20_000))
      .toMatchObject({ ready: false })
  })

  it.each(['blank', 'suspended'] as const)('blocks input on %s even with a recent cached sample', (status) => {
    expect(recordingStatus(snapshot({ captureHealth: { status, checkedAt: 10_000 } }), 10_000))
      .toMatchObject({ state: 'suspended', ready: false })
  })

  it.each([
    ['recovering', 'recovering'], ['paused', 'stopped'], ['failed', 'failed'],
  ] as const)('preserves lifecycle %s over any cached frame', (phase, state) => {
    expect(recordingStatus(snapshot({
      captureLifecycle: { phase, generation: 2, retryCount: 2, nextRetryAt: 11_000, errorCode: 'error' },
    }), 10_000)).toMatchObject({ state, ready: false, generation: 2, retryCount: 2 })
  })

  it('rejects recorded errors, stale heartbeats, and implausible future timestamps', () => {
    expect(recordingStatus(snapshot({ error: 'failed' }), 10_000).ready).toBe(false)
    expect(recordingStatus(snapshot({ captureHealth: { status: 'complete', checkedAt: 1000 } }), 10_000).ready).toBe(false)
    expect(recordingStatus(snapshot({ updatedAt: 100_000 }), 10_000).ready).toBe(false)
  })

  it('requires a sample or native idle observation after an action, not the old cached image', () => {
    expect(sampleAfter(snapshot(), 10_000)).toBe(false)
    expect(sampleAfter(snapshot({ updatedAt: 10_001 }), 10_000)).toBe(true)
    expect(sampleAfter(snapshot({ captureHealth: { status: 'idle', checkedAt: 10_001, sampleAt: 10_001 } }), 10_000)).toBe(true)
    expect(sampleAfter(snapshot({ captureHealth: { status: 'idle', checkedAt: 10_001, sampleAt: 10_000 } }), 10_000)).toBe(false)
    expect(sampleAfter(snapshot({ captureHealth: { status: 'idle', checkedAt: 10_001 } }), 10_000)).toBe(false)
    expect(sampleAfter(snapshot({ captureHealth: { status: 'complete', checkedAt: 10_001 } }), 10_000)).toBe(false)
  })
})
