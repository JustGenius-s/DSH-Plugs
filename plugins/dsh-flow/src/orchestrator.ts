/**
 * Host orchestrator: owns one plan, dispatches ready nodes to child agents,
 * and folds their settlements back into the graph.
 *
 * The settlement source is the `SubagentRun.result` promise each dispatch
 * returns, NOT the `subagent/end` event. That event dispatches scoped to the
 * delegating parent Agent, so a plugin-level listener cannot rely on receiving
 * it; the promise we already hold settles either way.
 */
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { createUserMessage } from '@just-genius/dsh-plugin-runtime/host'
import type { Agent } from '@just-genius/dsh-plugin-runtime/host'

import { depthOf, readyIds, validatePlan, type PlanRejection } from './graph.ts'
import { CHILD_EXPAND_HINT, CHILD_REPORT_HINT } from './policy.ts'
import {
  NOTE_MAX,
  NOTE_TEXT_LIMIT,
  OUTPUT_STORE_LIMIT,
  SETTLED_STATUSES,
  STATUS_FOCUS_LIMIT,
  STATUS_RESULT_LIMIT,
  STATUS_TOTAL_LIMIT,
  SUMMARY_LIMIT,
  UPSTREAM_LIMIT,
  clampConcurrency,
  truncate,
  type FlowAction,
  type FlowNodeSpec,
  type FlowPlanSpec,
  type FlowPlanView,
  type FlowNodeView,
  type NodeStatus,
} from './shared.ts'
import type { ChildOutcome, DispatchedRun, RuntimeNode, RuntimePlan } from './types.ts'
import { shouldWakeLeader } from './wake-policy.ts'

/**
 * The subagent seam, narrowed to what this orchestrator actually needs.
 *
 * Mirrors `ctx.subagents.start(provider, request)` and the `SubagentRun` handle
 * it resolves with, without importing the official package directly (the
 * repository boundary requires plugins to go through `@just-genius/dsh-plugin-runtime`).
 */
interface SubagentSeam {
  start(provider: string, request: {
    readonly label?: string
    readonly prompt: readonly { readonly type: 'text'; readonly text: string }[]
    readonly parent: Agent
    readonly signal: AbortSignal
    readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
    readonly persona?: string
  }): Promise<SubagentRunLike>
}

/** The subset of `SubagentRun` this orchestrator consumes. */
interface SubagentRunLike {
  /** The child's session id; for a local run this equals the child session. */
  readonly id: string
  /**
   * Resolves with the child's terminal outcome. Does NOT reject on a
   * child-level failure — a model or transport failure resolves with
   * `stopReason: 'error'` so the caller maps it to a failure itself.
   */
  readonly result: Promise<{
    readonly stopReason: string
    readonly output: readonly { readonly type: string; readonly text?: string }[]
    readonly diagnostic?: string
  }>
  dispose(): Promise<void>
}

/**
 * The subset of `Agent` needed to wake the Leader when a child settles.
 *
 * `followup` queues a next-turn message and wakes the driver; declared on
 * `Agent` by the agent-loop package via module augmentation.
 */
interface WakeableAgent {
  readonly id: string
  readonly status?: 'idle' | 'running'
  followup?(message: unknown): void
}

/** What a plan request returns to the Leader's tool call. */
export type PlanOutcome =
  | { readonly ok: true; readonly plan: FlowPlanView }
  | { readonly ok: false; readonly rejection: PlanRejection }

/** Why the orchestrator cannot dispatch at all right now. */
export interface Degraded {
  readonly degraded: true
  readonly reason: string
}

const DEFAULT_PROVIDER = 'spawn'

export class FlowOrchestrator {
  private plan: RuntimePlan | null = null
  private counter = 0
  private revision = 0
  /**
   * Bumped whenever the plan is replaced or cleared.
   *
   * A dispatched child owns an OS-level process, so cancelling it does not make
   * its settlement promise stop existing. Without a generation check, a child
   * from a replaced plan would settle into the NEW plan — re-pumping it and
   * waking the Leader about a node that no longer exists.
   */
  private generation = 0
  /** Settlements already reported, so we wake once per node attempt. */
  private woken = new Set<string>()
  /** Coalesces parallel settlements into one Leader turn. */
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private wakePending = false

  constructor(
    private readonly ctx: Context,
    private readonly subagents: SubagentSeam | undefined,
  ) {}

  /** Monotonic counter for change detection; the canvas compares it. */
  get version(): number {
    return this.revision
  }

  /** True when the subagent service was unavailable at mount time. */
  get degradedReason(): string | null {
    return this.subagents === undefined ? 'subagent service is not mounted' : null
  }

  /**
   * Replace the current plan and start dispatching.
   *
   * Returns synchronously after the first dispatch wave — the Leader is not
   * blocked on child work, which is the whole point of delegating.
   */
  setPlan(spec: FlowPlanSpec, parent: Agent): PlanOutcome {
    const validated = validatePlan(spec)
    if (!validated.ok) return { ok: false, rejection: validated.rejection }

    this.disposeCurrentPlan()
    this.counter += 1
    this.generation += 1
    const now = new Date().toISOString()
    const nodes = new Map<string, RuntimeNode>()
    const order: string[] = []

    for (const node of validated.plan.nodes) {
      nodes.set(node.id, {
        spec: normalizeSpec(node),
        status: 'pending',
        run: null,
        output: null,
        summary: null,
        diagnostic: null,
        notes: [],
        updatedAt: now,
        attempts: 0,
      })
      order.push(node.id)
    }

    this.plan = {
      id: `plan-${this.counter}`,
      title: spec.title.trim() === '' ? 'Untitled plan' : spec.title.trim(),
      status: 'idle',
      concurrency: clampConcurrency(spec.concurrency),
      nodes,
      order,
      createdAt: now,
      updatedAt: now,
      confirm: null,
      parent,
    }
    this.revision += 1
    this.woken.clear()
    this.markContainers()

    this.pump(parent)
    return { ok: true, plan: this.view()! }
  }

  /**
   * Insert a node into the live plan.
   *
   * This is how the Leader inserts a corrective step after a failure. The new
   * node is validated against the graph it is joining, so an id collision or a
   * cycle is reported to the model instead of corrupting the plan.
   */
  addNode(spec: FlowNodeSpec): { ok: boolean; message: string | null } {
    const inserted = this.insertNode(spec)
    if (!inserted.ok) return inserted
    this.revision += 1
    this.markContainers()
    this.refreshPlanStatus()
    return { ok: true, message: null }
  }

  /**
   * Attach child nodes under `parentId`.
   *
   * Used by the Leader and by the child that is currently running that parent.
   * Does not start the new children — the Leader calls `flow.next` after review.
   */
  expand(parentId: string, specs: readonly FlowNodeSpec[]): string {
    const plan = this.plan
    if (plan === null) return 'No plan is active. Call flow.plan to create one.'
    const parent = plan.nodes.get(parentId)
    if (parent === undefined) return `Unknown node "${parentId}".`
    if (parent.status === 'failed' || parent.status === 'skipped') {
      return `Cannot expand "${parentId}" while it is ${parent.status}. Retry or skip it first.`
    }
    if (this.parentDepth(parentId) >= 3) {
      return `Cannot expand "${parentId}": the tree is already 4 levels deep.`
    }
    if (specs.length === 0) return 'flow.expand needs at least one child node.'

    const added: string[] = []
    for (const spec of specs) {
      const child: FlowNodeSpec = { ...spec, parentId }
      const inserted = this.insertNode(child)
      if (!inserted.ok) {
        return `expand stopped at "${spec.id}": ${inserted.message ?? 'failed'}\n\n${this.report()}`
      }
      added.push(spec.id)
    }

    if (parent.status === 'pending' || parent.status === 'done') {
      parent.status = 'expanded'
      parent.updatedAt = new Date().toISOString()
    }
    plan.updatedAt = new Date().toISOString()
    this.revision += 1
    this.refreshPlanStatus()
    return [
      `Expanded "${parentId}" with ${added.length} child node(s): ${added.join(', ')}.`,
      parent.status === 'running'
        ? 'The parent is still running. After it settles, inspect with flow.status, then flow.next.'
        : 'Inspect with flow.status, then flow.next to start the first child.',
      '',
      this.report(),
    ].join('\n')
  }

  /**
   * Pause dispatch until a human answers.
   *
   * Used only when the Leader or a child actually needs a decision — not after
   * every settled step. The canvas shows the question; `flow.next` or the
   * 「通过并继续」 button clears the gate and continues.
   */
  requestConfirm(question: string, nodeId: string | null, opts?: { readonly wake?: boolean }): string {
    const plan = this.plan
    if (plan === null) return 'No plan is active. Call flow.plan to create one.'
    const trimmed = question.trim()
    if (trimmed === '') return 'flow.confirm needs a non-empty `question`.'
    if (nodeId !== null && nodeId !== '' && !plan.nodes.has(nodeId)) {
      return `Unknown node "${nodeId}".`
    }
    plan.confirm = { question: trimmed, nodeId: nodeId === '' ? null : nodeId }
    plan.updatedAt = new Date().toISOString()
    this.revision += 1
    if (opts?.wake === true) this.scheduleWake(plan.parent)
    return [
      `Human confirmation requested${plan.confirm.nodeId !== null ? ` for "${plan.confirm.nodeId}"` : ''}.`,
      plan.confirm.question,
      'Stop. Do not call flow.next or continue the subtree. The user will answer on the Flow tab or in chat.',
    ].join('\n')
  }

  /**
   * Append a progress note to the node a running child owns.
   *
   * This is the only live signal the canvas has while a child works: the
   * subagent seam exposes no streaming channel, so the child reports its own
   * key moments. Notes are per-attempt — a retry starts with a clean slate.
   */
  reportNote(agent: { readonly id: unknown; readonly session?: { readonly id: unknown } }, text: string): string {
    const plan = this.plan
    if (plan === null) return 'No plan is active.'
    const node = this.runningNodeFor(agent)
    if (node === null) {
      return 'flow.report is for the child that is currently running a node.'
    }
    const trimmed = text.trim()
    if (trimmed === '') return 'flow.report needs a non-empty `note`.'
    node.notes.push({ text: truncate(trimmed, NOTE_TEXT_LIMIT), at: new Date().toISOString() })
    if (node.notes.length > NOTE_MAX) node.notes.splice(0, node.notes.length - NOTE_MAX)
    node.updatedAt = new Date().toISOString()
    plan.updatedAt = node.updatedAt
    this.revision += 1
    return 'Noted. Keep working; report again at the next key moment.'
  }

  /** The live graph node owned by this child agent, if any. */
  runningNodeFor(agent: { readonly id: unknown; readonly session?: { readonly id: unknown } }): RuntimeNode | null {
    const plan = this.plan
    if (plan === null) return null
    const ids = new Set<string>([String(agent.id)])
    if (agent.session !== undefined) ids.add(String(agent.session.id))
    for (const node of plan.nodes.values()) {
      if (node.status !== 'running' || node.run === null) continue
      const childId = node.run.childId
      if (childId !== null && ids.has(childId)) return node
    }
    return null
  }

  /** Remove a node that is not running and is nobody's dependency. */
  removeNode(id: string): { ok: boolean; message: string | null } {
    const plan = this.plan
    if (plan === null) return { ok: false, message: 'no plan is active' }
    const node = plan.nodes.get(id)
    if (node === undefined) return { ok: false, message: `unknown node "${id}"` }
    if (node.status === 'running') return { ok: false, message: `"${id}" is running; cancel it first` }
    if (this.childrenOf(id).length > 0) return { ok: false, message: `"${id}" still has child nodes; remove those first` }
    for (const other of plan.nodes.values()) {
      if (other.spec.id !== id && other.spec.deps.includes(id)) {
        return { ok: false, message: `"${other.spec.id}" still depends on "${id}"` }
      }
    }
    plan.nodes.delete(id)
    plan.order.splice(plan.order.indexOf(id), 1)
    plan.updatedAt = new Date().toISOString()
    this.revision += 1
    this.refreshPlanStatus()
    return { ok: true, message: null }
  }

  /**
   * Rewrite a settled node's brief before re-dispatching it.
   *
   * Changing `deps` re-validates against cycles, so the Leader can reroute a
   * step around a failed neighbour.
   */
  updateNode(id: string, patch: Partial<Pick<FlowNodeSpec, 'title' | 'prompt' | 'deps'>>): { ok: boolean; message: string | null } {
    const plan = this.plan
    if (plan === null) return { ok: false, message: 'no plan is active' }
    const node = plan.nodes.get(id)
    if (node === undefined) return { ok: false, message: `unknown node "${id}"` }
    if (node.status === 'running') return { ok: false, message: `"${id}" is running; cancel it first` }

    const nextDeps = patch.deps ?? node.spec.deps
    for (const dep of nextDeps) {
      if (dep === id) return { ok: false, message: `"${id}" cannot depend on itself` }
      if (!plan.nodes.has(dep)) return { ok: false, message: `unknown dependency "${dep}"` }
      if (this.dependsOn(dep, id)) return { ok: false, message: `"${dep}" would create a cycle` }
    }

    node.spec = {
      ...node.spec,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.deps !== undefined ? { deps: [...new Set(nextDeps)] } : {}),
    }
    node.updatedAt = new Date().toISOString()
    plan.updatedAt = node.updatedAt
    this.revision += 1
    return { ok: true, message: null }
  }

  /** True when `from` transitively depends on `to`. */
  private dependsOn(from: string, to: string): boolean {
    const plan = this.plan
    if (plan === null) return false
    const stack = [...(plan.nodes.get(from)?.spec.deps ?? [])]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === to) return true
      if (seen.has(current)) continue
      seen.add(current)
      stack.push(...(plan.nodes.get(current)?.spec.deps ?? []))
    }
    return false
  }

  /**
   * Change how many children may run at once.
   *
   * Raising the cap can start more work immediately, so this re-pumps. Children
   * already running above a lowered cap are left alone rather than killed.
   */
  setConcurrency(value: number): void {
    const plan = this.plan
    if (plan === null) return
    plan.concurrency = clampConcurrency(value)
    plan.updatedAt = new Date().toISOString()
    this.revision += 1
    this.pump(plan.parent)
  }

  /** Apply one mutation from the canvas or the Leader's `flow.patch` tool. */
  applyAction(action: FlowAction): { ok: boolean; message: string | null } {
    const plan = this.plan
    if (plan === null) return { ok: false, message: 'no plan is active' }
    if (action.kind === 'clear') {
      this.disposeCurrentPlan()
      this.plan = null
      this.generation += 1
      this.revision += 1
      return { ok: true, message: null }
    }

    if (action.kind === 'next') {
      plan.confirm = null
      const message = this.advance()
      return { ok: message.startsWith('Started'), message }
    }

    const node = plan.nodes.get(action.nodeId)
    if (node === undefined) return { ok: false, message: `unknown node "${action.nodeId}"` }

    if (action.kind === 'retry') {
      if (node.status !== 'failed' && node.status !== 'skipped' && node.status !== 'done') {
        return { ok: false, message: `node "${action.nodeId}" is ${node.status}; only a settled node can be retried` }
      }
      plan.confirm = null
      void this.disposeNode(node)
      node.status = 'pending'
      node.run = null
      node.output = null
      node.summary = null
      node.diagnostic = null
      node.notes = []
      node.updatedAt = new Date().toISOString()
      plan.status = 'running'
      this.revision += 1
      this.pump(plan.parent)
      return { ok: true, message: null }
    }

    if (action.kind === 'skip') {
      if (node.status === 'running') {
        void this.disposeNode(node)
      }
      if (node.status === 'done') {
        return { ok: false, message: `node "${action.nodeId}" already completed` }
      }
      this.settle(node, 'skipped', null, null)
      plan.updatedAt = new Date().toISOString()
      this.revision += 1
      this.refreshPlanStatus()
      return { ok: true, message: null }
    }

    // cancel
    if (node.status !== 'running' && node.status !== 'ready') {
      return { ok: false, message: `node "${action.nodeId}" is ${node.status}; only a live node can be cancelled` }
    }
    void this.disposeNode(node)
    this.settle(node, 'failed', null, 'cancelled by request')
    plan.updatedAt = new Date().toISOString()
    this.revision += 1
    this.refreshPlanStatus()
    return { ok: true, message: null }
  }

  /**
   * Start the next ready step(s), up to the unused concurrency slots.
   *
   * The Host does not auto-advance after a child settles — the Leader reviews
   * that result and calls this when it is willing to continue.
   */
  advance(): string {
    const plan = this.plan
    if (plan === null) return 'No plan is active. Call flow.plan to create one.'
    if (plan.status === 'settled') {
      return 'Every node has settled. Summarise the outcome for the user; there is nothing left to dispatch.'
    }
    if (plan.confirm !== null) {
      plan.confirm = null
    }

    const started = this.pump(plan.parent)
    if (started.length > 0) {
      return [`Started ${started.map((id) => `"${id}"`).join(', ')}.`, '', this.report()].join('\n')
    }

    const running = [...plan.nodes.values()].filter((node) => node.status === 'running')
    if (running.length > 0) {
      return `Nothing new started; ${running.map((node) => node.spec.id).join(', ')} already running. Wait for that child to settle.`
    }
    const failed = [...plan.nodes.values()].filter((node) => node.status === 'failed')
    if (failed.length > 0) {
      return `Nothing is ready. Failed node(s) block dependents: ${failed.map((node) => node.spec.id).join(', ')}. Patch them (retry / skip / add), then call flow.next.`
    }
    return 'Nothing is ready to run yet. Call flow.status and inspect the graph.'
  }

  /** The wire-safe projection consumed by the canvas. */
  view(): FlowPlanView | null {
    const plan = this.plan
    if (plan === null) return null
    const nodes: FlowNodeView[] = []
    for (const id of plan.order) {
      const node = plan.nodes.get(id)
      if (node === undefined) continue
      nodes.push({
        ...node.spec,
        status: node.status,
        childId: node.run?.childId ?? null,
        summary: node.summary,
        diagnostic: node.diagnostic,
        notes: [...node.notes],
        updatedAt: node.updatedAt,
        attempts: node.attempts,
      })
    }
    return {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      concurrency: plan.concurrency,
      nodes,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      confirm: plan.confirm,
    }
  }

  /**
   * Model-facing status. Reads host-held full output, not the canvas summary.
   *
   * `focusId` dumps one node up to `STATUS_FOCUS_LIMIT`. The graph view caps
   * each result and the whole report so a large child cannot blow the turn.
   */
  report(focusId?: string): string {
    const plan = this.plan
    if (plan === null) return 'No plan is active. Call flow.plan to create one.'

    if (focusId !== undefined && focusId !== '') {
      const node = plan.nodes.get(focusId)
      if (node === undefined) return `Unknown node "${focusId}".`
      return renderFocused(node)
    }

    const lines = [`Plan "${plan.title}" — ${plan.status}`, '']
    if (plan.confirm !== null) {
      const where = plan.confirm.nodeId !== null ? ` (${plan.confirm.nodeId})` : ''
      lines.push(`Waiting for human confirmation${where}: ${plan.confirm.question}`, '')
    }
    for (const id of plan.order) {
      const node = plan.nodes.get(id)
      if (node === undefined) continue
      const deps = node.spec.deps.length === 0 ? '' : ` (deps: ${node.spec.deps.join(', ')})`
      const parent = node.spec.parentId === undefined ? '' : ` (parent: ${node.spec.parentId})`
      const pad = node.spec.parentId === undefined ? '' : '  '
      lines.push(`${pad}- ${node.spec.id} [${node.status}] ${node.spec.title}${deps}${parent}`)
      if (node.status === 'running' && node.notes.length > 0) {
        lines.push(`    progress: ${node.notes[node.notes.length - 1]!.text}`)
      }
      if (node.status === 'done' && node.output !== null && node.output !== '') {
        lines.push('    result:')
        lines.push(indent(truncate(node.output, STATUS_RESULT_LIMIT)))
      }
      if (node.status === 'failed') {
        lines.push(`    failure: ${node.diagnostic ?? 'unknown'}`)
        if (node.output !== null && node.output !== '') {
          lines.push('    output:')
          lines.push(indent(truncate(node.output, STATUS_RESULT_LIMIT)))
        }
      }
    }
    lines.push('', 'Terminal statuses: done, skipped. A failed node blocks its dependents until you retry or skip it.')
    lines.push('Pass `nodeId` to flow.status to read one node\'s full output.')
    return truncate(lines.join('\n'), STATUS_TOTAL_LIMIT)
  }

  /** Cancel every live child and drop the plan. Called on plugin disposal. */
  shutdown(): void {
    this.cancelWake()
    this.disposeCurrentPlan()
    this.plan = null
    this.generation += 1
    this.revision += 1
  }

  /**
   * Dispatch ready nodes up to the unused concurrency slots.
   *
   * Called when the Leader (or an explicit retry/add) asks to start work — not
   * automatically after a sibling settles.
   */
  private pump(parent: Agent): string[] {
    const plan = this.plan
    if (plan === null) return []
    if (this.subagents === undefined) {
      this.refreshPlanStatus()
      return []
    }
    if (plan.confirm !== null) {
      this.refreshPlanStatus()
      return []
    }

    const running = [...plan.nodes.values()].filter((node) => node.status === 'running').length
    let budget = plan.concurrency - running
    const started: string[] = []

    for (const id of readyIds(this.ordered(), (nodeId) => this.statusOf(nodeId))) {
      if (budget <= 0) break
      const node = plan.nodes.get(id)
      if (node === undefined || node.status !== 'pending') continue
      if (this.dispatch(node, parent)) {
        started.push(id)
        budget -= 1
      }
    }

    this.refreshPlanStatus()
    return started
  }

  /** Start one child agent for a node. Returns false when it could not start. */
  private dispatch(node: RuntimeNode, parent: Agent): boolean {
    const seam = this.subagents
    const plan = this.plan
    if (seam === undefined || plan === null) return false

    // Capture the generation this dispatch belongs to. If the plan is replaced
    // before the child settles, the settlement is stale and must be dropped.
    const generation = this.generation
    const controller = new AbortController()

    // How `dispose` and the settlement promise share the published run: the
    // handle exists only after `start` resolves, but a cancel may arrive before
    // that. The signal covers the pre-publication window (start rejects), and
    // the run's own `dispose` covers everything after.
    const handle: { run: SubagentRunLike | null } = { run: null }
    const state: { childId: string | null } = { childId: null }

    const settlement = (async (): Promise<ChildOutcome> => {
      const started = await seam.start(DEFAULT_PROVIDER, {
        label: node.spec.title,
        prompt: [{ type: 'text', text: this.buildPrompt(node) }],
        parent,
        signal: controller.signal,
        ...(node.spec.persona !== undefined ? { persona: node.spec.persona } : {}),
        ...(node.spec.toolFilter !== undefined ? { toolFilter: { ...node.spec.toolFilter } } : {}),
      })
      handle.run = started
      state.childId = started.id
      const outcome = await started.result
      return {
        stopReason: outcome.stopReason,
        output: textOf(outcome.output),
        diagnostic: outcome.diagnostic ?? null,
      }
    })()

    const run: DispatchedRun = {
      get childId(): string | null {
        return state.childId
      },
      set childId(value: string | null) {
        state.childId = value
      },
      dispose: async () => {
        controller.abort()
        const started = handle.run
        if (started !== null) {
          try {
            await started.dispose()
          } catch {
            // Teardown is best effort; the settlement promise still resolves.
          }
        }
      },
      result: settlement,
    }

    node.run = run
    node.status = 'running'
    node.attempts += 1
    node.updatedAt = new Date().toISOString()
    plan.updatedAt = new Date().toISOString()
    this.revision += 1

    // A child-level failure resolves with a non-completed stop reason rather
    // than rejecting; only an infrastructure fault reaches `catch`. A stale
    // settlement (plan replaced or cleared while the child ran) is dropped
    // outright — its node no longer exists.
    void run.result
      .then((outcome) => {
        if (generation !== this.generation) return
        const ok = outcome.stopReason === 'completed'
        const next = ok && this.childrenOf(node.spec.id).length > 0 ? 'expanded' : (ok ? 'done' : 'failed')
        this.settle(node, next, outcome.output, outcome.diagnostic)
        this.onSettled(node, outcome)
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return
        this.settle(node, 'failed', null, `dispatch failed: ${messageOf(error)}`)
        this.onSettled(node, null)
      })

    return true
  }

  /**
   * After any node settles: refresh the graph and wake the Leader.
   *
   * Do not start the next step here. Sequential review is the point — the
   * Leader inspects the result and calls `flow.next` when it wants to continue.
   */
  private onSettled(node: RuntimeNode, _outcome: ChildOutcome | null): void {
    const plan = this.plan
    if (plan === null) return
    this.revision += 1
    this.closeExpandedParents()
    if (
      node.spec.confirm === true
      && (node.status === 'done' || node.status === 'expanded')
      && plan.confirm === null
    ) {
      plan.confirm = {
        question: `「${node.spec.title}」已完成，是否继续？`,
        nodeId: node.spec.id,
      }
    }
    this.refreshPlanStatus()

    const key = `${node.spec.id}@${node.attempts}`
    if (this.woken.has(key)) return
    this.woken.add(key)

    const running = [...plan.nodes.values()].filter((item) => item.status === 'running').length
    if (!shouldWakeLeader({
      newlyFailed: node.status === 'failed',
      remaining: this.remainingCount(),
      running,
    })) return

    this.scheduleWake(plan.parent)
  }

  /**
   * Merge nearby settlements into a single followup.
   *
   * Parallel children often finish in the same second; without a short delay
   * each would queue its own Leader turn.
   */
  private scheduleWake(parent: Agent): void {
    this.wakePending = true
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer)
    const generation = this.generation
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      if (generation !== this.generation || !this.wakePending) return
      this.wakePending = false
      this.wake(parent, this.describeWave())
    }, 400)
  }

  private cancelWake(): void {
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    this.wakePending = false
  }

  /**
   * Hand the Leader a compact account of the current wave.
   *
   * Best effort: the canvas is the primary UI, and a failed wake must never
   * strand the plan. Results stay in the graph for the next `flow.status`.
   */
  private wake(parent: Agent, text: string): void {
    try {
      const agents = this.ctx.get('agents') as { get(id: unknown): WakeableAgent | undefined } | undefined
      const live = agents?.get(parent.id)
      if (live === undefined || typeof live.followup !== 'function') return

      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-flow', form: 'notice', summary: truncate(text, 120) },
      })
      live.followup(message)
    } catch {
      // The Flow tab already shows the outcome; a missed wake is not fatal.
    }
  }

  private describeWave(): string {
    const plan = this.plan
    if (plan === null) return 'The flow plan was cleared.'
    const remaining = this.remainingCount()
    const confirmLine = plan.confirm !== null
      ? `Human confirmation is pending${plan.confirm.nodeId !== null ? ` (${plan.confirm.nodeId})` : ''}: ${plan.confirm.question} Tell the user, then stop. Do not call flow.next until they answer.`
      : remaining === 0
        ? 'Every node has settled. Call flow.status, then summarise for the user in one reply.'
        : `${remaining} node(s) still outstanding. Call flow.status, inspect the result, then flow.next to start the next ready step — or flow.patch if it failed. Call flow.confirm only when you need a human decision.`
    const lines = [
      `Flow update — plan "${plan.title}" is ${plan.status}.`,
      confirmLine,
      '',
    ]
    for (const id of plan.order) {
      const node = plan.nodes.get(id)
      if (node === undefined) continue
      let extra = ''
      if (node.status === 'failed') extra = ` — ${node.diagnostic ?? 'unknown'}`
      lines.push(`- ${node.spec.id} [${node.status}] ${node.spec.title}${extra}`)
    }
    return lines.join('\n')
  }

  private remainingCount(): number {
    const plan = this.plan
    if (plan === null) return 0
    return [...plan.nodes.values()].filter((node) => !SETTLED_STATUSES.includes(node.status)).length
  }

  private settle(node: RuntimeNode, status: NodeStatus, output: string | null, diagnostic: string | null): void {
    node.status = status
    node.run = null
    const stored = output === null || output.trim() === '' ? null : truncate(output, OUTPUT_STORE_LIMIT)
    node.output = stored
    node.summary = stored === null ? null : truncate(stored, SUMMARY_LIMIT)
    node.diagnostic = diagnostic
    node.updatedAt = new Date().toISOString()
    if (this.plan !== null) this.plan.updatedAt = node.updatedAt
  }

  private refreshPlanStatus(): void {
    const plan = this.plan
    if (plan === null) return
    const statuses = [...plan.nodes.values()].map((node) => node.status)
    if (statuses.some((status) => status === 'running' || status === 'ready')) {
      plan.status = 'running'
      return
    }
    plan.status = statuses.every((status) => SETTLED_STATUSES.includes(status)) ? 'settled' : 'idle'
  }

  private async disposeNode(node: RuntimeNode): Promise<void> {
    const run = node.run
    node.run = null
    if (run === null) return
    try {
      await run.dispose()
    } catch {
      // Teardown is best effort; the run's own settlement already ran.
    }
  }

  private disposeCurrentPlan(): void {
    this.cancelWake()
    const plan = this.plan
    if (plan === null) return
    for (const node of plan.nodes.values()) {
      if (node.run !== null) void this.disposeNode(node)
    }
  }

  private ordered(): readonly { id: string; deps: readonly string[] }[] {
    const plan = this.plan
    if (plan === null) return []
    const out: { id: string; deps: readonly string[]; parentId?: string }[] = []
    for (const id of plan.order) {
      const node = plan.nodes.get(id)
      if (node !== undefined) {
        out.push({
          id,
          deps: node.spec.deps,
          ...(node.spec.parentId !== undefined ? { parentId: node.spec.parentId } : {}),
        })
      }
    }
    return out
  }

  private statusOf(id: string): NodeStatus {
    return this.plan?.nodes.get(id)?.status ?? 'pending'
  }

  private childrenOf(id: string): RuntimeNode[] {
    const plan = this.plan
    if (plan === null) return []
    return [...plan.nodes.values()].filter((node) => node.spec.parentId === id)
  }

  private parentDepth(id: string): number {
    const plan = this.plan
    if (plan === null) return 0
    let depth = 0
    let current: string | undefined = id
    const seen = new Set<string>()
    while (current !== undefined && current !== '') {
      if (seen.has(current)) break
      seen.add(current)
      const next: string | undefined = plan.nodes.get(current)?.spec.parentId
      if (next === undefined || next === '') break
      depth += 1
      current = next
    }
    return depth
  }

  /** Nodes that already have children never run themselves — they are containers. */
  private markContainers(): void {
    const plan = this.plan
    if (plan === null) return
    for (const node of plan.nodes.values()) {
      if (node.status !== 'pending') continue
      if (this.childrenOf(node.spec.id).length === 0) continue
      node.status = 'expanded'
    }
  }

  /** An expanded parent becomes `done` once every child has settled. */
  private closeExpandedParents(): void {
    const plan = this.plan
    if (plan === null) return
    let changed = true
    while (changed) {
      changed = false
      for (const node of plan.nodes.values()) {
        if (node.status !== 'expanded') continue
        const children = this.childrenOf(node.spec.id)
        if (children.length === 0) continue
        if (!children.every((child) => SETTLED_STATUSES.includes(child.status))) continue
        node.status = 'done'
        if (node.summary === null) node.summary = 'subtree completed'
        node.updatedAt = new Date().toISOString()
        changed = true
      }
    }
  }

  private insertNode(spec: FlowNodeSpec): { ok: boolean; message: string | null } {
    const plan = this.plan
    if (plan === null) return { ok: false, message: 'no plan is active' }
    if (plan.nodes.has(spec.id)) return { ok: false, message: `node "${spec.id}" already exists` }
    if (spec.deps.includes(spec.id)) return { ok: false, message: `node "${spec.id}" depends on itself` }
    for (const dep of spec.deps) {
      if (!plan.nodes.has(dep)) return { ok: false, message: `node "${spec.id}" depends on unknown node "${dep}"` }
    }
    if (spec.parentId !== undefined && spec.parentId !== '') {
      if (spec.parentId === spec.id) return { ok: false, message: `node "${spec.id}" cannot be its own parent` }
      if (!plan.nodes.has(spec.parentId)) return { ok: false, message: `unknown parent "${spec.parentId}"` }
      if (this.parentDepth(spec.parentId) >= 3) {
        return { ok: false, message: `node "${spec.id}" would nest deeper than 4 levels` }
      }
    }
    for (const dep of spec.deps) {
      if (this.dependsOn(dep, spec.id)) {
        return { ok: false, message: `adding "${spec.id}" would create a cycle through "${dep}"` }
      }
    }

    const now = new Date().toISOString()
    plan.nodes.set(spec.id, {
      spec: normalizeSpec(spec),
      status: 'pending',
      run: null,
      output: null,
      summary: null,
      diagnostic: null,
      notes: [],
      updatedAt: now,
      attempts: 0,
    })
    plan.order.push(spec.id)
    plan.updatedAt = now
    if (plan.status === 'settled') plan.status = 'idle'
    return { ok: true, message: null }
  }

  /**
   * The brief handed to the child.
   *
   * Children run in their own context, so the brief must be self-contained.
   * We add the upstream results the Leader declared — that is what makes a DAG
   * more useful than a flat task list.
   */
  private buildPrompt(node: RuntimeNode): string {
    const plan = this.plan
    const lines: string[] = [`# Task: ${node.spec.title}`, '', node.spec.prompt.trim()]

    if (plan !== null && node.spec.deps.length > 0) {
      const upstream: string[] = []
      for (const dep of node.spec.deps) {
        const depNode = plan.nodes.get(dep)
        if (depNode === undefined) continue
        const outcome = depNode.status === 'done'
          ? truncate(depNode.output ?? depNode.summary ?? '(no output)', UPSTREAM_LIMIT)
          : depNode.status === 'skipped' ? '(skipped by the Leader)' : '(not settled)'
        upstream.push(`- ${depNode.spec.title} (${dep}): ${outcome}`)
      }
      if (upstream.length > 0) {
        lines.push('', '## Upstream steps', '', ...upstream)
      }
    }

    lines.push('', CHILD_EXPAND_HINT)
    lines.push('', CHILD_REPORT_HINT)
    lines.push(
      '',
      '## Output contract',
      'Answer with only the result of this one step. Do not plan beyond it and do not modify unrelated files.',
    )
    return lines.join('\n')
  }

  /** Column index per node, exported for the canvas layout. */
  layout(): Map<string, number> {
    return depthOf(this.ordered())
  }
}

function normalizeSpec(spec: FlowNodeSpec): FlowNodeSpec {
  const deps = Array.isArray(spec.deps) ? [...new Set(spec.deps.filter((dep) => typeof dep === 'string'))] : []
  return {
    id: spec.id,
    title: spec.title.trim(),
    prompt: spec.prompt,
    deps,
    ...(spec.parentId !== undefined && spec.parentId !== '' ? { parentId: spec.parentId } : {}),
    ...(spec.persona !== undefined ? { persona: spec.persona } : {}),
    ...(spec.confirm === true ? { confirm: true } : {}),
    ...(spec.toolFilter !== undefined ? { toolFilter: { ...spec.toolFilter } } : {}),
  }
}

function textOf(blocks: readonly { type: string; text?: string }[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n\n').trim()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function renderFocused(node: RuntimeNode): string {
  const lines = [
    `${node.spec.id} [${node.status}] ${node.spec.title}`,
    node.spec.deps.length === 0 ? 'deps: (none)' : `deps: ${node.spec.deps.join(', ')}`,
  ]
  if (node.diagnostic !== null) lines.push(`failure: ${node.diagnostic}`)
  const body = node.output ?? node.summary
  if (body !== null && body !== '') {
    lines.push('', 'output:', body)
  }
  return truncate(lines.join('\n'), STATUS_FOCUS_LIMIT)
}

function indent(value: string): string {
  return value.split('\n').map((line) => `      ${line}`).join('\n')
}
