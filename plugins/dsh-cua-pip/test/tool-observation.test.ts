import { describe, expect, it } from 'vitest'
import { readToolObservation, targetHint } from '../src/shared/tool-observation.ts'

describe('tool observation', () => {
  it('reads Code Mode starts and successful results without a top-level turn', () => {
    const data = { name: 'mcp__cua-driver-mcp__launch_app', arguments: { name: 'Clock' }, subCallId: 'root:code:1' }
    expect(readToolObservation({ type: 'tool/code-dispatch-start', data }))
      .toMatchObject({ phase: 'call', name: data.name, arguments: data.arguments, callId: data.subCallId })
    expect(readToolObservation({ type: 'tool/code-dispatch', data: { ...data, content: [], isError: true } }))
      .toMatchObject({ phase: 'result', callId: data.subCallId, result: [], failed: true })
  })

  it('correlates native tool results through the durable tool-result message', () => {
    const content = [{ type: 'text', text: '{"pid":42,"window_id":5}' }]
    const event = {
      type: 'tool/result',
      data: {
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', content }],
        },
      },
    }
    expect(readToolObservation(event)).toEqual({ phase: 'result', callId: 'call-1', result: content, failed: false })
    expect(readToolObservation({ ...event, data: { ...event.data, error: { code: 'DENIED' } } })?.failed).toBe(true)
    expect(readToolObservation({ type: 'assistant/message', data: {} })).toBeUndefined()
  })
})

describe('target metadata', () => {
  it('understands normal, nested and MCP text metadata', () => {
    expect(targetHint({ pid: 8, window_id: 9 })).toEqual({ target: { pid: 8, windowId: 9 }, pid: 8 })
    expect(targetHint({ target: { pid: 8, window_id: 9 } })).toEqual({ target: { pid: 8, windowId: 9 }, pid: 8 })
    expect(targetHint({ content: [{ type: 'text', text: '{"pid":8}' }] })).toEqual({ pid: 8 })
    expect(targetHint({ structuredContent: { pid: 8 } })).toEqual({ pid: 8 })
    expect(targetHint({ code: 'launched', launch_state: 'window_ready', pid: 8 })).toEqual({ pid: 8 })
  })

  it('never chooses an arbitrary window out of an app/window listing or AX tree', () => {
    expect(targetHint({ windows: [{ pid: 100, window_id: 200 }] })).toBeUndefined()
    expect(targetHint({ apps: [{ pid: 100 }] })).toBeUndefined()
    expect(targetHint({ accessibility_tree: { pid: 100, window_id: 200 } })).toBeUndefined()
    expect(targetHint({ type: 'image', data: '{"pid":100}' })).toBeUndefined()
    expect(targetHint('malformed')).toBeUndefined()
  })

  it('rejects refused and error results and bounds recursion', () => {
    expect(targetHint({ isError: true, pid: 10 })).toBeUndefined()
    expect(targetHint({ effect: 'refused', pid: 10 })).toBeUndefined()
    expect(targetHint({ code: 'denied', pid: 10 })).toBeUndefined()
    const circular: Record<string, unknown> = {}
    circular.content = circular
    expect(targetHint(circular)).toBeUndefined()
  })
})
