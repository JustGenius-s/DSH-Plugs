import { expect, test } from 'vitest'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { FlowOrchestrator } from '../src/orchestrator.ts'
import { CHILD_EXPAND_HINT, CHILD_REPORT_HINT, IDLE_HINT, LEADER_POLICY } from '../src/policy.ts'
import { createFlowTools } from '../src/tools.ts'

const orchestrator = new FlowOrchestrator({} as Context, undefined)
const tools = createFlowTools({
  orchestrator,
  parentOf: exec => exec.agent,
  isEnabled: () => true,
})

test('actual Flow tool definitions use unique provider-safe names', () => {
  const names = tools.map(tool => tool.name)
  expect(names).toEqual([
    'flow_plan', 'flow_status', 'flow_next', 'flow_expand',
    'flow_confirm', 'flow_report', 'flow_patch', 'flow_clear',
  ])
  expect(new Set(names).size).toBe(names.length)
  for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
})

test('Leader and child instructions reference registered tools', () => {
  const names = new Set(tools.map(tool => tool.name))
  const instructions = [
    LEADER_POLICY, IDLE_HINT, CHILD_EXPAND_HINT, CHILD_REPORT_HINT,
    ...tools.map(tool => tool.description),
    orchestrator.report(), orchestrator.advance(),
  ].join('\n')
  expect(instructions).not.toMatch(/\bflow\./)
  const references = [...instructions.matchAll(/\bflow_[a-z]+\b/g)].map(match => match[0])
  expect(references.length).toBeGreaterThan(0)
  for (const reference of references) expect(names.has(reference)).toBe(true)
})
