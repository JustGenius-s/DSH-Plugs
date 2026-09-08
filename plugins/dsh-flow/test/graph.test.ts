import { expect, test } from 'vitest'

import {
  depthOf,
  findCycle,
  readyIds,
  subtreeSettled,
  validatePlan,
  waitingForConfirm,
} from '../lib/graph.js'
import type { ValidatedPlan } from '../lib/graph.js'

type NodeStatus = ReturnType<Parameters<typeof readyIds>[1]>
type FlowPlanView = Parameters<typeof waitingForConfirm>[0]

const node = (id: string, deps: string[] = []) => ({
  id,
  title: id,
  prompt: `do ${id}`,
  deps,
})

function rejectionOf(result: ValidatedPlan) {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a rejected plan')
  return result.rejection
}

test('validatePlan accepts a diamond', () => {
  const result = validatePlan({
    title: 'diamond',
    nodes: [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])],
  })
  expect(result.ok).toBe(true)
})

test('validatePlan rejects an empty plan', () => {
  const result = validatePlan({ title: 'empty', nodes: [] })
  expect(result.ok).toBe(false)
  expect(rejectionOf(result).code).toBe('empty')
})

test('validatePlan rejects duplicate ids', () => {
  const result = validatePlan({ title: 'dup', nodes: [node('a'), node('a')] })
  expect(result.ok).toBe(false)
  expect(rejectionOf(result).code).toBe('duplicate-id')
})

test('validatePlan rejects an unknown dependency', () => {
  const result = validatePlan({ title: 'dangling', nodes: [node('a', ['ghost'])] })
  expect(result.ok).toBe(false)
  expect(rejectionOf(result).code).toBe('unknown-dep')
})

test('validatePlan rejects a self dependency', () => {
  const result = validatePlan({ title: 'self', nodes: [node('a', ['a'])] })
  expect(result.ok).toBe(false)
  expect(rejectionOf(result).code).toBe('self-dep')
})

test('validatePlan rejects a cycle and names the path', () => {
  const result = validatePlan({
    title: 'loop',
    nodes: [node('a', ['c']), node('b', ['a']), node('c', ['b'])],
  })
  expect(result.ok).toBe(false)
  const rejection = rejectionOf(result)
  expect(rejection.code).toBe('cycle')
  expect(
    'path' in rejection && Array.isArray(rejection.path) && rejection.path.length > 0,
  ).toBe(true)
})

test('validatePlan rejects blank titles and prompts', () => {
  expect(rejectionOf(validatePlan({
    title: 'x',
    nodes: [{ id: 'a', title: ' ', prompt: 'p', deps: [] }],
  })).code).toBe('blank')
  expect(rejectionOf(validatePlan({
    title: 'x',
    nodes: [{ id: 'a', title: 't', prompt: '', deps: [] }],
  })).code).toBe('blank')
})

test('findCycle returns null for a DAG', () => {
  expect(findCycle([node('a'), node('b', ['a'])])).toBe(null)
})

test('readyIds releases a node only when every dependency settled', () => {
  const nodes = [node('a'), node('b', ['a']), node('c', ['a', 'b'])]
  const status: Record<string, NodeStatus> = {
    a: 'pending',
    b: 'pending',
    c: 'pending',
  }
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['a'])

  status.a = 'done'
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['b'])

  status.b = 'done'
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['c'])
})

test('readyIds treats a skipped dependency as settled', () => {
  const nodes = [node('a'), node('b', ['a'])]
  const status: Record<string, NodeStatus> = { a: 'skipped', b: 'pending' }
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['b'])
})

test('readyIds does not release behind a failed dependency', () => {
  const nodes = [node('a'), node('b', ['a'])]
  const status: Record<string, NodeStatus> = { a: 'failed', b: 'pending' }
  expect(readyIds(nodes, (id) => status[id]!)).toEqual([])
})

test('validatePlan rejects an unknown parent', () => {
  const result = validatePlan({
    title: 'parent',
    nodes: [{ id: 'a', title: 'a', prompt: 'do a', deps: [], parentId: 'ghost' }],
  })
  expect(result.ok).toBe(false)
  expect(rejectionOf(result).code).toBe('unknown-parent')
})

test('readyIds waits for an expanded parent before releasing children', () => {
  const nodes = [
    { id: 'impl', title: 'impl', prompt: 'p', deps: [] },
    { id: 'auth', title: 'auth', prompt: 'p', deps: [], parentId: 'impl' },
    { id: 'ui', title: 'ui', prompt: 'p', deps: ['auth'], parentId: 'impl' },
  ]
  const status: Record<string, NodeStatus> = {
    impl: 'running',
    auth: 'pending',
    ui: 'pending',
  }
  expect(readyIds(nodes, (id) => status[id]!)).toEqual([])
  status.impl = 'expanded'
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['auth'])
})

test('subtreeSettled waits for every child of an expanded parent', () => {
  const nodes = [
    { id: 'impl', deps: [] },
    { id: 'auth', deps: [], parentId: 'impl' },
    { id: 'review', deps: ['impl'] },
  ]
  const status: Record<string, NodeStatus> = {
    impl: 'expanded',
    auth: 'pending',
    review: 'pending',
  }
  expect(subtreeSettled('impl', nodes, (id) => status[id]!)).toBe(false)
  status.auth = 'done'
  expect(subtreeSettled('impl', nodes, (id) => status[id]!)).toBe(true)
  expect(readyIds(nodes, (id) => status[id]!)).toEqual(['review'])
})

test('waitingForConfirm is true only when a confirm request is pending', () => {
  const view = (confirm: FlowPlanView['confirm']): FlowPlanView => ({
    id: 'p',
    title: 'p',
    status: 'running',
    concurrency: 1,
    createdAt: '',
    updatedAt: '',
    nodes: [{
      id: 'a',
      title: 'a',
      prompt: 'a',
      deps: [],
      status: 'done',
      childId: null,
      summary: null,
      diagnostic: null,
      notes: [],
      updatedAt: '',
      attempts: 0,
    }],
    confirm,
  })
  expect(waitingForConfirm(view(null))).toBe(false)
  expect(waitingForConfirm(view({ question: '继续部署吗？', nodeId: 'a' }))).toBe(true)
})

test('depthOf assigns columns by longest dependency path', () => {
  const depths = depthOf([node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])])
  expect(depths.get('a')).toBe(0)
  expect(depths.get('b')).toBe(1)
  expect(depths.get('c')).toBe(1)
  expect(depths.get('d')).toBe(2)
})
