import { afterEach, expect, test, vi } from 'vitest'
import type { Agent, Context } from '@just-genius/dsh-plugin-runtime/host'
import { FlowOrchestrator } from '../src/orchestrator.ts'
import { createFlowTools } from '../src/tools.ts'

afterEach(() => vi.restoreAllMocks())

function setup(running: boolean) {
  const orchestrator = new FlowOrchestrator({} as Context, undefined)
  vi.spyOn(orchestrator, 'runningNodeFor').mockReturnValue(running ? { spec: { id: 'parent' } } as never : null)
  const expand = vi.spyOn(orchestrator, 'expand').mockReturnValue('Expanded')
  const agent = { id: 'agent-1', session: { id: 'session-1' } } as Agent
  const tool = createFlowTools({ orchestrator, parentOf: () => agent, isEnabled: () => !running })
    .find(tool => tool.name === 'flow_expand')!
  return { expand, run: (args: Record<string, unknown>) => tool.execute(args, {} as never) }
}

test('the Leader cannot expand a node directly even when Flow mode is on', async () => {
  const { expand, run } = setup(false)
  expect(await run({ parentId: 'parent', nodes: [] })).toContain('for the child')
  expect(expand).not.toHaveBeenCalled()
})

test('a running child can expand its own node without enabling Leader mode', async () => {
  const { expand, run } = setup(true)
  const nodes = [{ id: 'step-1', title: 'Investigate', prompt: 'Read the relevant material.', deps: [] }]
  expect(await run({ nodes })).toBe('Expanded')
  expect(expand).toHaveBeenCalledWith('parent', nodes)
  expand.mockClear()
  expect(await run({ parentId: 'another-node', nodes })).toContain('only expand its own node')
  expect(expand).not.toHaveBeenCalled()
})
