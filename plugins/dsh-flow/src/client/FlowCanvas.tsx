import { useCallback, useState } from 'react'
// React Flow's base stylesheet is injected by the client build (see
// tsdown.client.config.ts) rather than imported here: a runtime `require` of a
// plain CSS path is not an admitted client module in this monorepo.

import { Button } from '@just-genius/dsh-plugin-ui'
import type { PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'

import { ACTION_PATH, MODE_PATH, waitingForConfirm } from '../shared.ts'
import type {
  FlowAction,
  FlowNodeView,
  FlowPlanView,
  FlowStateResponse,
} from '../shared.ts'
import { postResult } from '@just-genius/dsh-plugin-runtime/client'
import { FlowGraph } from './FlowGraph.tsx'
import { STATUS_LABEL, progressOf } from './status.ts'
import { useFlowState } from './useFlowState.ts'
import styles from './FlowCanvas.module.css'

/** Props the client entry injects into the registered view. */
export interface FlowCanvasInjected {
  sessionId: string
}

/** Result of `POST MODE_PATH`. */
interface ModeResult {
  readonly ok: boolean
  readonly message: string | null
}

export type FlowCanvasProps = PropsRuntime<'conversation.view'> &
  FlowCanvasInjected

/**
 * The Flow tab.
 *
 * Read-mostly by design: the Leader reshapes the graph through `flow.patch`, so
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

  const setMode = useCallback(async (on: boolean) => {
    setError(null)
    try {
      await postResult<ModeResult>(`${MODE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { on })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [sessionId])

  if (!state.mode) {
    return (
      <OffState
        pending={state.modePending}
        degraded={state.degraded}
        reason={state.degradedReason}
        onEnable={() => void setMode(true)}
      />
    )
  }

  if (plan === null) {
    return (
      <EmptyState
        degraded={state.degraded}
        reason={state.degradedReason}
        onDisable={() => void setMode(false)}
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
          <button type="button" className={styles.modeToggle} onClick={() => void setMode(false)}>
            退出 Flow 模式
          </button>
        </div>

        <div className={styles.meter} role="presentation">
          <div className={styles.meterFill} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>

        <div className={styles.legend}>
          {(['pending', 'running', 'expanded', 'done', 'failed', 'skipped'] as const).map((status) => (
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
  const canCancel = node.status === 'running'
  const showConfirm = confirm !== null && (confirm.nodeId === null || confirm.nodeId === node.id)

  return (
    <aside className={styles.detail}>
      <header className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{node.title}</h3>
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <dl className={styles.meta}>
        <div><dt>节点</dt><dd><code>{node.id}</code></dd></div>
        <div><dt>状态</dt><dd>{STATUS_LABEL[node.status]}</dd></div>
        <div><dt>依赖</dt><dd>{node.deps.length === 0 ? '无' : node.deps.join('、')}</dd></div>
        {node.parentId !== undefined && <div><dt>父节点</dt><dd><code>{node.parentId}</code></dd></div>}
        <div><dt>尝试次数</dt><dd>{node.attempts}</dd></div>
        {node.childId !== null && <div><dt>子 Agent</dt><dd><code>{node.childId}</code></dd></div>}
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
        {canSkip && <Button onClick={() => void onAct({ kind: 'skip', nodeId: node.id })}>跳过</Button>}
        {canCancel && <Button onClick={() => void onAct({ kind: 'cancel', nodeId: node.id })}>停止</Button>}
      </div>

      <p className={styles.hint}>
        只有 Leader 或子代理请求确认时才会暂停。平时 Leader 验收后自己继续。
        改拓扑请用 <code>flow.patch</code>。
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

/** Mode off: the tab explains itself and offers the one switch that matters. */
function OffState({
  pending,
  degraded,
  reason,
  onEnable,
}: {
  pending: boolean | null
  degraded: boolean
  reason: string | null
  onEnable: () => void
}) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>Flow</h2>
      <p className={styles.emptyText}>
        Flow 模式未开启。开启后，主 Agent 只负责规划：它把任务拆成一张依赖图，
        每个节点交给一个子 Agent 执行，并可以根据执行结果调整这张图。
      </p>
      <p className={styles.emptyText}>
        开启期间 Leader 的执行类工具会被禁用 —— 它只能规划、审查和改图。
      </p>
      <div className={styles.emptyActions}>
        <Button onClick={onEnable}>{pending === true ? '开启中…' : '开启 Flow 模式'}</Button>
      </div>
      <p className={styles.hint}>
        也可以直接在对话框输入 <code>/flow</code>；退出用 <code>/flow off</code>。
      </p>
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
  onDisable,
}: {
  degraded: boolean
  reason: string | null
  onDisable: () => void
}) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>Flow 模式已开启</h2>
      <p className={styles.emptyText}>
        还没有工作流。给主 Agent 一个需要多步完成的任务，它会调用 <code>flow.plan</code>
        生成依赖图，每个节点交给一个子 Agent 执行。
      </p>
      <p className={styles.emptyText}>
        执行过程中 Leader 会根据子 Agent 的结果调整这张图：重试、跳过、插入补救步骤。
      </p>
      <div className={styles.emptyActions}>
        <Button onClick={onDisable}>退出 Flow 模式</Button>
      </div>
      {degraded && (
        <p className={styles.degraded}>
          编排器降级：{reason ?? '未知原因'}。图可以显示，但不会派发子 Agent。
        </p>
      )}
    </div>
  )
}

/** Exported for the entry's type check of the injected session id. */
export type { FlowStateResponse }
