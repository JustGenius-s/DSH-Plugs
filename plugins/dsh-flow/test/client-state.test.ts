import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createFlowStateStore } from '../src/client/state.ts'
import type { FlowStateResponse } from '../src/shared.ts'

const OFF: FlowStateResponse = {
  plan: null, mode: false, modePending: null, degraded: false, degradedReason: null,
}
const ON: FlowStateResponse = { ...OFF, mode: true }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

test('chip and sidebar share one poller until the last subscriber leaves', async () => {
  const read = vi.fn(async () => ON)
  const store = createFlowStateStore({ read, write: async () => {} })
  const leaveChip = store.subscribe('a', () => {})
  const leaveTab = store.subscribe('a', () => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(1)
  expect(store.getSnapshot('a').mode).toBe(true)
  leaveTab()
  await vi.advanceTimersByTimeAsync(1200)
  expect(read).toHaveBeenCalledTimes(2)
  leaveChip()
  await vi.advanceTimersByTimeAsync(2400)
  expect(read).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

test('mode changes invalidate older polls and publish the next-step target to both surfaces', async () => {
  const stale = deferred<FlowStateResponse>()
  const read = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue({ ...ON, modePending: true })
  const write = vi.fn(async () => {})
  const store = createFlowStateStore({ read, write })
  const leave = store.subscribe('a', () => {})
  await store.setMode('a', true)
  stale.resolve(OFF)
  await vi.advanceTimersByTimeAsync(0)
  expect(write).toHaveBeenCalledWith('a', true)
  expect(store.getSnapshot('a')).toMatchObject({ mode: true, modePending: true, changing: false })
  leave()
})

test('a typed command refresh discards an older poll and updates the subscribed chip', async () => {
  const stale = deferred<FlowStateResponse>()
  const read = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(ON)
  const store = createFlowStateStore({ read, write: async () => {} })
  const leave = store.subscribe('a', () => {})
  await store.refresh('a')
  stale.resolve(OFF)
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getSnapshot('a').mode).toBe(true)
  leave()
})

test('a successful typed command clears a previous mode-change error', async () => {
  const read = vi.fn().mockResolvedValue(OFF)
  const store = createFlowStateStore({ read, write: async () => { throw new Error('offline') } })
  const leave = store.subscribe('a', () => {})
  await store.setMode('a', true)
  expect(store.getSnapshot('a').error).toBe('offline')
  read.mockResolvedValue(ON)
  await store.refresh('a')
  expect(store.getSnapshot('a')).toMatchObject({ mode: true, error: null })
  leave()
})

test('failed exits retain the active chip, expose the error, and allow a retry', async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const read = vi.fn().mockResolvedValueOnce(ON).mockResolvedValue(OFF)
  const store = createFlowStateStore({ read, write })
  const leave = store.subscribe('a', () => {})
  await vi.advanceTimersByTimeAsync(0)
  await store.setMode('a', false)
  expect(store.getSnapshot('a')).toMatchObject({ mode: true, changing: false, error: 'offline' })
  await store.setMode('a', false)
  expect(store.getSnapshot('a')).toMatchObject({ mode: false, changing: false, error: null })
  leave()
})

test('switching sessions cannot carry a chip or a late response into the next session', async () => {
  const stale = deferred<FlowStateResponse>()
  const read = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(OFF)
  const store = createFlowStateStore({ read, write: async () => {} })
  const leaveA = store.subscribe('a', () => {})
  leaveA()
  const leaveB = store.subscribe('b', () => {})
  stale.resolve(ON)
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getSnapshot('b').mode).toBe(false)
  const leaveAAgain = store.subscribe('a', () => {})
  expect(store.getSnapshot('a').mode).toBe(false)
  await vi.advanceTimersByTimeAsync(0)
  leaveB()
  leaveAAgain()
})

test('duplicate clicks do not send concurrent mutations', async () => {
  const pending = deferred<void>()
  const write = vi.fn(() => pending.promise)
  const store = createFlowStateStore({ read: async () => ON, write })
  const leave = store.subscribe('a', () => {})
  const first = store.setMode('a', true)
  await store.setMode('a', true)
  expect(write).toHaveBeenCalledTimes(1)
  expect(store.getSnapshot('a').changing).toBe(true)
  pending.resolve()
  await first
  expect(store.getSnapshot('a').changing).toBe(false)
  leave()
})

test('slow polls are allowed to finish and failed polls preserve the last state', async () => {
  const pending = deferred<FlowStateResponse>()
  const read = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValue(new Error('offline'))
  const store = createFlowStateStore({ read, write: async () => {} })
  const leave = store.subscribe('a', () => {})
  await vi.advanceTimersByTimeAsync(3600)
  expect(read).toHaveBeenCalledTimes(1)
  pending.resolve(ON)
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getSnapshot('a').mode).toBe(true)
  await vi.advanceTimersByTimeAsync(1200)
  expect(read).toHaveBeenCalledTimes(2)
  expect(store.getSnapshot('a').mode).toBe(true)
  leave()
})
