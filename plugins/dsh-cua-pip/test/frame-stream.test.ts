import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_BACKPRESSURE_TIMEOUT_MS, STREAM_HEARTBEAT_MS, streamFrames } from '../src/frame-stream.ts'
import type { FrameResponse, WatcherSnapshot } from '../src/shared/types.ts'

function snapshot(frames: number): WatcherSnapshot {
  return {
    sessionId: 's1', target: { pid: 1, windowId: 10 }, frames, updatedAt: 1000 + frames,
    lastFetchAt: 1000, error: null,
    frame: { mime: 'image/png', base64: String(frames), width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock' },
  }
}

function fixture(initial: WatcherSnapshot | null = snapshot(1), acceptWrites = true) {
  let listener: ((state: WatcherSnapshot | null) => void) | undefined
  const unsubscribed = vi.fn()
  const source = {
    subscribe: vi.fn((_sessionId: string, callback: (state: WatcherSnapshot | null) => void) => {
      listener = callback
      callback(initial)
      return unsubscribed
    }),
  }
  const req = new EventEmitter() as IncomingMessage
  const chunks: string[] = []
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    acceptWrites,
    headers: {} as Record<string, string>,
    writeHead: vi.fn((_status: number, headers: Record<string, string>) => { res.headers = headers }),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { chunks.push(chunk); return res.acceptWrites }),
    end: vi.fn(() => { res.writableEnded = true }),
    destroy: vi.fn(() => { res.destroyed = true; res.emit('close') }),
  })
  const close = streamFrames(source, 's1', req, res as unknown as ServerResponse)
  const updates = (): FrameResponse[] => chunks
    .filter((chunk) => chunk.startsWith('event: frame'))
    .map((chunk) => JSON.parse(chunk.split('data: ')[1]!))
  return { req, res, close, chunks, updates, source, unsubscribed, emit: (state: WatcherSnapshot | null) => listener?.(state) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('frame streaming interface', () => {
  it('sends the current frame immediately, then each completed capture without polling delay', () => {
    const h = fixture()
    expect(h.res.headers['content-type']).toContain('text/event-stream')
    expect(h.res.headers['cache-control']).toContain('no-transform')
    expect(h.updates().map((row) => row.state?.frames)).toEqual([1])
    h.emit(snapshot(2))
    h.emit(snapshot(3))
    expect(h.updates().map((row) => row.state?.frames)).toEqual([1, 2, 3])
    expect(h.res.writableEnded).toBe(false)
    h.close()
  })

  it('keeps only the newest pending frame on a slow connection', () => {
    const h = fixture(snapshot(1), false)
    for (let count = 2; count <= 50; count++) h.emit(snapshot(count))
    expect(h.updates()).toHaveLength(1)
    h.res.acceptWrites = true
    h.res.emit('drain')
    expect(h.updates().map((row) => row.state?.frames)).toEqual([1, 50])
    h.close()
  })

  it('signals a closed preview and removes the subscription without reopening it', () => {
    const h = fixture()
    h.emit(null)
    expect(h.updates().at(-1)).toEqual({ ok: true, watching: false })
    expect(h.res.writableEnded).toBe(true)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
    h.emit(snapshot(3))
    expect(h.updates()).toHaveLength(2)
  })

  it('does not leak the subscription when an already closed preview emits synchronously', () => {
    const h = fixture(null)
    expect(h.updates()).toEqual([{ ok: true, watching: false }])
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces pending imagery with the close notification under backpressure', () => {
    const h = fixture(snapshot(1), false)
    h.emit(snapshot(2))
    h.emit(null)
    h.res.acceptWrites = true
    h.res.emit('drain')
    expect(h.updates()).toEqual([
      { ok: true, watching: true, state: snapshot(1) },
      { ok: true, watching: false },
    ])
    expect(h.res.writableEnded).toBe(true)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
  })

  it('never replaces a blocked close event with a newly reopened preview', () => {
    const h = fixture(snapshot(1), false)
    h.emit(null)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
    h.emit({ ...snapshot(2), target: { pid: 2, windowId: 20 } })
    h.res.acceptWrites = true
    h.res.emit('drain')
    expect(h.updates()).toEqual([
      { ok: true, watching: true, state: snapshot(1) },
      { ok: true, watching: false },
    ])
    expect(h.res.writableEnded).toBe(true)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
  })

  it('releases a disconnected client and its heartbeat while leaving the watch source alone', () => {
    const h = fixture()
    h.res.emit('close')
    h.emit(snapshot(2))
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS * 2)
    expect(h.updates()).toHaveLength(1)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    h.close()
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
  })

  it('keeps idle connections alive without queuing heartbeats behind blocked frames', () => {
    const h = fixture()
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS)
    expect(h.chunks.at(-1)).toBe(': keepalive\n\n')
    h.res.acceptWrites = false
    h.emit(snapshot(2))
    const length = h.chunks.length
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS)
    expect(h.chunks).toHaveLength(length)
    h.close()
  })

  it('disconnects a socket that cannot drain instead of retaining an unbounded queue', () => {
    const h = fixture(snapshot(1), false)
    h.emit(snapshot(20))
    vi.advanceTimersByTime(STREAM_BACKPRESSURE_TIMEOUT_MS)
    expect(h.res.destroy).toHaveBeenCalledTimes(1)
    expect(h.unsubscribed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(h.updates()).toHaveLength(1)
  })

  it('forwards capture failures with the last frame so the client can mark it stale', () => {
    const h = fixture()
    h.emit({ ...snapshot(1), error: 'capture unavailable' })
    expect(h.updates().at(-1)?.state).toMatchObject({ error: 'capture unavailable', frames: 1, updatedAt: 1001 })
    h.close()
  })
})
