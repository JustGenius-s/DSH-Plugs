import { useCallback, useState } from 'react'
// React Flow's base stylesheet is injected by the client build (see
// tsdown.client.config.ts) rather than imported here: a runtime `require` of a
// plain CSS path is not an admitted client module in this monorepo.

import { Button } from '@just-genius/dsh-plugin-ui'

import { ACTION_PATH, waitingForConfirm } from '../shared.ts'
import type {
  FlowAction,
  FlowNodeView,
  FlowPlanView,
} from '../shared.ts'
import { postResult } from '@just-genius/dsh-plugin-runtime/client'
import { FlowGraph } from './FlowGraph.tsx'
import { elapsedMs, formatDuration, inputTokens, totalTokens } from './metrics.ts'
import { STATUS_LABEL, progressOf } from './status.ts'
import { useFlowState } from './useFlowState.ts'
import styles from './FlowCanvas.module.css'

/** The Sidebar supplies the conversation session owning this tab. */
export interface FlowCanvasProps {
  sessionId: string
}

/**
 * The Flow tab.
 *
 * Read-mostly by design: the Leader reshapes the graph through `flow_patch`, so
 * the canvas offers only the local actions that do not fight the model for
 * ownership of the topology — retry a failed node, skip it, stop a live one.
 */
export function FlowCanvas({ sessionId }: FlowCanvasProps) {
  const state = useFlowState(sessionId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const plan = state.plan

  const act = useCallback(async (action: FlowAction) => {
    setError(null)
    try {
      const result = await postResult<{ ok: boolean; message: string | null }>(
        `${ACTION_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
        action,
      )
      if (!result.ok && result.message !== null) setError(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [sessionId])

  if (!state.mode) {
    return (
      <OffState
        degraded={state.degraded}
        reason={state.degradedReason}
        error={state.error}
      />
    )
  }

  if (plan === null) {
    return (
      <EmptyState
        degraded={state.degraded}
        reason={state.degradedReason}
      />
    )
  }

  const selected = plan.nodes.find((node) => node.id === selectedId) ?? null
  const progress = progressOf(plan.nodes.map((node) => node.status))

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{plan.title}</h2>
          <span className={styles.badge} data-status={plan.status}>
            {plan.status === 'settled' ? '全部结束' : plan.status === 'running' ? '执行中' : '待执行'}
          </span>
        </div>

        <div className={styles.meter} role="presentation">
          <div className={styles.meterFill} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>

        <div className={styles.legend}>
          {(['pending', 'running', 'paused', 'expanded', 'done', 'failed', 'skipped'] as const).map((status) => (
            <span key={status} className={styles.legendItem}>
              <span className={styles.statusDot} data-status={status} aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
          ))}
        </div>

        {waitingForConfirm(plan) && plan.confirm !== null && (
          <div className={styles.confirmBar}>
            <p className={styles.confirmText}>{plan.confirm.question}</p>
            <Button onClick={() => void act({ kind: 'next' })}>通过并继续</Button>
          </div>
        )}
      </header>

      {state.degraded && (
        <p className={styles.degraded}>
          编排器降级：{state.degradedReason ?? '未知原因'}。图可以显示，但不会派发子 Agent。
        </p>
      )}
      {error !== null && <p className={styles.error}>{error}</p>}

      <div className={styles.body}>
        <div className={styles.canvas}>
          <FlowGraph
            plan={plan}
            variant="full"
            selectedId={selectedId}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onAct={(action) => void act(action)}
          />
        </div>

        {selected !== null && (
          <DetailPane
            node={selected}
            confirm={plan.confirm}
            onAct={act}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

/** Side panel for the selected node: the full brief, result, and local actions. */
function DetailPane({
  node,
  confirm,
  onAct,
  onClose,
}: {
  node: FlowNodeView
  confirm: FlowPlanView['confirm']
  onAct: (action: FlowAction) => Promise<void>
  onClose: () => void
}) {
  const canRetry = node.status === 'failed' || node.status === 'skipped' || node.status === 'done'
  const canSkip = node.status !== 'done' && node.status !== 'skipped'
  const canStop = node.status === 'running'
  const canPause = node.status === 'running'
  const canResume = node.status === 'paused'
  const showConfirm = confirm !== null && (confirm.nodeId === null || confirm.nodeId === node.id)
  const duration = elapsedMs(node.startedAt, node.endedAt, Date.now())

  return (
    <aside className={styles.detail}>
      <header className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{node.title}</h3>
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <dl className={styles.meta}>
        <div><dt>状态</dt><dd>{STATUS_LABEL[node.status]}</dd></div>
        <div><dt>尝试次数</dt><dd>{node.attempts}</dd></div>
        {duration !== null && <div><dt>执行时间</dt><dd>{formatDuration(duration)}</dd></div>}
        {duration !== null && <div><dt>Token</dt><dd>{node.usage === null ? (node.status === 'running' ? '统计中' : '暂无统计') : totalTokens(node.usage).toLocaleString()}</dd></div>}
        {node.usage !== null && <div><dt>输入</dt><dd>{inputTokens(node.usage).toLocaleString()}</dd></div>}
        {node.usage !== null && <div><dt>输出</dt><dd>{node.usage.outputTokens.toLocaleString()}</dd></div>}
        {node.usage !== null && node.usage.cacheReadTokens > 0 && <div><dt>缓存读取</dt><dd>{node.usage.cacheReadTokens.toLocaleString()}</dd></div>}
        {node.usage !== null && node.usage.cacheWriteTokens > 0 && <div><dt>缓存写入</dt><dd>{node.usage.cacheWriteTokens.toLocaleString()}</dd></div>}
      </dl>

      <section className={styles.detailSection}>
        <h4>任务简报</h4>
        <pre className={styles.brief}>{node.prompt}</pre>
      </section>

      {node.notes.length > 0 && (
        <section className={styles.detailSection}>
          <h4>进展记录</h4>
          <pre className={styles.brief}>
            {node.notes.map((note) => `[${timeOf(note.at)}] ${note.text}`).join('\n')}
          </pre>
        </section>
      )}

      {node.summary !== null && (
        <section className={styles.detailSection}>
          <h4>产出摘要</h4>
          <pre className={styles.brief}>{node.summary}</pre>
        </section>
      )}

      {node.diagnostic !== null && (
        <section className={styles.detailSection}>
          <h4>失败原因</h4>
          <pre className={styles.brief}>{node.diagnostic}</pre>
        </section>
      )}

      <div className={styles.actions}>
        {showConfirm && <Button onClick={() => void onAct({ kind: 'next' })}>通过并继续</Button>}
        {canRetry && <Button onClick={() => void onAct({ kind: 'retry', nodeId: node.id })}>重试</Button>}
        {canResume && <Button onClick={() => void onAct({ kind: 'resume', nodeId: node.id })}>继续</Button>}
        {canSkip && <Button onClick={() => void onAct({ kind: 'skip', nodeId: node.id })}>跳过</Button>}
        {canPause && <Button onClick={() => void onAct({ kind: 'pause', nodeId: node.id })}>暂停</Button>}
        {canStop && <Button onClick={() => void onAct({ kind: 'cancel', nodeId: node.id })}>停止</Button>}
      </div>

      <p className={styles.hint}>
        卡片左下角也有跳过 / 暂停 / 停止，鼠标移到节点上即可操作。
        暂停会停掉该子代理，之后可以「继续」；停止则标记为失败，交给 Leader 处理。
        只有 Leader 或子代理请求确认时才会暂停整个流程。改拓扑请用 <code>flow_patch</code>。
      </p>
    </aside>
  )
}

/** HH:MM:SS for a note timestamp; falls back to the raw string if unparseable. */
function timeOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** Opening the graph does not enable a mode; entry belongs to the composer. */
function OffState({
  degraded,
  reason,
  error,
}: {
  degraded: boolean
  reason: string | null
  error: string | null
}) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>Flow</h2>
      <p className={styles.emptyText}>
        在输入框的命令菜单中选择 <code>/flow</code> 开启 Flow 模式。
        主 Agent 会把任务拆成依赖图，每个节点交给子 Agent 执行。
      </p>
      <p className={styles.emptyText}>
        流程图会在这里实时更新，可以同时查看对话和执行进展。
      </p>
      <p className={styles.hint}>
        开启后输入框显示 Flow chip，点击关闭即可退出；也可输入 <code>/flow off</code>。
      </p>
      {error !== null && <p className={styles.error} role="status">{error}</p>}
      {degraded && (
        <p className={styles.degraded}>
          编排器降级：{reason ?? '未知原因'}。图可以显示，但不会派发子 Agent。
        </p>
      )}
    </div>
  )
}

/** Mode on but no plan yet. */
function EmptyState({
  degraded,
  reason,
}: {
  degraded: boolean
  reason: string | null
}) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>Flow 模式已开启</h2>
      <p className={styles.emptyText}>
        还没有工作流。给主 Agent 一个需要多步完成的任务，它会调用 <code>flow_plan</code>
        生成依赖图，每个节点交给一个子 Agent 执行。
      </p>
      <p className={styles.emptyText}>
        执行过程中 Leader 会根据子 Agent 的结果调整这张图：重试、跳过、插入补救步骤。
      </p>
      {degraded && (
        <p className={styles.degraded}>
          编排器降级：{reason ?? '未知原因'}。图可以显示，但不会派发子 Agent。
        </p>
      )}
    </div>
  )
}
