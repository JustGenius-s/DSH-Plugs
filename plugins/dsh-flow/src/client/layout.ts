/**
 * Canvas geometry: turn the plan's dependency edges into stable top-down rows.
 *
 * Layout must be *stable* — the canvas polls the host, and a layout that
 * reshuffles on every poll makes the graph unreadable. So y comes from the
 * topological depth (deterministic) and x from the plan's own insertion order
 * (also deterministic), never from a force simulation or from object iteration.
 */
import type { FlowNodeView } from '../shared.ts'

export interface LaidOutNode {
  readonly node: FlowNodeView
  readonly x: number
  readonly y: number
}

const COLUMN_WIDTH = 300
const ROW_HEIGHT = 180
const ORIGIN_X = 24
const ORIGIN_Y = 24

/**
 * Assign each node a row by its longest dependency path, then place nodes
 * within a row from left to right in plan order.
 */
export function layoutNodes(nodes: readonly FlowNodeView[]): LaidOutNode[] {
  const depths = computeDepths(nodes)
  // Reserve a separate column for each node at the same dependency depth.
  const columnCursor = new Map<number, number>()
  const placed: LaidOutNode[] = []

  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0
    const column = columnCursor.get(depth) ?? 0
    columnCursor.set(depth, column + 1)
    placed.push({
      node,
      x: ORIGIN_X + column * COLUMN_WIDTH,
      y: ORIGIN_Y + depth * ROW_HEIGHT,
    })
  }

  return placed
}

/** Longest-path depth per node id. Acyclic by construction (validated on plan). */
function computeDepths(nodes: readonly FlowNodeView[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const depths = new Map<string, number>()

  const resolve = (id: string, guard: Set<string>): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return 0
    guard.add(id)
    let depth = 0
    const node = byId.get(id)
    const inbound = [
      ...(node?.deps ?? []),
      ...(node?.parentId !== undefined ? [node.parentId] : []),
    ]
    for (const dep of inbound) {
      depth = Math.max(depth, resolve(dep, guard) + 1)
    }
    guard.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const node of nodes) resolve(node.id, new Set())
  return depths
}
