/**
 * Turn a Flow plan into React Flow nodes and edges.
 *
 * Layout and parent-edge rules stay here so the full tab and a later
 * mini-window share one conversion — not two copies of the DAG walk.
 */
import { MarkerType, type Edge, type Node } from 'reactflow'

import type { FlowNodeView, FlowPlanView } from '../shared.ts'
import { edgeClassFor } from './NodeCard.tsx'
import { layoutNodes } from './layout.ts'

/** Payload stored on every card node. */
export interface FlowCardData {
  readonly node: FlowNodeView
}

/** Nodes plus the dep / parent edges the canvas already draws. */
export interface FlowElements {
  readonly nodes: Node<FlowCardData>[]
  readonly edges: Edge[]
}

export interface ToFlowElementsOptions {
  readonly selectedId?: string | null
  readonly selectable?: boolean
  readonly draggable?: boolean
}

/**
 * Convert a plan view using the same layout and parent-edge rules as
 * the original Flow tab.
 */
export function toFlowElements(
  plan: FlowPlanView,
  options: ToFlowElementsOptions = {},
): FlowElements {
  const selectable = options.selectable ?? true
  const draggable = options.draggable ?? true
  const selectedId = options.selectedId ?? null

  const nodes = layoutNodes(plan.nodes).map(({ node, x, y }) => ({
    id: node.id,
    type: 'card' as const,
    position: { x, y },
    data: { node },
    draggable,
    selectable,
    selected: selectable && selectedId === node.id,
  }))

  return { nodes, edges: edgesFor(plan.nodes) }
}

/** Dep edges, plus a parent edge when parent is not already a dep. */
export function edgesFor(nodes: readonly FlowNodeView[]): Edge[] {
  const statusOf = new Map(nodes.map((node) => [node.id, node.status]))
  const out: Edge[] = []

  for (const node of nodes) {
    for (const dep of node.deps) {
      out.push(edgeOf(dep, node.id, statusOf.get(dep) ?? 'pending', false))
    }
    if (
      node.parentId !== undefined &&
      !node.deps.includes(node.parentId)
    ) {
      const parentStatus = statusOf.get(node.parentId) ?? 'pending'
      out.push(edgeOf(node.parentId, node.id, parentStatus, true))
    }
  }

  return out
}

function edgeOf(
  source: string,
  target: string,
  status: FlowNodeView['status'],
  parentLink: boolean,
): Edge {
  const running = status === 'running'
  const expanded = status === 'expanded'
  return {
    id: parentLink ? `${source}=>${target}` : `${source}->${target}`,
    source,
    target,
    className: edgeClassFor(status),
    animated: parentLink ? running || expanded : running,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  }
}
