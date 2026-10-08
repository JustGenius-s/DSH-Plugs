import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@just-genius/dsh-plugin-runtime/host'
import { PipController } from '../src/controller.ts'
import { WatcherRegistry } from '../src/watcher.ts'
import { WindowSessions, type WindowSessionOptions } from '../src/window-session.ts'
import type { WindowExecution } from '../src/window-driver.ts'
import type { CuaWindow } from '../src/shared/types.ts'

const stateTool = 'mcp__cua-driver-mcp__get_window_state'
const controllers: PipController[] = []
function harness() {
  const target = { pid: 42, windowId: 73 }
  const windows: CuaWindow[] = [{
    ...target, appName: 'Test', title: 'Test', isOnScreen: true, bounds: { x: 100, y: 200, width: 800, height: 600 },
  }]
  let sequence = 0, snapshotId = 0
  const registry = new WatcherRegistry({
    fps: 30, backgroundFps: 30, maxDimension: 1024, maxWatchers: 3, idleTtlMs: 45_000,
    listWindows: async () => windows,
    capture: async () => ({
      mime: 'image/jpeg', base64: 'data', width: 400, height: 300, appName: 'Test', windowTitle: 'Test',
      frameId: `stream:${++sequence}`, imageHash: 'same-pixels', capturedAt: Date.now(), windowBounds: { ...windows[0]!.bounds },
    }),
  })
  const controller = new PipController({ registry, listWindows: async () => windows, openApplication: async () => windows[0]! })
  controllers.push(controller)
  const contexts: UserMessage[] = []
  const exec = {
    agent: { session: { id: 's1' } }, token: Symbol('outer'), callId: 'outer', rootCallId: 'outer',
    signal: new AbortController().signal, deferContext: (message: UserMessage) => { contexts.push(message) }, concludeTurn: vi.fn(),
  } as unknown as WindowExecution
  const output = vi.fn(async () => ({
    isError: false as const, content: [],
    value: { structuredContent: { effect: 'confirmed', path: 'ax' } },
  }))
  const call: WindowSessionOptions['driver']['call'] = vi.fn(async (name, _args, execution, validate) => {
    await validate?.()
    execution.signal.throwIfAborted()
    if (name !== stateTool) return output()
    return {
      isError: false, content: [], value: { structuredContent: {
        pid: 42, window_id: 73, snapshot_id: `snap-${++snapshotId}`,
        elements: [
          { element_index: 0, element_token: `button-${snapshotId}`, role: 'AXButton', label: 'Run',
            actions: ['AXPress'], frame: { x: 120, y: 220, w: 80, h: 40 } },
          { element_index: 1, element_token: `field-${snapshotId}`, role: 'AXTextField', label: 'Name', value: 'old',
            frame: { x: 120, y: 320, w: 300, h: 40 } },
        ],
        background_input: { exact_window: { pid: 42, window_id: 73 }, routes: [
          { route: 'accessibility', status: 'available' }, { route: 'pid_keyboard', status: 'available' },
        ] },
      } },
    }
  })
  const saveImage = vi.fn(async (_frame, metadata) => ({
    id: `image-message-${contexts.length}`, role: 'user',
    content: [
      { type: 'text', text: metadata }, { type: 'image', attachment: { attachmentId: `image-${contexts.length}` } },
    ], source: { kind: 'plugin', plugin: 'dsh-cua-pip' },
  } as UserMessage))
  const sessions = new WindowSessions({
    controller, registry, listWindows: async () => windows, saveImage,
    driver: { select: () => stateTool, name: (_state, operation) => stateTool.replace('get_window_state', operation), call },
  })
  const ready = async () => {
    const bound = await sessions.bind(target, exec)
    await vi.advanceTimersByTimeAsync(40)
    const observed = await sessions.observe(bound.targetId!, exec)
    controller.monitor.deliver('s1', contexts)
    return { targetId: bound.targetId!, observationId: observed.observation!.observationId }
  }
  const settle = async <T>(promise: Promise<T>) => {
    await vi.advanceTimersByTimeAsync(80)
    return promise
  }
  return { sessions, controller, registry, windows, call, output, contexts, exec, saveImage, ready, settle, target }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000) })
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers() })

describe('window-scoped observation and action batches', () => {
  it('delivers matching AX and PiP metadata in the immutable image context, not another driver screenshot', async () => {
    const h = harness(), bound = await h.sessions.bind(h.target, h.exec)
    await vi.advanceTimersByTimeAsync(40)
    const state = await h.sessions.observe(bound.targetId!, h.exec)
    expect(state).toMatchObject({
      status: 'queued', targetId: bound.targetId, capabilities: { visualClick: 'ax-hit-test-only', rawPointer: 'unavailable' },
    })
    expect(h.call).toHaveBeenCalledWith(stateTool, {
      pid: 42, window_id: 73, include_screenshot: false, include_accessibility_tree: true,
    }, h.exec)
    const metadata = JSON.parse(h.contexts[0]!.content[0]!.type === 'text' ? h.contexts[0]!.content[0]!.text : '')
    expect(metadata).toMatchObject({ targetId: bound.targetId, observationId: state.observation!.observationId, ax: { snapshotId: 'snap-1' } })
    expect(metadata.ax.elements[0]).not.toHaveProperty('token')
    await expect(h.sessions.act(bound.targetId!, state.observation!.observationId,
      [{ kind: 'click', x: 20, y: 20 }], h.exec)).rejects.toThrow('window_observation_required')
    expect(h.output).not.toHaveBeenCalled()
  })

  it('executes a visual click only via the matching canonical AX binding and automatically observes the result', async () => {
    const h = harness(), ids = await h.ready()
    const state = await h.settle(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', x: 20, y: 20 }], h.exec))
    expect(h.output).toHaveBeenCalledOnce()
    expect(h.call).toHaveBeenCalledWith('mcp__cua-driver-mcp__click', expect.objectContaining({
      pid: 42, window_id: 73, element_token: 'button-1', snapshot_id: 'snap-1', element_index: 0, delivery_mode: 'background',
    }), h.exec, expect.any(Function))
    const input = vi.mocked(h.call).mock.calls.find(([name]) => name.endsWith('__click'))![1]
    expect(input).not.toHaveProperty('x')
    expect(input).not.toHaveProperty('y')
    expect(state.status).toBe('queued')
    expect(state.observation?.observationId).not.toBe(ids.observationId)
    expect(h.contexts).toHaveLength(2)
    await expect(h.sessions.act(ids.targetId, state.observation!.observationId,
      [{ kind: 'click', elementIndex: 0 }], h.exec)).rejects.toThrow('window_observation_required')
  })

  it('allows deterministic writes followed by one final click, retaining one observation barrier', async () => {
    const h = harness(), ids = await h.ready()
    const state = await h.settle(h.sessions.act(ids.targetId, ids.observationId, [
      { kind: 'set_value', elementIndex: 1, text: 'new' }, { kind: 'click', elementIndex: 0 },
    ], h.exec))
    expect(h.output).toHaveBeenCalledTimes(2)
    expect(state.batch?.results.map((item) => item.operation)).toEqual(['set_value', 'click'])
    expect(state.batch?.stoppedReason).toBeNull()
  })

  it('stops at an unverified intermediate result, reports partial progress and never retries', async () => {
    const h = harness(), ids = await h.ready()
    h.output.mockResolvedValueOnce({ isError: false, content: [], value: { structuredContent: { effect: 'unverifiable', path: 'ax' } } })
    const state = await h.settle(h.sessions.act(ids.targetId, ids.observationId, [
      { kind: 'type_text', elementIndex: 1, text: 'new' }, { kind: 'press_key', elementIndex: 1, key: 'Return' },
    ], h.exec))
    expect(h.output).toHaveBeenCalledOnce()
    expect(state.batch).toMatchObject({ requestedSteps: 2, stoppedReason: 'step_unknown', results: [{ outcome: 'unknown' }] })
    expect(state.observation).not.toBeNull()
  })

  it('stops on an unexpected internal driver delivery path without claiming rollback', async () => {
    const h = harness(), ids = await h.ready()
    h.output.mockResolvedValueOnce({ isError: false, content: [], value: { structuredContent: { effect: 'confirmed', path: 'cgevent' } } })
    const state = await h.settle(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
    expect(state.batch).toMatchObject({ stoppedReason: 'unexpected_driver_backend', results: [{ outcome: 'unknown', backend: 'cgevent' }] })
    expect(h.output).toHaveBeenCalledOnce()
  })

  it('validates all steps before input, refuses undeclared pixel fallback and invalid handles', async () => {
    const h = harness(), ids = await h.ready()
    for (const steps of [
      [{ kind: 'set_value' as const, elementIndex: 1, text: 'ok' }, { kind: 'click' as const, x: 390, y: 290 }],
      [{ kind: 'click' as const, elementIndex: 0 }, { kind: 'click' as const, elementIndex: 0 }],
    ]) await expect(h.sessions.act(ids.targetId, ids.observationId, steps, h.exec)).rejects.toThrow()
    await expect(h.sessions.observe(ids.targetId, {
      ...h.exec, agent: { session: { id: 's2' } },
    } as WindowExecution)).rejects.toThrow('binding_stale')
    await expect(h.sessions.act(ids.targetId, 'invented', [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('observation_required')
    expect(h.output).not.toHaveBeenCalled()
  })

  it('rejects moved windows and invalidates bindings across close/reopen or capture restart', async () => {
    const h = harness(), ids = await h.ready()
    h.windows[0]!.bounds.x += 10
    await expect(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('geometry_changed')
    h.registry.refresh('s1')
    await vi.advanceTimersByTimeAsync(40)
    await expect(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('observation_required')
    h.controller.close('s1')
    await h.controller.open('s1', h.target)
    await expect(h.sessions.observe(ids.targetId, h.exec)).rejects.toThrow('binding_stale')
    expect(h.output).not.toHaveBeenCalled()
  })

  it('invalidates old AX snapshots on a separate read, and other sessions input cannot leave stale bindings usable', async () => {
    const h = harness(), ids = await h.ready()
    h.sessions.noteSnapshot('s2', stateTool, { pid: 42, window_id: 73 })
    await expect(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('observation_required')
    const observed = await h.sessions.observe(ids.targetId, h.exec)
    h.controller.monitor.deliver('s1', h.contexts)
    h.sessions.noteInput('s2', 'mcp__cua-driver-mcp__click', { pid: 42, window_id: 73 })
    await expect(h.sessions.act(ids.targetId, observed.observation!.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('observation_required')
    expect(h.output).not.toHaveBeenCalled()
  })

  it('retains a target across turns, but not the previous observation or desktop mode', async () => {
    const h = harness(), ids = await h.ready()
    h.sessions.endTurn('s1')
    expect(h.sessions.status('s1')).toMatchObject({ targetId: ids.targetId, status: 'needs_observation' })
    const observed = await h.sessions.observe(ids.targetId, h.exec)
    h.controller.monitor.deliver('s1', h.contexts)
    await h.controller.setControlMode('s1', { controlMode: 'desktop', ...h.target, reason: 'explicit test fallback' })
    await expect(h.sessions.act(ids.targetId, observed.observation!.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('window_background_only')
  })

  it('does not admit a saved image after the user closes its binding', async () => {
    const h = harness(), bound = await h.sessions.bind(h.target, h.exec)
    await vi.advanceTimersByTimeAsync(40)
    h.saveImage.mockImplementationOnce(async () => {
      h.controller.close('s1')
      return { id: 'late', content: [] } as unknown as UserMessage
    })
    await expect(h.sessions.observe(bound.targetId!, h.exec)).rejects.toThrow('binding_stale')
    expect(h.contexts).toHaveLength(0)
  })

  it('rejects a superseded AX snapshot even when it changes during image persistence', async () => {
    const h = harness(), ids = await h.ready()
    const save = h.saveImage.getMockImplementation()!
    h.saveImage.mockImplementationOnce(async (frame, metadata) => {
      const message = await save(frame, metadata)
      h.sessions.noteSnapshot('s2', stateTool, { pid: 42, window_id: 73 })
      return message
    })
    await expect(h.sessions.observe(ids.targetId, h.exec)).rejects.toThrow('AX changed')
    expect(h.contexts).toHaveLength(1)
  })

  it('rechecks freshness after slow approval and releases the batch lock on refusal', async () => {
    const h = harness(), ids = await h.ready()
    vi.mocked(h.call).mockImplementationOnce(async (_name, _args, _exec, validate) => {
      await vi.advanceTimersByTimeAsync(31_000)
      await validate?.()
      return h.output()
    })
    await expect(h.sessions.act(ids.targetId, ids.observationId, [{ kind: 'click', elementIndex: 0 }], h.exec))
      .rejects.toThrow('window_batch_superseded')
    expect(h.output).not.toHaveBeenCalled()
    expect(h.sessions.refusal('s2', 'mcp__cua-driver-mcp__click', { pid: 42, window_id: 73 })).toBeUndefined()
  })

  it('keeps completed step evidence when the geometry changes midway through a batch', async () => {
    const h = harness(), ids = await h.ready()
    h.output.mockImplementationOnce(async () => {
      h.windows[0]!.bounds.x += 20
      return { isError: false, content: [], value: { structuredContent: { effect: 'confirmed', path: 'ax' } } }
    })
    await expect(h.sessions.act(ids.targetId, ids.observationId, [
      { kind: 'set_value', elementIndex: 1, text: 'a' }, { kind: 'click', elementIndex: 0 },
    ], h.exec)).rejects.toThrow('geometry_changed')
    expect(h.output).toHaveBeenCalledOnce()
    expect(h.sessions.status('s1').batch).toMatchObject({
      results: [{ operation: 'set_value', outcome: 'confirmed' }], stoppedReason: expect.stringContaining('geometry_changed'),
    })
  })

  it('delivers a read-only image with real route refusals when native capture works but AX is unavailable', async () => {
    const h = harness(), ids = await h.ready()
    vi.mocked(h.call).mockResolvedValueOnce({
      isError: false, content: [], value: { structuredContent: {
        pid: 42, window_id: 73, elements: [],
        background_input: {
          exact_window: { pid: 42, window_id: 73, status: 'ax_unresolved' },
          routes: [{ route: 'accessibility', status: 'refused', reason: 'off_space_or_ax_unresolved' }],
        },
      } },
    })
    const observed = await h.sessions.observe(ids.targetId, h.exec)
    h.controller.monitor.deliver('s1', h.contexts)
    expect(h.sessions.status('s1')).toMatchObject({
      status: 'observed_read_only', observation: { snapshotId: null },
      capabilities: { ax: 'refused', visualClick: 'unavailable', routeReasons: { accessibility: 'off_space_or_ax_unresolved' } },
    })
    await expect(h.sessions.act(ids.targetId, observed.observation!.observationId, [{ kind: 'click', x: 20, y: 20 }], h.exec))
      .rejects.toThrow('off_space_or_ax_unresolved')
    expect(h.output).not.toHaveBeenCalled()
  })

  it('retains labelled partial-step evidence after the preview closes, without keeping its action rights', async () => {
    const h = harness(), ids = await h.ready()
    h.output.mockImplementationOnce(async () => {
      h.controller.close('s1')
      return { isError: false, content: [], value: { structuredContent: { effect: 'confirmed', path: 'ax' } } }
    })
    await expect(h.sessions.act(ids.targetId, ids.observationId, [
      { kind: 'set_value', elementIndex: 1, text: 'a' }, { kind: 'click', elementIndex: 0 },
    ], h.exec)).rejects.toThrow('binding_stale')
    expect(h.sessions.status('s1')).toMatchObject({
      status: 'unbound', targetId: null, observation: null,
      batch: { targetId: ids.targetId, target: h.target, results: [{ operation: 'set_value' }] },
    })
    expect(h.output).toHaveBeenCalledOnce()
  })
})
