import { describe, expect, it } from 'vitest'
import { ActionBindings, BINDING_TTL_MS } from '../src/action-bindings.ts'

const stateTool = 'mcp__cua-driver-mcp__get_window_state'
const click = 'mcp__cua-driver-mcp__click'
const snapshot = (over: Record<string, unknown> = {}) => ({
  structuredContent: {
    pid: 42, window_id: 73, snapshot_id: 'opaque-snapshot',
    elements: [{ element_index: 0, element_token: 'opaque-token' }], ...over,
  },
})

describe('session-owned AX target bindings', () => {
  it('resolves a pid/token or snapshot/index against canonical metadata without changing driver arguments', () => {
    const bindings = new ActionBindings()
    bindings.record('s1', stateTool, snapshot())
    const args = Object.freeze({ pid: 42, element_token: 'opaque-token' })
    expect(bindings.resolve('s1', click, args)).toEqual({
      target: { pid: 42, windowId: 73 }, args: { ...args, window_id: 73 },
    })
    expect(args).not.toHaveProperty('window_id')
    expect(bindings.resolve('s1', click, { pid: 42, snapshot_id: 'opaque-snapshot', element_index: 0 }))
      .toMatchObject({ target: { pid: 42, windowId: 73 } })
  })

  it('does not borrow another session, provider, or pid binding', () => {
    const bindings = new ActionBindings()
    bindings.record('s1', stateTool, snapshot())
    const args = { pid: 42, element_token: 'opaque-token' }
    expect(bindings.resolve('s2', click, args).error).toContain('action_binding_missing')
    expect(bindings.resolve(undefined, click, args).error).toContain('action_binding_missing')
    expect(bindings.resolve('s1', 'cua_driver_native__click', args).error).toContain('action_binding_missing')
    expect(bindings.resolve('s1', click, { ...args, pid: 43 }).error).toContain('action_binding_missing')
  })

  it('never manufactures a pid or accepts text from the application as binding metadata', () => {
    const bindings = new ActionBindings()
    for (const value of [JSON.stringify(snapshot()), { content: [{ type: 'text', text: JSON.stringify(snapshot()) }] }]) {
      bindings.record('s1', stateTool, value)
    }
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'opaque-token' }).error).toContain('action_binding_missing')
    expect(bindings.resolve('s1', click, { element_token: 'opaque-token' }).target).toBeUndefined()
    expect(bindings.resolve('s1', click, { pid: 42, element_index: 0 }).target).toBeUndefined()
    expect(bindings.resolve('s1', click, { pid: 42, window_id: -1, element_token: 'opaque-token' }).target).toBeUndefined()
  })

  it('invalidates the prior window snapshot instead of retaining stale tokens', () => {
    const bindings = new ActionBindings()
    bindings.record('s1', stateTool, snapshot())
    bindings.record('s1', stateTool, snapshot({ snapshot_id: 'new', elements: [{ element_index: 1, element_token: 'new-token' }] }))
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'opaque-token' }).error).toContain('action_binding_missing')
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'new-token' }).target).toEqual({ pid: 42, windowId: 73 })
  })

  it.each([
    { isError: true }, { code: 'permission_denied' }, { status: 'refused' },
    { effect: 'failed' }, { success: false }, { error: 'failed' },
  ])('does not admit bindings from failed observations: %j', (failure) => {
    for (const envelopeFailure of [true, false]) {
      const bindings = new ActionBindings()
      bindings.record('s1', stateTool, snapshot())
      bindings.record('s1', stateTool, envelopeFailure ? { ...snapshot(), ...failure } : snapshot(failure))
      expect(bindings.resolve('s1', click, { pid: 42, element_token: 'opaque-token' }).error).toContain('action_binding_missing')
    }
  })

  it('rejects disagreement between token, index, and snapshot without rewriting it', () => {
    const bindings = new ActionBindings()
    bindings.record('s1', stateTool, snapshot())
    for (const conflicting of [{ element_index: 1 }, { snapshot_id: 'wrong' }]) {
      expect(bindings.resolve('s1', click, { pid: 42, element_token: 'opaque-token', ...conflicting }).error)
        .toContain('action_binding_conflict')
    }
  })

  it('bounds lifetime and clears the session without affecting another session', () => {
    let now = 0
    const bindings = new ActionBindings(() => now)
    bindings.record('s1', stateTool, snapshot())
    bindings.record('s2', stateTool, snapshot())
    const args = { pid: 42, element_token: 'opaque-token' }
    bindings.clear('s1')
    expect(bindings.resolve('s1', click, args).target).toBeUndefined()
    expect(bindings.resolve('s2', click, args).target).toBeDefined()
    now = BINDING_TTL_MS
    expect(bindings.resolve('s2', click, args).target).toBeUndefined()
    bindings.clear()
  })

  it('bounds window caches and ignores unrelated tools', () => {
    const bindings = new ActionBindings()
    bindings.record('s1', 'arbitrary-cua-driver__get_window_state', snapshot())
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'opaque-token' }).target).toBeUndefined()
    for (let window_id = 1; window_id <= 17; window_id++) {
      bindings.record('s1', stateTool, snapshot({ window_id, elements: [{ element_index: 0, element_token: `token-${window_id}` }] }))
    }
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'token-1' }).target).toBeUndefined()
    expect(bindings.resolve('s1', click, { pid: 42, element_token: 'token-17' }).target).toEqual({ pid: 42, windowId: 17 })
    expect(bindings.resolve('s1', 'unrelated_tool', { pid: 42, element_token: 'token-17' }).target).toBeUndefined()
  })
})
