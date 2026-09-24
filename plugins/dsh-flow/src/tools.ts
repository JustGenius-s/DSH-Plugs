/**
 * The Leader's tool surface.
 *
 * The Leader plans, inspects, advances, reshapes, and requests confirmation; children may
 * expand, request confirmation, and report progress. Each tool that needs the Agent reads
 * it from its own execution context, so the orchestrator always knows whose
 * plan it is driving.
 *
 * The parameter schema is the repository's author-facing DSL, not raw JSON
 * Schema: object nodes must declare `additionalProperties`, arrays carry a
 * single `items` value schema, and nested objects are `type: 'object'` values.
 */
import { defineTool } from '@just-genius/dsh-plugin-runtime/host'
import type { Agent } from '@just-genius/dsh-plugin-runtime/host'

import { validatePlan } from './graph.ts'
import { sessionIdOf } from './mode.ts'
import type { FlowOrchestrator, PlanOutcome } from './orchestrator.ts'
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  FLOW_TOOL_NAMES,
  type FlowAction,
  type FlowNodeSpec,
  type FlowPlanSpec,
} from './shared.ts'

/** Every tool needs the same three things. */
interface ToolDeps {
  readonly orchestrator: FlowOrchestrator
  /** Resolve the delegating Agent (Leader) for one tool execution. */
  readonly parentOf: (exec: { readonly agent?: Agent }) => Agent | undefined
  /**
   * Whether Flow mode is on for one session.
   *
   * Checked inside `execute` as well as by the prompt section: the mode gate is
   * a real precondition, not just a hint, so a model that calls a flow tool
   * while the mode is off gets told why rather than silently mutating the graph.
   */
  readonly isEnabled: (sessionId: string) => boolean
}

/** Rejection text when a flow tool is called outside Flow mode. */
const MODE_OFF = 'Flow mode is off. Enter it with `/flow` before using flow tools.'

/**
 * The node shape, shared by `flow_plan` and `flow_patch`.
 *
 * No `required` block on purpose. The schema DSL compiles an array's `items`
 * with `allowRequired: false`, so a `required` key inside an object that is
 * itself an array item is rejected at boot — a hard failure, not a warning.
 * Requiredness is therefore described in the description text and enforced by
 * `readNode`, which already validates every argument before use.
 */
const NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Required. Stable unique id, referenced by other nodes in `deps`.' },
    title: { type: 'string', description: 'Required. One-line label shown on the graph.' },
    prompt: { type: 'string', description: 'Required. The complete self-contained brief for this step.' },
    deps: { type: 'array', items: { type: 'string' }, description: 'Ids that must settle first.' },
    parentId: { type: 'string', description: 'Optional. Nest this node under another node as a child step.' },
    persona: { type: 'string', description: 'Optional per-node persona override for the child.' },
    confirm: { type: 'boolean', description: 'Optional. If true, pause for a human after this node settles.' },
  },
} as const

/** Render a plan outcome as the model-facing text of one tool call. */
function renderPlan(outcome: PlanOutcome): string {
  if (!outcome.ok) {
    return [
      `Plan rejected: ${outcome.rejection.message}`,
      '',
      'Fix the graph and call flow_plan again. Nothing was dispatched.',
    ].join('\n')
  }
  const plan = outcome.plan
  const lines = [`Plan "${plan.title}" accepted with ${plan.nodes.length} node(s); concurrency ${plan.concurrency}.`, '']
  for (const node of plan.nodes) {
    const deps = node.deps.length === 0 ? 'no deps' : `depends on ${node.deps.join(', ')}`
    lines.push(`- ${node.id} [${node.status}] ${node.title} (${deps})`)
  }
  lines.push(
    '',
    'The first ready step has started. Tell the user that step is running, then stop.',
    'When it settles, inspect with flow_status. If the result is good, call flow_next.',
    'Later steps do not start until you do.',
  )
  return lines.join('\n')
}



export function createFlowTools(deps: ToolDeps) {
  const { orchestrator, parentOf, isEnabled } = deps

  /** Guard every flow tool on the session's mode. */
  const gate = (exec: { readonly agent?: Agent }): string | null => {
    const parent = parentOf(exec)
    if (parent === undefined) return 'flow tools require a live agent context.'
    if (!isEnabled(sessionIdOf(parent))) return MODE_OFF
    return null
  }

  const flowPlan = defineTool({
    name: FLOW_TOOL_NAMES.plan,
    description:
      'Flow mode only. Replace the current workflow graph with a new plan and start the first ready step. Later steps stay pending until you accept a result and call flow_next. Use `parentId` to nest child steps under a node. A child that finds it owns several tasks can also call flow_expand. Each node needs a complete, self-contained prompt.',
    parameters: {
      title: { type: 'string', description: 'Short name for this plan, shown on the Flow tab.' },
      nodes: {
        type: 'array',
        description: 'The steps. Order does not matter; dependencies do.',
        items: NODE_SCHEMA,
      },
      concurrency: {
        type: 'integer',
        description: `How many steps may run at once (${CONCURRENCY_MIN}–${CONCURRENCY_MAX}). Defaults to 1 so the Leader reviews each result before the next step starts.`,
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const blocked = gate(exec)
      if (blocked !== null) return blocked
      const parent = parentOf(exec)
      if (parent === undefined) return 'flow_plan requires a live agent context.'
      const normalized = normalizePlanArgs(args)
      if (typeof normalized === 'string') return normalized
      return renderPlan(orchestrator.setPlan(normalized, parent))
    },
  })

  const flowStatus = defineTool({
    name: FLOW_TOOL_NAMES.status,
    description:
      'Flow mode only. Read the current workflow graph with each completed node\'s output. Call this after a child settles, before flow_next or flow_patch. Pass `nodeId` to read one node\'s full output.',
    parameters: {
      nodeId: {
        type: 'string',
        description: 'Optional. If set, return that node\'s full output instead of the compact graph.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const blocked = gate(exec)
      if (blocked !== null) return blocked
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : undefined
      return orchestrator.report(nodeId)
    },
  })

  const flowNext = defineTool({
    name: FLOW_TOOL_NAMES.next,
    description:
      'Flow mode only. After you have inspected a settled child and accepted the result, start the next ready step. The Host does not auto-advance. Call this once per review unless a human confirmation is pending — then wait for the user (or they click 「通过并继续」). Do not start later work yourself.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (_args, exec) => {
      const blocked = gate(exec)
      if (blocked !== null) return blocked
      return orchestrator.advance()
    },
  })

  const flowExpand = defineTool({
    name: FLOW_TOOL_NAMES.expand,
    description:
      'Split the running child\'s graph node into smaller steps when the assignment is actually several tasks (for example implementing a feature). New children do not start until the Leader reviews and calls flow_next. After expanding, stop — do not execute the subtree yourself.',
    parameters: {
      parentId: {
        type: 'string',
        description: 'Optional. Node to expand; inferred from the running child. If provided, it must be that child\'s own node.',
      },
      nodes: {
        type: 'array',
        description: 'Child steps to insert under the parent.',
        items: NODE_SCHEMA,
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const caller = parentOf(exec)
      if (caller === undefined) return 'flow_expand requires a live agent context.'
      const running = orchestrator.runningNodeFor(caller)
      if (running === null) return 'flow_expand is for the child that is currently running a node.'
      const requested = typeof args.parentId === 'string' ? args.parentId.trim() : ''
      const parentId = running.spec.id
      if (requested !== '' && requested !== parentId) {
        return `A running child can only expand its own node (${parentId}).`
      }
      if (!Array.isArray(args.nodes)) return 'flow_expand needs a `nodes` array.'
      const nodes: FlowNodeSpec[] = []
      for (const raw of args.nodes) {
        const spec = readNode(raw)
        if (typeof spec === 'string') return spec
        nodes.push(spec)
      }
      return orchestrator.expand(parentId, nodes)
    },
  })

  const flowConfirm = defineTool({
    name: FLOW_TOOL_NAMES.confirm,
    description:
      'Pause the plan until a human answers. Use only when a real decision is needed — not after every step. The Leader or the running child may call it. After calling, stop. The Flow tab shows the question; the user clicks 「通过并继续」 or replies in chat.',
    parameters: {
      question: {
        type: 'string',
        description: 'Required. Short question shown to the user.',
      },
      nodeId: {
        type: 'string',
        description: 'Optional. Node this question is about. Inferred for a running child.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const caller = parentOf(exec)
      if (caller === undefined) return 'flow_confirm requires a live agent context.'
      const running = orchestrator.runningNodeFor(caller)
      const leader = isEnabled(sessionIdOf(caller))
      if (!leader && running === null) {
        return 'flow_confirm is for the Leader (after `/flow`) or the child that is currently running a node.'
      }
      const question = typeof args.question === 'string' ? args.question : ''
      const requested = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
      const nodeId = running !== null ? running.spec.id : (requested === '' ? null : requested)
      if (running !== null && requested !== '' && requested !== nodeId) {
        return `A running child can only request confirmation for its own node (${nodeId}).`
      }
      return orchestrator.requestConfirm(question, nodeId, { wake: running !== null })
    },
  })

  const flowReport = defineTool({
    name: FLOW_TOOL_NAMES.report,
    description:
      'For the child currently running a node: at each key milestone (a finding, a decision, a completed change, a verified result, or a blocker), report one sentence of no more than 50 characters in the user\'s language to the Flow canvas.',
    parameters: {
      note: {
        type: 'string',
        description: 'Required. One sentence of no more than 50 characters, in the user\'s language, reporting the key milestone.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const caller = parentOf(exec)
      if (caller === undefined) return 'flow_report requires a live agent context.'
      const note = typeof args.note === 'string' ? args.note : ''
      return orchestrator.reportNote(caller, note)
    },
  })

  const flowPatch = defineTool({
    name: FLOW_TOOL_NAMES.patch,
    description:
      'Flow mode only. Adjust the current workflow graph in response to child results. `retry` re-dispatches a settled node (optionally with a revised prompt, title, or dependency set) and unblocks its dependents; `skip` marks it done-without-running so dependents can proceed; `cancel` stops a live node and marks it failed; `add` inserts new nodes — use it to insert a corrective step after a failure. You cannot change a node that is currently running.',
    parameters: {
      ops: {
        type: 'array',
        description: 'The adjustments to apply, in order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            op: {
              type: 'string',
              enum: ['retry', 'skip', 'cancel', 'add', 'remove'],
              description: 'Required. The adjustment to apply.',
            },
            nodeId: { type: 'string', description: 'Target node id (for retry / skip / cancel / remove).' },
            node: {
              description: 'For `add`: the new node. For `retry`: fields to override before re-dispatching.',
              type: 'json',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const blocked = gate(exec)
      if (blocked !== null) return blocked
      return applyPatch(orchestrator, Array.isArray(args.ops) ? args.ops : [])
    },
  })

  const flowClear = defineTool({
    name: FLOW_TOOL_NAMES.clear,
    description:
      'Flow mode only. Cancel every running child and drop the current plan. Use it when the plan is obsolete or the user changes direction.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (_args, exec) => {
      const blocked = gate(exec)
      if (blocked !== null) return blocked
      const result = orchestrator.applyAction({ kind: 'clear' })
      return result.ok ? 'Plan cleared; every running child was cancelled.' : `Could not clear: ${result.message}`
    },
  })

  return [flowPlan, flowStatus, flowNext, flowExpand, flowConfirm, flowReport, flowPatch, flowClear]
}

/** Model-generated arguments are only shaped like the schema; validate for real. */
interface RawNode {
  readonly id?: unknown
  readonly title?: unknown
  readonly prompt?: unknown
  readonly deps?: unknown
  readonly parentId?: unknown
  readonly persona?: unknown
  readonly confirm?: unknown
}

function normalizePlanArgs(args: unknown): FlowPlanSpec | string {
  if (args === null || typeof args !== 'object') return 'flow_plan needs an object argument.'
  const value = args as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title : 'Untitled plan'
  if (!Array.isArray(value.nodes)) return 'flow_plan needs a `nodes` array.'

  const nodes: FlowNodeSpec[] = []
  for (const raw of value.nodes) {
    const spec = readNode(raw)
    if (typeof spec === 'string') return spec
    nodes.push(spec)
  }

  const spec: FlowPlanSpec = {
    title,
    nodes,
    ...(typeof value.concurrency === 'number' ? { concurrency: value.concurrency } : {}),
  }
  // Validate here too, so an invalid graph is reported by the tool in the
  // Leader's own turn rather than surfacing as an orchestrator rejection.
  const validated = validatePlan(spec)
  if (!validated.ok) return `Plan rejected: ${validated.rejection.message}`
  return spec
}

/**
 * Apply patch ops sequentially, reporting each result.
 *
 * Sequential matters: a later op may depend on the graph an earlier op produced
 * (skip a subtree, then add a corrective node behind it).
 */
function applyPatch(orchestrator: FlowOrchestrator, ops: readonly unknown[]): string {
  if (ops.length === 0) return 'flow_patch needs at least one op.'
  const lines: string[] = []

  for (const raw of ops) {
    if (raw === null || typeof raw !== 'object') {
      lines.push('- skipped a malformed op (not an object)')
      continue
    }
    const op = raw as Record<string, unknown>
    const kind = op.op
    const nodeId = typeof op.nodeId === 'string' ? op.nodeId : null

    if (kind === 'add') {
      const spec = readNode(op.node)
      if (typeof spec === 'string') {
        lines.push(`- add: ${spec}`)
        continue
      }
      const result = orchestrator.addNode(spec)
      lines.push(`- add ${spec.id}: ${result.ok ? 'inserted' : (result.message ?? 'failed')}`)
      continue
    }

    if (kind === 'remove') {
      if (nodeId === null) {
        lines.push('- remove: needs `nodeId`')
        continue
      }
      const result = orchestrator.removeNode(nodeId)
      lines.push(`- remove ${nodeId}: ${result.ok ? 'removed' : (result.message ?? 'failed')}`)
      continue
    }

    if (kind !== 'retry' && kind !== 'skip' && kind !== 'cancel') {
      lines.push(`- unknown op "${String(kind)}"`)
      continue
    }
    if (nodeId === null) {
      lines.push(`- ${String(kind)}: needs \`nodeId\``)
      continue
    }

    // `retry` may carry overrides; apply them before re-dispatching.
    if (kind === 'retry' && op.node !== undefined && op.node !== null) {
      const patch = readNodePatch(op.node)
      if (typeof patch === 'string') {
        lines.push(`- retry ${nodeId}: ${patch}`)
        continue
      }
      const updated = orchestrator.updateNode(nodeId, patch)
      if (!updated.ok) {
        lines.push(`- retry ${nodeId}: ${updated.message ?? 'could not update the node'}`)
        continue
      }
    }

    const action: FlowAction = { kind, nodeId }
    const result = orchestrator.applyAction(action)
    lines.push(`- ${kind} ${nodeId}: ${result.ok ? 'applied' : (result.message ?? 'failed')}`)
  }

  lines.push('', orchestrator.report())
  return lines.join('\n')
}

function readNode(raw: unknown): FlowNodeSpec | string {
  if (raw === null || typeof raw !== 'object') return 'every node must be an object.'
  const node = raw as RawNode
  if (typeof node.id !== 'string' || node.id.trim() === '') return 'every node needs a non-empty string `id`.'
  if (typeof node.title !== 'string' || node.title.trim() === '') return `\`${node.id}\` needs a non-empty string \`title\`.`
  if (typeof node.prompt !== 'string' || node.prompt.trim() === '') return `\`${node.id}\` needs a non-empty string \`prompt\`.`
  const deps = Array.isArray(node.deps) ? node.deps.filter((dep): dep is string => typeof dep === 'string') : []
  return {
    id: node.id,
    title: node.title,
    prompt: node.prompt,
    deps,
    ...(typeof node.parentId === 'string' && node.parentId.trim() !== '' ? { parentId: node.parentId } : {}),
    ...(typeof node.persona === 'string' ? { persona: node.persona } : {}),
    ...(node.confirm === true ? { confirm: true } : {}),
  }
}

function readNodePatch(raw: unknown): NodePatch | string {
  if (raw === null || typeof raw !== 'object') return '`node` must be an object.'
  const node = raw as RawNode
  const patch: { title?: string; prompt?: string; deps?: string[] } = {}
  if (typeof node.title === 'string' && node.title.trim() !== '') patch.title = node.title
  if (typeof node.prompt === 'string' && node.prompt.trim() !== '') patch.prompt = node.prompt
  if (Array.isArray(node.deps)) patch.deps = node.deps.filter((dep): dep is string => typeof dep === 'string')
  if (Object.keys(patch).length === 0) return '`node` carried no updatable fields.'
  return patch
}

/** The subset of a node spec the Leader may rewrite before a retry. */
type NodePatch = Partial<Pick<FlowNodeSpec, 'title' | 'prompt' | 'deps'>>
