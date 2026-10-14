import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  startFrameFeed,
  type FrameEventSource,
  type FrameStreamEvent,
} from '../src/client/frame-feed.ts'
import type { FrameResponse } from '../src/shared/types.ts'

class FakeEventSource implements FrameEventSource {
  readyState = 0
  closed = false
  listeners = new Map<string, Set<(event: FrameStreamEvent) => void>>()

  addEventListener(type: string, listener: (event: FrameStreamEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: FrameStreamEvent) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, data })
  }

  frame(body: FrameResponse): void {
    this.emit('frame', JSON.stringify(body))
  }
}

const frame = (updatedAt = 1000, sessionId = 'one'): FrameResponse => ({
  ok: true,
  watching: true,
  state: {
    sessionId,
    target: { pid: 1, windowId: 2 },
    updatedAt,
    lastFetchAt: updatedAt,
    frames: 1,
    error: null,
    frame: {
      mime: 'image/png',
      base64: `image-${updatedAt}`,
      width: 800,
      height: 600,
      appName: 'Clock',
      windowTitle: 'Stopwatch',
    },
  },
})

const callbacks = () => ({ onFrame: vi.fn(), onConnection: vi.fn() })
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

afterEach(() => {
  vi.useRealTimers()
})

describe('streaming frame feed', () => {
  it('delivers every pushed frame immediately without a polling delay', () => {
    vi.useFakeTimers()
    const source = new FakeEventSource()
    const read = vi.fn()
    const handlers = callbacks()
    const feed = startFrameFeed('one', { connect: () => source, read, ...handlers })
    source.readyState = 1
    source.emit('open')
    for (const updatedAt of [1000, 1200, 1400, 1600, 1800]) source.frame(frame(updatedAt))

    expect(handlers.onFrame).toHaveBeenCalledTimes(5)
    expect(handlers.onFrame.mock.calls.map(([body]) => body.state.updatedAt))
      .toEqual([1000, 1200, 1400, 1600, 1800])
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    feed.close()
    expect(source.closed).toBe(true)
  })

  it('lets EventSource reconnect without a parallel fallback or another stream', async () => {
    vi.useFakeTimers()
    const source = new FakeEventSource()
    const connect = vi.fn(() => source)
    const read = vi.fn()
    const handlers = callbacks()
    const feed = startFrameFeed('one', { connect, read, ...handlers })
    source.frame(frame())
    source.readyState = 0
    source.emit('error')
    await vi.advanceTimersByTimeAsync(20_000)

    expect(handlers.onConnection).toHaveBeenLastCalledWith('reconnecting')
    expect(read).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledOnce()
    source.readyState = 1
    source.emit('open')
    source.frame(frame(22_000))
    expect(handlers.onConnection).toHaveBeenLastCalledWith('connected')
    expect(handlers.onFrame).toHaveBeenLastCalledWith(frame(22_000))
    feed.close()
  })

  it('ignores malformed events and captures belonging to a previous conversation', () => {
    const source = new FakeEventSource()
    const handlers = callbacks()
    const feed = startFrameFeed('two', { connect: () => source, read: vi.fn(), ...handlers })
    source.emit('frame', '{bad json')
    source.emit('frame', 'null')
    source.emit('frame', '{"ok":true,"watching":true,"state":{}}')
    source.frame(frame(1000, 'one'))
    expect(handlers.onFrame).not.toHaveBeenCalled()
    source.frame(frame(1200, 'two'))
    expect(handlers.onFrame).toHaveBeenCalledOnce()
    feed.close()
  })

  it('treats a closed watch as terminal and never reconnects or polls it', async () => {
    vi.useFakeTimers()
    const source = new FakeEventSource()
    const read = vi.fn()
    const handlers = callbacks()
    startFrameFeed('one', { connect: () => source, read, ...handlers })
    source.frame(frame())
    source.frame({ ok: true, watching: false })
    source.emit('error')
    source.frame(frame(2000))
    await vi.advanceTimersByTimeAsync(30_000)

    expect(handlers.onFrame).toHaveBeenCalledTimes(2)
    expect(handlers.onFrame).toHaveBeenLastCalledWith({ ok: true, watching: false })
    expect(handlers.onConnection).toHaveBeenLastCalledWith('closed')
    expect(source.closed).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes stream handlers on unmount and ignores even an already-queued event', () => {
    const source = new FakeEventSource()
    const handlers = callbacks()
    const feed = startFrameFeed('one', { connect: () => source, read: vi.fn(), ...handlers })
    const queuedFrame = [...source.listeners.get('frame')!][0]!
    const queuedError = [...source.listeners.get('error')!][0]!
    feed.close()
    feed.close()
    queuedFrame({ type: 'frame', data: JSON.stringify(frame()) })
    queuedError({ type: 'error' })
    expect(handlers.onFrame).not.toHaveBeenCalled()
    expect(handlers.onConnection.mock.calls).toEqual([['connecting']])
    expect([...source.listeners.values()].every((set) => set.size === 0)).toBe(true)
  })
})

describe('compatibility polling', () => {
  it('closes a terminal stream before falling back, with no concurrent requests', async () => {
    vi.useFakeTimers()
    const source = new FakeEventSource()
    let complete: (body: FrameResponse) => void = () => {}
    const read = vi.fn(() => {
      expect(source.closed).toBe(true)
      return new Promise<FrameResponse>((resolve) => { complete = resolve })
    })
    const handlers = callbacks()
    const feed = startFrameFeed('one', { connect: () => source, read, ...handlers })
    source.readyState = 2
    source.emit('error')
    expect(read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledOnce()

    complete(frame())
    await settle()
    await vi.advanceTimersByTimeAsync(249)
    expect(read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    feed.close()
  })

  it('falls back when EventSource is unsupported or cannot be constructed', async () => {
    vi.useFakeTimers()
    for (const connect of [undefined, () => { throw new Error('Unsupported') }]) {
      const handlers = callbacks()
      const read = vi.fn(async () => frame())
      const feed = startFrameFeed('one', { connect, read, ...handlers })
      await settle()
      expect(read).toHaveBeenCalledOnce()
      expect(handlers.onFrame).toHaveBeenCalledWith(frame())
      feed.close()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts an in-flight poll on navigation and ignores its late completion', async () => {
    vi.useFakeTimers()
    let complete: (body: FrameResponse) => void = () => {}
    const read = vi.fn((_sessionId: string, _signal: AbortSignal) =>
      new Promise<FrameResponse>((resolve) => { complete = resolve }))
    const handlers = callbacks()
    const feed = startFrameFeed('one', { read, ...handlers })
    const signal = read.mock.calls[0]![1]
    expect(signal.aborted).toBe(false)
    feed.close()
    expect(signal.aborted).toBe(true)
    complete(frame())
    await settle()
    expect(handlers.onFrame).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains the last capture through temporary failure and resumes on recovery', async () => {
    vi.useFakeTimers()
    const handlers = callbacks()
    const read = vi.fn()
      .mockResolvedValueOnce(frame())
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(frame(3000))
    const feed = startFrameFeed('one', { read, ...handlers })
    await settle()
    await vi.advanceTimersByTimeAsync(250)
    expect(handlers.onFrame.mock.calls).toEqual([[frame()]])
    expect(handlers.onConnection).toHaveBeenLastCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(handlers.onFrame).toHaveBeenLastCalledWith(frame(3000))
    expect(handlers.onConnection).toHaveBeenLastCalledWith('connected')
    feed.close()
  })

  it('ends polling when the host has closed the preview', async () => {
    vi.useFakeTimers()
    const handlers = callbacks()
    const read = vi.fn(async (): Promise<FrameResponse> => ({ ok: true, watching: false }))
    startFrameFeed('one', { read, ...handlers })
    await settle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledOnce()
    expect(handlers.onConnection).toHaveBeenLastCalledWith('closed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
