import type { GitGraphRow } from '../../../shared/git-graph'

export interface LaidOutNode {
  row: GitGraphRow
  column: number
  lanesBefore: readonly (string | null)[]
  lanesAfter: readonly (string | null)[]
  parentLanes: readonly number[]
}

export interface GraphEdge {
  fromRow: number
  fromCol: number
  toRow: number
  toCol: number
}

export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: GraphEdge[]
  laneCount: number
}

/**
 * Newest-first lane assignment. A lane holds the sha it is waiting to meet;
 * the first parent continues in the commit's column, extra parents open lanes,
 * and other waiters for the same sha collapse into the leftmost column.
 */
export function layoutGraph(rows: readonly GitGraphRow[]): GraphLayout {
  const lanes: (string | null)[] = []
  const nodes: LaidOutNode[] = []

  for (const row of rows) {
    const lanesBefore = lanes.slice()
    let column = lanes.findIndex((sha) => sha === row.sha)
    if (column === -1) {
      column = firstEmpty(lanes)
      if (column === -1) {
        column = lanes.length
        lanes.push(row.sha)
      } else {
        lanes[column] = row.sha
      }
    }

    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === row.sha && index !== column) lanes[index] = null
    }

    const parentLanes: number[] = []
    row.parents.forEach((parent, parentIndex) => {
      if (parentIndex === 0) {
        lanes[column] = parent
        parentLanes.push(column)
        return
      }
      let dest = lanes.findIndex((sha, index) => sha === parent && index !== column)
      if (dest === -1) {
        dest = firstEmpty(lanes)
        if (dest === -1) {
          dest = lanes.length
          lanes.push(parent)
        } else {
          lanes[dest] = parent
        }
      }
      parentLanes.push(dest)
    })
    if (row.parents.length === 0) lanes[column] = null

    nodes.push({
      row,
      column,
      lanesBefore,
      lanesAfter: lanes.slice(),
      parentLanes,
    })
  }

  const edges = buildEdges(nodes)
  const laneCount = nodes.reduce((max, node) => {
    return Math.max(max, node.lanesBefore.length, node.lanesAfter.length, node.column + 1)
  }, 1)
  return { nodes, edges, laneCount }
}

function buildEdges(nodes: readonly LaidOutNode[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const next = nodes[index + 1]
    node.lanesBefore.forEach((sha, column) => {
      if (sha === null || sha === node.row.sha) return
      edges.push({
        fromRow: index,
        fromCol: column,
        toRow: index + 1,
        toCol: destColumn(next, sha, column),
      })
    })
    for (const parentLane of node.parentLanes) {
      const parentSha = node.lanesAfter[parentLane]
      edges.push({
        fromRow: index,
        fromCol: node.column,
        toRow: index + 1,
        toCol: parentSha === undefined || parentSha === null
          ? parentLane
          : destColumn(next, parentSha, parentLane),
      })
    }
  }
  return edges
}

function destColumn(
  next: LaidOutNode | undefined,
  sha: string,
  fallback: number,
): number {
  if (next === undefined) return fallback
  if (next.row.sha === sha) return next.column
  const found = next.lanesBefore.findIndex((value) => value === sha)
  return found === -1 ? fallback : found
}

function firstEmpty(lanes: readonly (string | null)[]): number {
  return lanes.findIndex((sha) => sha === null)
}
