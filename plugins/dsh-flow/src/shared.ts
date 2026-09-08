/**
 * Wire vocabulary shared by the Host orchestrator and the browser canvas.
 *
 * Everything here must stay lossless JSON: it crosses the HTTP boundary as-is.
 * Host-only runtime state (live `SubagentRun` handles, abort controllers, the
 * parent Agent) never appears in this module — see `./types.ts`.
 */

/** HTTP routes the Host half registers and the Client half calls. */
export const STATE_PATH = '/api/dsh-flow/state'
export const ACTION_PATH = '/api/dsh-flow/action'
export const MODE_PATH = '/api/dsh-flow/mode'

/** The slash command that turns Flow mode on and off. */
export const FLOW_COMMAND = 'flow'

/**
 * Lifecycle of one graph node.
 *
 * - `pending`  — waiting on dependencies that have not settled yet
 * - `ready`    — dependencies settled, waiting for the Leader to call flow.next
 * - `running`  — a child agent owns this node right now
 * - `done`     — child settled with `stopReason: 'completed'`
 * - `failed`   — child settled any other way (`error`, `aborted`, `refusal`, `max-tokens`)
 * - `skipped`  — the Leader dropped this node; it never runs and never blocks
 */
export type NodeStatus = 'pending' | 'ready' | 'running' | 'expanded' | 'done' | 'failed' | 'skipped'

/** A node status that lets its dependents proceed. */
export const SETTLED_STATUSES: readonly NodeStatus[] = ['done', 'skipped']

/** The model-authored shape of one step. */
export interface FlowNodeSpec {
  /** Caller-chosen stable id, unique inside one plan. Referenced by `deps`. */
  readonly id: string
  /** One-line label shown on the canvas. */
  readonly title: string
  /** The complete, self-contained brief handed to the child agent. */
  readonly prompt: string
  /** Ids that must reach a settled state before this node may start. */
  readonly deps: readonly string[]
  /**
   * Optional parent node. Children are the next level of work under that
   * parent — they run only after the parent has expanded (or already finished).
   */
  readonly parentId?: string
  /** Optional per-node persona override for the child. */
  readonly persona?: string
  /**
   * When true, settling this node pauses the plan until a human confirms.
   * Ordinary nodes do not wait — only planned or requested gates do.
   */
  readonly confirm?: boolean
  /** Optional per-node tool scoping for the child. */
  readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
}

/** The model-authored shape of one plan. */
export interface FlowPlanSpec {
  /** Short human-facing name for this plan (also the canvas heading). */
  readonly title: string
  readonly nodes: readonly FlowNodeSpec[]
  /** Maximum concurrently running children. Clamped by the Host. */
  readonly concurrency?: number
}

/** One progress note a running child posted through `flow.report`. */
export interface FlowNote {
  readonly text: string
  /** ISO timestamp, so the canvas can render a timeline. */
  readonly at: string
}

/** A node as the canvas renders it: the spec plus everything execution added. */
export interface FlowNodeView extends FlowNodeSpec {
  readonly status: NodeStatus
  /** The child agent's session id, once dispatched. Stable for the node's life. */
  readonly childId: string | null
  /** Truncated child output, present once the node settles. */
  readonly summary: string | null
  /** Provider-authored failure detail for a `failed` node. */
  readonly diagnostic: string | null
  /** Progress notes the running child reported, oldest first. */
  readonly notes: readonly FlowNote[]
  /** ISO timestamp of the last status change. */
  readonly updatedAt: string
  /** How many times this node has been dispatched (a retry starts a new run). */
  readonly attempts: number
}

/** A pending human gate, set by the Leader, a child, or a node marked `confirm`. */
export interface FlowConfirmRequest {
  readonly question: string
  readonly nodeId: string | null
}

/** The whole plan as the canvas renders it. */
export interface FlowPlanView {
  readonly id: string
  readonly title: string
  readonly status: FlowPlanStatus
  readonly concurrency: number
  readonly nodes: readonly FlowNodeView[]
  readonly createdAt: string
  readonly updatedAt: string
  /** Present only when a human decision is required before the next dispatch. */
  readonly confirm: FlowConfirmRequest | null
}

/**
 * Plan-level rollup. `idle` before the first dispatch, `running` while any
 * child is live, `settled` once every node reached a terminal status.
 */
export type FlowPlanStatus = 'idle' | 'running' | 'settled'

/** What `GET STATE_PATH` returns for one session. */
export interface FlowStateResponse {
  readonly plan: FlowPlanView | null
  /** Whether Flow mode is on for this session. */
  readonly mode: boolean
  /** The staged mode target, or `null` when no switch is pending. */
  readonly modePending: boolean | null
  /** True when the Host half could not reach the subagent service. */
  readonly degraded: boolean
  /** Human-readable reason for `degraded`. */
  readonly degradedReason: string | null
}

/** Mutations the orchestrator applies to a plan. */
export type FlowAction =
  | { readonly kind: 'retry'; readonly nodeId: string }
  | { readonly kind: 'skip'; readonly nodeId: string }
  | { readonly kind: 'cancel'; readonly nodeId: string }
  | { readonly kind: 'next' }
  | { readonly kind: 'clear' }

/**
 * Anything the canvas may POST to the action route: plan mutations plus the
 * mode switch, which the orchestrator does not own.
 */
export type FlowRequest = FlowAction | { readonly kind: 'setMode'; readonly on: boolean }

/** Result envelope for `POST ACTION_PATH`. */
export interface FlowActionResult {
  readonly ok: boolean
  readonly message: string | null
}

/** Repository convention: the `{ ok, value | message }` envelope. */
export interface HttpResult<T> {
  ok: boolean
  value?: T
  message?: string
}

/** Clamp applied to every `concurrency` request. */
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 8
export const CONCURRENCY_DEFAULT = 1

/** Truncation applied to child output before it crosses the HTTP wire. */
export const SUMMARY_LIMIT = 2000
export const PROMPT_PREVIEW_LIMIT = 2000
/** Safety cap on host-held child output (one node). */
export const OUTPUT_STORE_LIMIT = 200_000
/** Per-node result size in `flow.status` (whole-graph view). */
export const STATUS_RESULT_LIMIT = 12_000
/** Cap for the entire `flow.status` report. */
export const STATUS_TOTAL_LIMIT = 48_000
/** Cap when `flow.status` focuses a single node. */
export const STATUS_FOCUS_LIMIT = 80_000
/** How much upstream output a child brief may carry. */
export const UPSTREAM_LIMIT = 16_000
/** One progress note is a headline, not a paragraph. */
export const NOTE_TEXT_LIMIT = 200
/**
 * Notes kept per node attempt; the oldest drop off beyond this.
 *
 * Sized for action-granularity narration (one note per meaningful tool call),
 * not milestone summaries — a long node can legitimately produce dozens.
 */
export const NOTE_MAX = 50

export function clampConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CONCURRENCY_DEFAULT
  const rounded = Math.trunc(value)
  if (rounded < CONCURRENCY_MIN) return CONCURRENCY_MIN
  if (rounded > CONCURRENCY_MAX) return CONCURRENCY_MAX
  return rounded
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}…`
}

/** True only when someone asked for a human gate — not after every step. */
export function waitingForConfirm(plan: FlowPlanView): boolean {
  return plan.confirm !== null
}
