import type { FlowAction, FlowNodeView, NodeStatus } from '../shared.ts'
import { actionFor, actionsFor, type NodeAction } from './actions.ts'
import { ACTION_ICON, ACTION_LABEL, STATUS_LABEL } from './status.ts'
import { elapsedMs, formatDuration, totalTokens } from './metrics.ts'
import styles from './FlowCanvas.module.css'

export interface NodeCardProps {
  readonly node: FlowNodeView
  readonly selected: boolean
  /** Omit to render a read-only card (the compact mini-window). */
  readonly onAct?: (action: FlowAction) => void
}

/**
 * One graph node.
 *
 * Status is carried by a data attribute, not by inline styles or hardcoded
 * colours, so every visual state resolves through the `--dsw-*` theme and both
 * light and dark stay correct.
 */
export function NodeCard({ node, selected, onAct }: NodeCardProps) {
  const duration = elapsedMs(node.startedAt, node.endedAt, Date.now())
  const actions = onAct === undefined ? [] : actionsFor(node.status)

  return (
    <div
      className={styles.node}
      data-status={node.status}
      data-selected={selected ? 'true' : 'false'}
    >
      <header className={styles.nodeHead}>
        <span className={styles.statusDot} data-status={node.status} aria-hidden="true" />
        <span className={styles.nodeTitle} title={node.title}>{node.title}</span>
        <span className={styles.nodeStatus}>
          {node.status === 'running' && <span className={styles.spinner} aria-hidden="true" />}
          {STATUS_LABEL[node.status]}
        </span>
      </header>

      {node.attempts > 1 && (
        <span className={styles.attempts}>attempt {node.attempts}</span>
      )}

      {node.status === 'failed' && node.diagnostic !== null && (
        <p className={styles.diagnostic} title={node.diagnostic}>{node.diagnostic}</p>
      )}

      {node.status === 'paused' && (
        <p className={styles.paused}>已暂停，可继续或跳过</p>
      )}

      {node.status === 'done' && node.summary !== null && (
        <p className={styles.summary}>{node.summary}</p>
      )}

      {node.status === 'expanded' && (
        <p className={styles.running}>已拆成子任务，等待验收后继续</p>
      )}

      {node.status === 'running' && node.notes.length > 0 && (
        <p className={styles.note} title={node.notes[node.notes.length - 1]!.text}>
          {node.notes[node.notes.length - 1]!.text}
        </p>
      )}

      {duration !== null && node.status !== 'paused' && (
        <div className={styles.nodeMetrics}>
          <span>耗时 {formatDuration(duration)}</span>
          <span>Token {node.usage === null ? (node.status === 'running' ? '统计中' : '暂无统计') : totalTokens(node.usage).toLocaleString()}</span>
        </div>
      )}

      {actions.length > 0 && (
        <div className={styles.nodeActions}>
          {actions.map((action) => {
            const Icon = ACTION_ICON[action.kind]
            return (
              <button
                key={action.kind}
                type="button"
                className={styles.nodeAction}
                data-tone={action.tone}
                aria-label={ACTION_LABEL[action.kind]}
                title={ACTION_LABEL[action.kind]}
                onClick={(event) => {
                  // The card selects on click; a button must not also select.
                  // React Flow's pan/zoom is bound to the pane, not to nodes, so
                  // stopping propagation here is enough.
                  event.stopPropagation()
                  onAct?.(actionFor(node.id, action))
                }}
              >
                <Icon size={14} />
              </button>
            )
          })}
        </div>
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
    case 'paused': return styles.edgePaused
    case 'failed': return styles.edgeFailed
    case 'skipped': return styles.edgeSkipped
    default: return styles.edgeIdle
  }
}

export type { NodeAction }
