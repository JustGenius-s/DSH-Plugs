import { useEffect, useMemo, type MouseEvent } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from 'reactflow'

import { NodeCard } from './NodeCard.tsx'
import {
  toFlowElements,
  type FlowCardData,
  type FlowElements,
} from './toFlowElements.ts'
import type { FlowPlanView } from '../shared.ts'
import styles from './FlowCanvas.module.css'

export type FlowGraphVariant = 'full' | 'compact'

export interface FlowGraphProps {
  /** Converted with {@link toFlowElements} when `nodes`/`edges` are omitted. */
  readonly plan?: FlowPlanView | null
  /** Precomputed graph. Wins over `plan` when both are set. */
  readonly nodes?: FlowElements['nodes']
  readonly edges?: FlowElements['edges']
  /** `full` is the Flow tab chrome. `compact` is for a later mini-window. */
  readonly variant?: FlowGraphVariant
  /** Highlight this card (full tab). Ignored as chrome in compact. */
  readonly selectedId?: string | null
  /**
   * When this id changes (or the node first appears), keep that card
   * centered — the mini-window will pass the live step.
   */
  readonly focusNodeId?: string | null
  /**
   * Pan / zoom / drag. Defaults to `true` in `full` and `false` in
   * `compact` (parent then owns clicks).
   */
  readonly interactive?: boolean
  readonly onNodeClick?: NodeMouseHandler
  readonly onPaneClick?: (event: MouseEvent) => void
  readonly className?: string
}

function CardNode({ data, selected }: NodeProps<FlowCardData>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className={styles.handle}
      />
      <NodeCard node={data.node} selected={selected === true} />
      <Handle
        type="source"
        position={Position.Right}
        className={styles.handle}
      />
    </>
  )
}

const NODE_TYPES: NodeTypes = { card: CardNode as never }

const FULL_FIT = { padding: 0.2, maxZoom: 1 }
const COMPACT_FIT = { padding: 0.35, maxZoom: 0.75 }
const COMPACT_ZOOM = 0.7

/**
 * Shared React Flow renderer.
 *
 * Owns plan→elements conversion, the card node type, and chrome that
 * differs between the full tab and a compact overlay.
 */
export function FlowGraph(props: FlowGraphProps) {
  return (
    <ReactFlowProvider>
      <FlowGraphInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowGraphInner({
  plan = null,
  nodes: nodesProp,
  edges: edgesProp,
  variant = 'full',
  selectedId = null,
  focusNodeId = null,
  interactive,
  onNodeClick,
  onPaneClick,
  className,
}: FlowGraphProps) {
  const compact = variant === 'compact'
  const canInteract = interactive ?? !compact
  const showSelection = canInteract && !compact

  const base = useMemo<FlowElements>(() => {
    if (nodesProp !== undefined && edgesProp !== undefined) {
      return { nodes: nodesProp, edges: edgesProp }
    }
    if (plan !== null) return toFlowElements(plan)
    return { nodes: [], edges: [] }
  }, [nodesProp, edgesProp, plan])

  const nodes = useMemo<Node<FlowCardData>[]>(
    () =>
      base.nodes.map((node) => ({
        ...node,
        selected: showSelection && node.id === selectedId,
        selectable: showSelection,
        draggable: canInteract,
      })),
    [base.nodes, selectedId, showSelection, canInteract],
  )

  const fitViewOptions = compact ? COMPACT_FIT : FULL_FIT
  const rootClass = [
    styles.graph,
    compact ? styles.graphCompact : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <ReactFlow
      className={rootClass}
      nodes={nodes}
      edges={base.edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={fitViewOptions}
      defaultViewport={
        compact
          ? { x: 0, y: 0, zoom: COMPACT_ZOOM }
          : undefined
      }
      minZoom={0.2}
      maxZoom={compact ? 1 : 1.6}
      nodesDraggable={canInteract}
      nodesConnectable={false}
      elementsSelectable={showSelection}
      panOnDrag={canInteract}
      zoomOnScroll={canInteract}
      zoomOnPinch={canInteract}
      zoomOnDoubleClick={canInteract}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={18}
        size={1}
        className={styles.dots}
      />
      {!compact && (
        <>
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className={styles.minimap} />
        </>
      )}
      <FocusSync
        nodeId={focusNodeId}
        x={nodes.find((node) => node.id === focusNodeId)?.position.x}
        y={nodes.find((node) => node.id === focusNodeId)?.position.y}
        zoom={compact ? COMPACT_ZOOM : 1}
        fitWhenIdle={compact}
      />
    </ReactFlow>
  )
}

/** Recenter when `focusNodeId` changes or that node first appears. */
function FocusSync({
  nodeId,
  x,
  y,
  zoom,
  fitWhenIdle,
}: {
  readonly nodeId: string | null
  readonly x: number | undefined
  readonly y: number | undefined
  readonly zoom: number
  readonly fitWhenIdle: boolean
}) {
  const { getNode, setCenter, fitView } = useReactFlow()

  useEffect(() => {
    if (nodeId !== null && x !== undefined && y !== undefined) {
      const measured = getNode(nodeId)
      const width = measured?.width ?? 240
      const height = measured?.height ?? 80
      void setCenter(x + width / 2, y + height / 2, {
        zoom,
        duration: 280,
      })
      return
    }
    if (fitWhenIdle) {
      void fitView({ ...COMPACT_FIT, duration: 280 })
    }
  }, [nodeId, x, y, zoom, fitWhenIdle, getNode, setCenter, fitView])

  return null
}

export type { FlowCardData, FlowElements }
export { toFlowElements }
