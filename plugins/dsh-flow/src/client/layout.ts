/**
 * Canvas geometry: turn the plan's dependency edges into stable x/y columns.
 *
 * Layout must be *stable* — the canvas polls the host, and a layout that
 * reshuffles on every poll makes the graph unreadable. So x comes from the
 * topological depth (deterministic) and y from the plan's own insertion order
 * (also deterministic), never from a force simulation or from object iteration.
 */
import type { FlowNodeView } from '../shared.ts'

export interface LaidOutNode {
  readonly node: FlowNodeView
  readonly x: number
  readonly y: number
}

const COLUMN_WIDTH = 300
const ROW_HEIGHT = 140
const ORIGIN_X = 24
const ORIGIN_Y = 24

/**
 * Assign each node a column by its longest dependency path, then stack nodes
 * within a column in plan order.
 */
export function layoutNodes(nodes: readonly FlowNodeView[]): LaidOutNode[] {
  const depths = computeDepths(nodes)
  const rowOf = new Map<string, number>()

  // Reserve rows column by column so a node never lands on top of a node in
  // the same column, and so column height stays balanced across columns.
  const rowCursor = new Map<number, number>()
  const placed: LaidOutNode[] = []

  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0
    const row = rowCursor.get(depth) ?? 0
    rowCursor.set(depth, row + 1)
    rowOf.set(node.id, row)
    placed.push({
      node,
      x: ORIGIN_X + depth * COLUMN_WIDTH,
      y: ORIGIN_Y + row * ROW_HEIGHT,
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
