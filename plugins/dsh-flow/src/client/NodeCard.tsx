import type { FlowNodeView, NodeStatus } from '../shared.ts'
import { STATUS_LABEL } from './status.ts'
import styles from './FlowCanvas.module.css'

export interface NodeCardProps {
  readonly node: FlowNodeView
  readonly selected: boolean
}

/**
 * One graph node.
 *
 * Status is carried by a data attribute, not by inline styles or hardcoded
 * colours, so every visual state resolves through the `--dsw-*` theme and both
 * light and dark stay correct.
 */
export function NodeCard({ node, selected }: NodeCardProps) {
  return (
    <div
      className={styles.node}
      data-status={node.status}
      data-selected={selected ? 'true' : 'false'}
    >
      <header className={styles.nodeHead}>
        <span className={styles.statusDot} data-status={node.status} aria-hidden="true" />
        <span className={styles.nodeTitle} title={node.title}>{node.title}</span>
        <span className={styles.nodeStatus}>{STATUS_LABEL[node.status]}</span>
      </header>

      <code className={styles.nodeId}>
        {node.parentId !== undefined ? `${node.parentId} / ${node.id}` : node.id}
      </code>

      {node.attempts > 1 && (
        <span className={styles.attempts}>attempt {node.attempts}</span>
      )}

      {node.status === 'failed' && node.diagnostic !== null && (
        <p className={styles.diagnostic} title={node.diagnostic}>{node.diagnostic}</p>
      )}

      {node.status === 'done' && node.summary !== null && (
        <p className={styles.summary}>{node.summary}</p>
      )}

      {node.status === 'expanded' && (
        <p className={styles.running}>已拆成子任务，等待验收后继续</p>
      )}

      {node.status === 'running' && (
        <p className={styles.running}>
          <span className={styles.spinner} aria-hidden="true" />
          {node.childId === null ? 'starting child…' : 'child agent working'}
        </p>
      )}

      {node.status === 'running' && node.notes.length > 0 && (
        <p className={styles.note} title={node.notes[node.notes.length - 1]!.text}>
          {node.notes[node.notes.length - 1]!.text}
        </p>
      )}
    </div>
  )
}

/** Edge colour follows the upstream node's status. */
export function edgeClassFor(status: NodeStatus): string {
  switch (status) {
    case 'done': return styles.edgeDone
    case 'running': return styles.edgeRunning
    case 'expanded': return styles.edgeRunning
    case 'failed': return styles.edgeFailed
    case 'skipped': return styles.edgeSkipped
    default: return styles.edgeIdle
  }
}
