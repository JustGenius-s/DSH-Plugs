import { expect, test, vi } from 'vitest'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'

import { FlowOrchestrator } from '../src/orchestrator.ts'
import type { FlowPlanSpec } from '../src/shared.ts'

/**
 * The subset of `SubagentRun` the orchestrator consumes, restated here so the
 * test can hand it a run without booting the real subagent service.
 */
interface SubagentRunLike {
  readonly id: string
  readonly result: Promise<{
    readonly stopReason: string
    readonly output: readonly { readonly type: string; readonly text?: string }[]
    readonly diagnostic?: string
  }>
  dispose(): Promise<void>
}

/** A one-node plan; enough to drive one child through its lifecycle. */
const SPEC: FlowPlanSpec = {
  title: 'Pause me',
  nodes: [{ id: 'step', title: 'Step', prompt: 'Do the thing.', deps: [] }],
}

/**
 * Pause is a user action on a LIVE child, so it has to keep the node's work
 * resumable instead of failing it: the two host-visible effects are "the child
 * was disposed" and "the node is paused, not failed".
 */
function setup(run: SubagentRunLike) {
  const started: unknown[] = []
  const seam = {
    start: (provider: string, request: unknown) => {
      started.push({ provider, request })
      return Promise.resolve(run)
    },
  }
  const orchestrator = new FlowOrchestrator({} as Context, seam)
  const parent = { id: 'parent', status: 'idle' } as never
  return { orchestrator, parent, started, run }
}

/** A run whose result stays pending — a child that never settles on its own. */
function pendingRun(): SubagentRunLike & { disposed: () => number } {
  let disposed = 0
  return {
    id: 'child-1',
    result: new Promise(() => {}),
    dispose: async () => { disposed += 1 },
    disposed: () => disposed,
  }
}

test('pausing a running node disposes the child and holds it as paused', async () => {
  const run = pendingRun()
  const { orchestrator, parent } = setup(run)
  expect(orchestrator.setPlan(SPEC, parent).ok).toBe(true)
  // Dispatch is synchronous in status, but the seam resolves on a microtask.
  await Promise.resolve()
  await Promise.resolve()

  const paused = orchestrator.applyAction({ kind: 'pause', nodeId: 'step' })
  expect(paused).toEqual({ ok: true, message: null })
  const node = orchestrator.view()!.nodes[0]!
  expect(node.status).toBe('paused')
  expect(run.disposed()).toBe(1)
  // The plan is still live: a held node is not a finished one.
  expect(orchestrator.view()!.status).toBe('running')
})

test('pausing a node that is not running is rejected with its status', () => {
  const { orchestrator } = setup(pendingRun())
  // No subagent seam dispatch needed: the node was never started.
  orchestrator.applyAction({ kind: 'clear' })
  expect(orchestrator.applyAction({ kind: 'pause', nodeId: 'step' }).ok).toBe(false)
})

test('resuming a paused node re-dispatches it with the same brief', async () => {
  const first = pendingRun()
  const second = pendingRun()
  const started: SubagentRunLike[] = [first, second]
  let cursor = 0
  const seam = {
    start: () => {
      const run = started[cursor++]!
      return Promise.resolve(run)
    },
  }
  const orchestrator = new FlowOrchestrator({} as Context, seam)
  const parent = { id: 'parent', status: 'idle' } as never
  orchestrator.setPlan(SPEC, parent)
  await Promise.resolve()
  await Promise.resolve()

  orchestrator.applyAction({ kind: 'pause', nodeId: 'step' })
  const resumed = orchestrator.applyAction({ kind: 'resume', nodeId: 'step' })
  expect(resumed).toEqual({ ok: true, message: null })
  await Promise.resolve()
  await Promise.resolve()

  const node = orchestrator.view()!.nodes[0]!
  expect(node.status).toBe('running')
  expect(node.attempts).toBe(2)
  expect(cursor).toBe(2)
})

test('resuming a node that is not paused is rejected', () => {
  const { orchestrator, parent } = setup(pendingRun())
  orchestrator.setPlan(SPEC, parent)
  expect(orchestrator.applyAction({ kind: 'resume', nodeId: 'step' }).ok).toBe(false)
})

test('a paused node blocks its dependents from becoming ready', async () => {
  const twoNode: FlowPlanSpec = {
    title: 'Hold the line',
    nodes: [
      { id: 'first', title: 'First', prompt: 'Go.', deps: [] },
      { id: 'second', title: 'Second', prompt: 'Then go.', deps: ['first'] },
    ],
  }
  const { orchestrator, parent } = setup(pendingRun())
  orchestrator.setPlan(twoNode, parent)
  await Promise.resolve()
  await Promise.resolve()

  orchestrator.applyAction({ kind: 'pause', nodeId: 'first' })
  // flow_next must not start the dependent while its dependency is held.
  const advanced = orchestrator.advance()
  expect(advanced).toContain('Nothing is ready')
  expect(orchestrator.view()!.nodes.find((node) => node.id === 'second')!.status).toBe('pending')
})
