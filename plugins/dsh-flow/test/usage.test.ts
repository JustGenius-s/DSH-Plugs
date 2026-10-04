import { expect, test } from 'vitest'
import type { Agent, Context } from '@just-genius/dsh-plugin-runtime/host'
import { FlowOrchestrator } from '../src/orchestrator.ts'
import { tokenUsageOf } from '../src/usage.ts'

const sample = (turn: number, step: number, usage: Record<string, number>) => ({
  type: 'assistant/message', data: { turn, step, usage },
})

test('token accounting replaces a streaming sample with the final sample for the same step', () => {
  expect(tokenUsageOf([
    { type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 80, outputTokens: 5 } } } },
    sample(1, 0, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 30, cacheWriteTokens: 20 }),
    sample(1, 1, { inputTokens: 40, outputTokens: 6 }),
  ])).toEqual({
    uncachedInputTokens: 140,
    cacheReadTokens: 30,
    cacheWriteTokens: 20,
    outputTokens: 16,
  })
  expect(tokenUsageOf([{ type: 'assistant/message', data: { turn: 1, step: 0 } }])).toBeNull()
})

test('child run exposes live usage and freezes time and usage on settlement', async () => {
  const events: unknown[] = []
  let finish!: (result: { stopReason: string; output: { type: string; text: string }[] }) => void
  const result = new Promise<{ stopReason: string; output: { type: string; text: string }[] }>(resolve => { finish = resolve })
  const orchestrator = new FlowOrchestrator({ get: () => undefined } as unknown as Context, {
    start: async () => ({ id: 'child-1', localAgent: { session: { snapshotEvents: () => events } }, result, dispose: async () => {} }),
  })
  const parent = { id: 'leader', session: { id: 'parent' } } as Agent
  orchestrator.setPlan({ title: 'Test', nodes: [{ id: 'a', title: 'A', prompt: 'Work', deps: [] }] }, parent)
  await Promise.resolve()
  events.push(sample(1, 0, { inputTokens: 7, outputTokens: 3 }))
  expect(orchestrator.view()!.nodes[0]!.usage).toEqual({
    uncachedInputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 3,
  })
  const startedAt = orchestrator.view()!.nodes[0]!.startedAt
  expect(startedAt).not.toBeNull()
  finish({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] })
  await Promise.resolve()
  await Promise.resolve()
  const settled = orchestrator.view()!.nodes[0]!
  expect(settled.status).toBe('done')
  expect(Date.parse(settled.endedAt!)).toBeGreaterThanOrEqual(Date.parse(startedAt!))
  expect(settled.usage?.outputTokens).toBe(3)
  events.push(sample(1, 1, { inputTokens: 100, outputTokens: 100 }))
  expect(orchestrator.view()!.nodes[0]!.usage?.outputTokens).toBe(3)
  orchestrator.applyAction({ kind: 'clear' })
})

test('cancelling a child keeps its recorded cost when the old result settles later', async () => {
  const events: unknown[] = [sample(1, 0, { inputTokens: 11, outputTokens: 4 })]
  let finish!: (result: { stopReason: string; output: { type: string; text: string }[] }) => void
  const result = new Promise<{ stopReason: string; output: { type: string; text: string }[] }>(resolve => { finish = resolve })
  const orchestrator = new FlowOrchestrator({ get: () => undefined } as unknown as Context, {
    start: async () => ({ id: 'child-1', localAgent: { session: { events } }, result, dispose: async () => {} }),
  })
  const parent = { id: 'leader', session: { id: 'parent' } } as Agent
  orchestrator.setPlan({ title: 'Test', nodes: [{ id: 'a', title: 'A', prompt: 'Work', deps: [] }] }, parent)
  await Promise.resolve()
  expect(orchestrator.applyAction({ kind: 'cancel', nodeId: 'a' }).ok).toBe(true)
  const cancelled = orchestrator.view()!.nodes[0]!
  expect(cancelled.status).toBe('failed')
  expect(cancelled.endedAt).not.toBeNull()
  expect(cancelled.usage?.outputTokens).toBe(4)
  finish({ stopReason: 'completed', output: [{ type: 'text', text: 'late result' }] })
  await Promise.resolve()
  await Promise.resolve()
  expect(orchestrator.view()!.nodes[0]!).toMatchObject({
    status: 'failed', endedAt: cancelled.endedAt, usage: cancelled.usage,
  })
  orchestrator.applyAction({ kind: 'clear' })
})
