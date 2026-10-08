import { describe, expect, it, vi } from 'vitest'
import { WindowDriver, type WindowExecution } from '../src/window-driver.ts'

const stateTool = 'mcp__cua-driver-mcp__get_window_state'
function harness(names = [stateTool, stateTool.replace('get_window_state', 'click')]) {
  const exec = {
    token: Symbol('outer'), callId: 'outer', rootCallId: 'root', agent: { session: { id: 's1' } },
    signal: new AbortController().signal, deferContext: vi.fn(), concludeTurn: vi.fn(),
  } as unknown as WindowExecution
  const execute = vi.fn(async (_call) => ({ isError: false, content: [], value: { structuredContent: { effect: 'confirmed' } } }))
  const tools = {
    schemas: vi.fn(() => names.map((name) => ({ name }))),
    get: vi.fn((name: string) => names.includes(name) ? { name } : undefined), execute,
  }
  const driver = new WindowDriver(tools as unknown as ConstructorParameters<typeof WindowDriver>[0])
  return { exec, driver, tools, execute }
}

describe('bound window nested-dispatch adapter', () => {
  it('selects only a visible, unambiguous Cua provider in the calling agent scope', () => {
    const h = harness()
    expect(h.driver.select(h.exec)).toBe(stateTool)
    expect(h.tools.schemas).toHaveBeenCalledWith(h.exec.agent)
    expect(h.driver.name(stateTool, 'click', h.exec)).toBe(stateTool.replace('get_window_state', 'click'))
    expect(() => h.driver.name(stateTool, 'drag', h.exec)).toThrow('window_action_unavailable')
    expect(() => harness([]).driver.select(h.exec)).toThrow('window_provider_unavailable')
    expect(() => harness([stateTool, 'cua_driver_native__get_window_state']).driver.select(h.exec)).toThrow('exactly one')
  })

  it('authenticates a one-call permit by opaque parent, session, name, id and exact arguments', async () => {
    const h = harness(), validate = vi.fn(async () => {})
    let captured: Parameters<WindowDriver['permitted']>[0] | undefined
    h.execute.mockImplementation(async (call) => {
      captured = call
      expect(h.driver.permitted(call)).toBe(true)
      for (const changes of [
        { parent: Symbol('forged') }, { callId: 'invented' }, { name: stateTool },
        { agent: { session: { id: 's2' } } }, { arguments: { pid: 99, window_id: 73 } },
      ]) expect(h.driver.permitted({ ...call, ...changes })).toBe(false)
      await h.driver.validate(call)
      expect(call).toMatchObject({ rootCallId: 'root', parent: h.exec.token, signal: h.exec.signal, agent: h.exec.agent })
      return { isError: false, content: [], value: { structuredContent: { effect: 'confirmed' } } }
    })
    await h.driver.call(stateTool.replace('get_window_state', 'click'), { pid: 42, window_id: 73 }, h.exec, validate)
    expect(validate).toHaveBeenCalledOnce()
    expect(h.driver.permitted(captured!)).toBe(false)
    await expect(h.driver.validate(captured!)).rejects.toThrow('window_batch_permit_invalid')
  })

  it('never grants a mutation permit to ordinary observation calls', async () => {
    const h = harness()
    h.execute.mockImplementation(async (call) => {
      expect(h.driver.permitted(call)).toBe(false)
      return { isError: false, content: [], value: { structuredContent: { effect: 'confirmed' } } }
    })
    await h.driver.call(stateTool, { pid: 42, window_id: 73 }, h.exec)
  })

  it('removes permits when approval/pipeline execution fails, without calling the tool directly', async () => {
    const h = harness()
    let captured: Parameters<WindowDriver['permitted']>[0] | undefined
    h.execute.mockImplementation(async (call) => { captured = call; throw new Error('policy denied') })
    await expect(h.driver.call(stateTool.replace('get_window_state', 'click'), {}, h.exec, async () => {})).rejects.toThrow('policy denied')
    expect(h.execute).toHaveBeenCalledOnce()
    expect(h.driver.permitted(captured!)).toBe(false)
  })

  it('forwards accepted pipeline contexts and conclusion without losing root ownership', async () => {
    const h = harness()
    const context = { id: 'notice', role: 'user', content: [], source: { kind: 'plugin', plugin: 'test' } }
    h.execute.mockResolvedValue({
      isError: false, content: [], value: { structuredContent: { effect: 'confirmed' } },
      additionalContexts: [context], concludesTurn: true,
    })
    await h.driver.call(stateTool, {}, h.exec)
    expect(h.exec.deferContext).toHaveBeenCalledWith(context)
    expect(h.exec.concludeTurn).toHaveBeenCalledOnce()
  })
})
