/**
 * Pure graph algebra over a plan: validation and readiness.
 *
 * Deliberately free of Host services, live agents, and I/O so the scheduler's
 * rules stay testable and the Client half can reuse the same layout math.
 */
import { type FlowNodeSpec, type FlowPlanSpec, type NodeStatus } from './shared.ts'

export { waitingForConfirm } from './shared.ts'

/** Why a plan spec was rejected. */
export type PlanRejection =
  | { readonly code: 'empty'; readonly message: string }
  | { readonly code: 'duplicate-id'; readonly message: string; readonly id: string }
  | { readonly code: 'unknown-dep'; readonly message: string; readonly id: string; readonly dep: string }
  | { readonly code: 'unknown-parent'; readonly message: string; readonly id: string; readonly parentId: string }
  | { readonly code: 'self-dep'; readonly message: string; readonly id: string }
  | { readonly code: 'cycle'; readonly message: string; readonly path: readonly string[] }
  | { readonly code: 'blank'; readonly message: string; readonly id: string }

export type ValidatedPlan =
  | { readonly ok: true; readonly plan: FlowPlanSpec }
  | { readonly ok: false; readonly rejection: PlanRejection }

/**
 * Accept a plan spec or explain exactly why it cannot be scheduled.
 *
 * Rejecting here is the point: a plan the scheduler cannot drive must fail in
 * the Leader's tool result, where the model can fix it, rather than half-run.
 */
export function validatePlan(spec: FlowPlanSpec): ValidatedPlan {
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    return { ok: false, rejection: { code: 'empty', message: 'plan needs at least one node' } }
  }

  const seen = new Set<string>()
  for (const node of spec.nodes) {
    if (typeof node.id !== 'string' || node.id.trim() === '') {
      return { ok: false, rejection: { code: 'blank', message: 'every node needs a non-empty id', id: String(node.id) } }
    }
    if (seen.has(node.id)) {
      return { ok: false, rejection: { code: 'duplicate-id', message: `duplicate node id "${node.id}"`, id: node.id } }
    }
    seen.add(node.id)
    if (typeof node.title !== 'string' || node.title.trim() === '') {
      return { ok: false, rejection: { code: 'blank', message: `node "${node.id}" needs a non-empty title`, id: node.id } }
    }
    if (typeof node.prompt !== 'string' || node.prompt.trim() === '') {
      return { ok: false, rejection: { code: 'blank', message: `node "${node.id}" needs a non-empty prompt`, id: node.id } }
    }
  }

  for (const node of spec.nodes) {
    for (const dep of node.deps) {
      if (dep === node.id) {
        return { ok: false, rejection: { code: 'self-dep', message: `node "${node.id}" depends on itself`, id: node.id } }
      }
      if (!seen.has(dep)) {
        return { ok: false, rejection: { code: 'unknown-dep', message: `node "${node.id}" depends on unknown node "${dep}"`, id: node.id, dep } }
      }
    }
    if (node.parentId !== undefined && node.parentId !== '') {
      if (node.parentId === node.id) {
        return { ok: false, rejection: { code: 'self-dep', message: `node "${node.id}" cannot be its own parent`, id: node.id } }
      }
      if (!seen.has(node.parentId)) {
        return {
          ok: false,
          rejection: {
            code: 'unknown-parent',
            message: `node "${node.id}" has unknown parent "${node.parentId}"`,
            id: node.id,
            parentId: node.parentId,
          },
        }
      }
    }
  }

  const cycle = findCycle(spec.nodes)
  if (cycle !== null) {
    return { ok: false, rejection: { code: 'cycle', message: `dependency cycle: ${cycle.join(' → ')}`, path: cycle } }
  }

  return { ok: true, plan: spec }
}

/**
 * Return one dependency cycle as a node path, or `null` when the graph is a DAG.
 *
 * A node that is skipped counts as settled for its dependents, so cycles are a
 * property of the dependency edges alone — never of runtime outcomes.
 */
export function findCycle(nodes: readonly FlowNodeSpec[]): readonly string[] | null {
  const edges = new Map<string, string[]>()
  for (const node of nodes) {
    const inbound = [...node.deps]
    if (node.parentId !== undefined && node.parentId !== '') inbound.push(node.parentId)
    edges.set(node.id, inbound)
  }

  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const node of nodes) color.set(node.id, WHITE)

  const stack: string[] = []

  const visit = (id: string): readonly string[] | null => {
    color.set(id, GREY)
    stack.push(id)
    for (const dep of edges.get(id) ?? []) {
      const depColor = color.get(dep) ?? BLACK
      if (depColor === GREY) {
        // Re-entering a node still on the stack closes a cycle; slice from its
        // first appearance so the reported path starts at the cycle.
        return [...stack.slice(stack.indexOf(dep)), dep]
      }
      if (depColor === WHITE) {
        const found = visit(dep)
        if (found !== null) return found
      }
    }
    stack.pop()
    color.set(id, BLACK)
    return null
  }

  for (const node of nodes) {
    if ((color.get(node.id) ?? WHITE) === WHITE) {
      const found = visit(node.id)
      if (found !== null) return found
    }
  }
  return null
}

/** A node as the scheduler sees it — deps plus an optional parent. */
export interface GraphNode {
  readonly id: string
  readonly deps: readonly string[]
  readonly parentId?: string
}

/**
 * Whether `id` and every descendant have finished.
 *
 * An `expanded` parent is a container: dependents of that parent wait until
 * every child under it is done or skipped. A skipped parent does not wait
 * on children (the Leader dropped the subtree).
 */
export function subtreeSettled(
  id: string,
  nodes: readonly GraphNode[],
  statusOf: (id: string) => NodeStatus,
  guard: Set<string> = new Set(),
): boolean {
  if (guard.has(id)) return false
  guard.add(id)
  const status = statusOf(id)
  const children = nodes.filter((node) => node.parentId === id)
  if (status === 'skipped') return true
  if (status === 'failed' || status === 'pending' || status === 'running' || status === 'ready') return false
  if (status === 'expanded') {
    return children.length > 0 && children.every((child) => subtreeSettled(child.id, nodes, statusOf, guard))
  }
  if (status === 'done') {
    return children.every((child) => subtreeSettled(child.id, nodes, statusOf, guard))
  }
  return false
}

/** Node ids whose dependencies (and parent, if any) have all settled. */
export function readyIds(
  nodes: readonly GraphNode[],
  statusOf: (id: string) => NodeStatus,
): string[] {
  const ready: string[] = []
  for (const node of nodes) {
    if (statusOf(node.id) !== 'pending') continue
    if (node.parentId !== undefined && node.parentId !== '') {
      const parentStatus = statusOf(node.parentId)
      if (parentStatus !== 'expanded' && parentStatus !== 'done') continue
    }
    const settled = node.deps.every((dep) => subtreeSettled(dep, nodes, statusOf))
    if (settled) ready.push(node.id)
  }
  return ready
}

/** Longest-path depth per node, used by the canvas to lay out columns. */
export function depthOf(
  nodes: readonly GraphNode[],
): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const depths = new Map<string, number>()

  const resolve = (id: string, guard: Set<string>): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return 0
    guard.add(id)
    const node = byId.get(id)
    let depth = 0
    if (node !== undefined) {
      const inbound = [
        ...node.deps,
        ...(node.parentId !== undefined && node.parentId !== '' ? [node.parentId] : []),
      ]
      for (const dep of inbound) {
        depth = Math.max(depth, resolve(dep, guard) + 1)
      }
    }
    guard.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const node of nodes) resolve(node.id, new Set())
  return depths
}
