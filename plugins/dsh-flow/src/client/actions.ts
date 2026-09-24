/**
 * Which card actions a node offers, and in what order.
 *
 * Kept as a pure function so the rules are testable without rendering: the
 * canvas only owns layout, the Host still owns the graph's topology, and what
 * is left is "given a status, what may the user do".
 *
 * The buttons a card shows are deliberately a subset of {@link FlowAction}:
 * `retry` and topology edits stay with the Leader, because re-dispatching a
 * node means rewriting its brief — a judgement, not a click.
 */
import type { FlowAction, NodeStatus } from '../shared.ts'

/** The node-scoped mutations the canvas can drive. */
export type NodeActionKind = 'skip' | 'cancel' | 'pause' | 'resume'

/**
 * Tone drives colour, and it is a property of the ACTION, not of the position:
 * skip is light blue, pause/resume is white, stopping is red. A button keeps
 * its colour wherever it appears, so the card never re-teaches the palette.
 */
export type NodeActionTone = 'accent' | 'neutral' | 'danger'

/** One button on a node card. */
export interface NodeAction {
  readonly kind: NodeActionKind
  readonly tone: NodeActionTone
}

const SKIP: NodeAction = { kind: 'skip', tone: 'accent' }
const PAUSE: NodeAction = { kind: 'pause', tone: 'neutral' }
const RESUME: NodeAction = { kind: 'resume', tone: 'neutral' }
const STOP: NodeAction = { kind: 'cancel', tone: 'danger' }

/**
 * The actions a card offers for one status, in display order.
 *
 * - `running` offers pause and stop — the two things that make sense while a
 *   child owns the node. Skipping a live child is a stop wearing a friendlier
 *   name, so it is not offered alongside them.
 * - `paused` offers skip and resume: the user suspended this child, so they
 *   decide whether it runs again or is abandoned.
 * - anything not yet terminal offers skip; `ready` also offers stop, because a
 *   queued node may be dispatched at any moment.
 * - terminal statuses offer nothing: `done`/`skipped` are over, and a `failed`
 *   node is the Leader's to retry or patch.
 */
export function actionsFor(status: NodeStatus): readonly NodeAction[] {
  switch (status) {
    case 'running': return [PAUSE, STOP]
    case 'paused': return [SKIP, RESUME]
    case 'ready': return [SKIP, STOP]
    case 'pending':
    case 'expanded': return [SKIP]
    default: return []
  }
}

/** The wire action one card button sends. */
export function actionFor(nodeId: string, action: NodeAction): FlowAction {
  return { kind: action.kind, nodeId }
}
