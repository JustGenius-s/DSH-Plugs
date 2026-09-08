/**
 * Host-only runtime state.
 *
 * This module holds live objects — the parent Agent, `SubagentRun` handles,
 * abort controllers — so it must never be imported by the Client half and its
 * values must never cross the HTTP boundary. The wire vocabulary lives in
 * `./shared.ts`.
 */
import type { Agent } from '@just-genius/dsh-plugin-runtime/host'
import type { FlowConfirmRequest, FlowNodeSpec, FlowNote, FlowPlanStatus, NodeStatus } from './shared.ts'

/**
 * The live handle of one dispatched child.
 *
 * `result` is the authoritative settlement source. We deliberately do NOT rely
 * on the `subagent/end` event: that event dispatches scoped to the delegating
 * parent, so a plugin-level listener cannot count on receiving it, while the
 * promise we already hold settles regardless.
 */
export interface DispatchedRun {
  /**
   * The child agent's session id.
   *
   * Filled in asynchronously: `subagents.start` resolves only after the child
   * is published, but the node is already `running` by then, so the canvas can
   * see `running` before a child id exists.
   */
  childId: string | null
  /** Cancels remaining child work and releases resources; idempotent. */
  readonly dispose: () => Promise<void>
  /** Never rejects for a child-level failure — it resolves with a stop reason. */
  readonly result: Promise<ChildOutcome>
}

/** The settlement facts we keep; a projection of `SubagentResult`. */
export interface ChildOutcome {
  readonly stopReason: string
  readonly output: string
  readonly diagnostic: string | null
}

/** Execution state of one node, alongside its model-authored spec. */
export interface RuntimeNode {
  /** Rewritten in place when the Leader patches a settled node's brief. */
  spec: FlowNodeSpec
  status: NodeStatus
  /** Live run, present only while `status === 'running'`. */
  run: DispatchedRun | null
  /** Full child output, capped only by `OUTPUT_STORE_LIMIT`. */
  output: string | null
  /** Truncated projection of `output` for the canvas. */
  summary: string | null
  diagnostic: string | null
  /** Progress notes the running child posted via `flow.report`. */
  notes: FlowNote[]
  updatedAt: string
  attempts: number
}

/** One plan as the Host drives it. */
export interface RuntimePlan {
  readonly id: string
  title: string
  status: FlowPlanStatus
  concurrency: number
  readonly nodes: Map<string, RuntimeNode>
  /** Insertion order, preserved so the canvas stays stable between polls. */
  readonly order: string[]
  readonly createdAt: string
  updatedAt: string
  /** Set only when a human decision is required before the next dispatch. */
  confirm: FlowConfirmRequest | null
  /**
   * The Agent that owns this plan — the parent of every child it dispatches.
   * Captured at plan time because `subagents.start` requires a live parent.
   */
  readonly parent: Agent
}
