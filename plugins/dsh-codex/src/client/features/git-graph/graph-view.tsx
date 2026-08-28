import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, UIEvent } from 'react'
import {
  IconCheckOutline16,
  IconWarningOutline16,
  Toast,
} from '@just-genius/dsh-plugin-ui'
import {
  DEFAULT_GRAPH_LIMIT,
  GIT_GRAPH_PATH,
  type GitGraphRef,
  type GitGraphResponse,
  type GitGraphRow,
  type GitGraphScopeRef,
} from '../../../shared/git-graph'
import { subscribeRepoWatch } from '../repo-watch'
import {
  BranchFilter,
  scopeFallback,
  toggleScope,
} from './branch-filter'
import { CommitContextMenu, openCommitMenu, type CommitMenuState } from './commit-menu'
import { GitGraphDetail, refBadgeLabel } from './detail-files'
import { layoutGraph, type GraphEdge, type LaidOutNode } from './layout'
import { ensureGitGraphStyles } from './styles'

ensureGitGraphStyles()

const ROW_HEIGHT = 32
/** First auto-retry delay after a failed refresh; doubles up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 3_000
const RETRY_MAX_MS = 30_000
const LANE_GAP = 16
const LANE_PAD = 8
const MIN_GUTTER = 32
const MAX_GUTTER = 96
const DOT_SIZE = 8
const LANE_COLORS = [
  '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#56b6c2', '#e06c75', '#d19a66', '#528bff',
]

export interface GitGraphViewProps {
  cwd?: string
  t: (key: string) => string
  /**
   * Whether this pane is the active visible tab. Hidden retained panes skip
   * the repo-watch SSE. Defaults to true.
   */
  visible?: boolean
  /** Open the `files` panel on a file; sha undefined = working tree. */
  onOpenFile?: (file: string, sha?: string) => void
  /** Open the `files` panel on the file itself (preview, not its diff). */
  onOpenPreview?: (file: string, sha?: string) => void
}

interface GraphState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  code?: 'no-cwd' | 'not-git' | 'git' | 'bad-request'
  message?: string
  head?: string
  branch?: string
  refs: GitGraphScopeRef[]
  selected: string[]
  rows: GitGraphRow[]
  hasMore: boolean
}

const EMPTY: GraphState = {
  status: 'idle',
  refs: [],
  selected: [],
  rows: [],
  hasMore: false,
}

export function GitGraphView(props: GitGraphViewProps) {
  const { cwd, t, onOpenFile, onOpenPreview } = props
  const visible = props.visible !== false
  const [state, setState] = useState<GraphState>(EMPTY)
  const [selected, setSelected] = useState<string | undefined>()
  const [detail, setDetail] = useState<{
    sha?: string
    title: string
    refs?: GitGraphRow['refs']
  } | undefined>()
  const [menu, setMenu] = useState<CommitMenuState | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string; kind: 'ok' | 'error' } | null>(null)
  const toastSeq = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const loadingMore = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const failures = useRef(0)
  const userScopeRef = useRef<string[] | null>(null)
  const [userScope, setUserScope] = useState<string[] | null>(null)
  const showToast = useCallback((text: string, kind: 'ok' | 'error') => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text, kind })
  }, [])

  const load = useCallback(async (
    reset: boolean,
    skip = 0,
    refs: string[] | null = userScopeRef.current,
    preserveSelection = false,
  ) => {
    if (cwd === undefined || cwd.length === 0) {
      setState({
        status: 'error',
        code: 'no-cwd',
        refs: [],
        selected: [],
        rows: [],
        hasMore: false,
      })
      return
    }
    if (reset) {
      setState((current) => ({ ...current, status: 'loading' }))
      if (!preserveSelection) {
        setSelected(undefined)
        setDetail(undefined)
      }
    }    const response = await fetchGraph(cwd, skip, refs ?? undefined)
    if (!response.ok) {
      // A transient failure (git is often slow right after sleep-wake)
      // keeps the current graph on screen and retries with backoff; the
      // error view is only for when there is nothing to show.
      setState((current) => {
        if (current.rows.length > 0) return current
        return {
          status: 'error',
          code: response.code,
          message: response.message,
          refs: [],
          selected: [],
          rows: [],
          hasMore: false,
        }
      })
      if (reset) {
        failures.current += 1
        const wait = Math.min(
          RETRY_BASE_MS * 2 ** (failures.current - 1),
          RETRY_MAX_MS,
        )
        clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          void load(true, 0, userScopeRef.current, true)
        }, wait)
      }
      return
    }
    failures.current = 0
    clearTimeout(retryTimer.current)
    setState((current) => ({
      status: 'ready',
      head: response.head,
      branch: response.branch,
      refs: response.refs,
      selected: response.selected,
      rows: reset ? response.rows : [...current.rows, ...response.rows],
      hasMore: response.hasMore,
    }))
  }, [cwd])

  useEffect(() => {
    userScopeRef.current = null
    setUserScope(null)
    void load(true, 0, null)
    return () => {
      failures.current = 0
      clearTimeout(retryTimer.current)
    }
  }, [load])

  // Auto-refresh on repo movement only while this pane is visible. Hidden
  // retained panes unsubscribe so multi-session workspaces share the
  // connection pool with chat. detailSeq re-fetches an open file list in
  // place so a workdir detail picks up the new changes too.
  const [detailSeq, setDetailSeq] = useState(0)
  useEffect(() => {
    if (!visible) return
    if (cwd === undefined || cwd.length === 0) return
    const onChange = (): void => {
      setDetailSeq((seq) => seq + 1)
      void load(true, 0, userScopeRef.current, true)
    }
    const unsubscribe = subscribeRepoWatch(cwd, onChange)
    onChange()
    return unsubscribe
  }, [cwd, load, visible])

  useEffect(() => {
    if (selected === undefined) {
      setDetail(undefined)
      return
    }
    const row = state.rows.find((item) => item.sha === selected)
    if (row === undefined) {
      setDetail(undefined)
      return
    }
    if (row.kind === 'workdir') {
      setDetail({ title: t('gitGraph.workdir') })
      return
    }
    setDetail({ sha: row.sha, title: row.subject, refs: row.refs })
  }, [selected, state.rows, t])

  const layout = useMemo(() => layoutGraph(state.rows), [state.rows])
  const needed = LANE_PAD * 2
    + Math.max(0, layout.laneCount - 1) * LANE_GAP
    + DOT_SIZE
  const gutter = Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, needed))

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    if (!state.hasMore || loadingMore.current || state.status !== 'ready') return
    const el = event.currentTarget
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return
    loadingMore.current = true
    const skip = state.rows.filter((row) => row.kind !== 'workdir').length
    void load(false, skip).finally(() => { loadingMore.current = false })
  }

  const activeScope = userScope ?? state.selected
  const onToggleScope = (id: string): void => {
    const next = toggleScope(id, activeScope, scopeFallback(state.refs))
    userScopeRef.current = next
    setUserScope(next)
    void load(true, 0, next)
  }

  return (
    <div className="dsh-git-graph" ref={panelRef}>
      <BranchFilter
        refs={state.refs}
        selected={activeScope}
        t={t}
        onToggle={onToggleScope}
      />
      <GraphBody
        state={state}
        t={t}
        selected={selected}
        onSelect={setSelected}
        onMenu={(event, row) => {
          setSelected(row.sha)
          openCommitMenu(event, row, setMenu)
        }}
        gutter={gutter}
        nodes={layout.nodes}
        edges={layout.edges}
        onScroll={onScroll}
      />
      {detail !== undefined && selected !== undefined && cwd !== undefined ? (
        <GitGraphDetail
          cwd={cwd}
          sha={detail.sha}
          title={detail.title}
          refs={detail.refs}
          onClose={() => setSelected(undefined)}
          t={t}
          refreshSeq={detailSeq}
          onOpenFile={(file, sha) => onOpenFile?.(file, sha)}
          onOpenPreview={(file, sha) => onOpenPreview?.(file, sha)}
        />
      ) : null}
      {toast !== null ? (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={toast.kind === 'error'
            ? <IconWarningOutline16 />
            : <IconCheckOutline16 />}
          anchor={panelRef.current}
          onDone={() => setToast(null)}
        />
      ) : null}
      <CommitContextMenu
        menu={menu}
        cwd={cwd}
        t={t}
        onClose={() => setMenu(null)}
        onRan={() => { void load(true, 0) }}
        onNotice={showToast}
      />
    </div>
  )
}

function GraphBody(props: {
  state: GraphState
  t: (key: string) => string
  selected: string | undefined
  onSelect: (sha: string) => void
  onMenu: (event: MouseEvent, row: GitGraphRow) => void
  gutter: number
  nodes: readonly LaidOutNode[]
  edges: readonly GraphEdge[]
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}) {
  const { state, t } = props
  // First paint while the log is in flight: stay blank. A "loading…" status
  // flashes and looks worse than an empty panel for a short fetch.
  if (state.status === 'loading' && state.rows.length === 0) {
    return null
  }
  if (state.status === 'error') {
    return <div className="dsh-git-graph-status is-error">{errorText(state, t)}</div>
  }
  if (state.rows.length === 0) {
    return <div className="dsh-git-graph-status">{t('gitGraph.empty')}</div>
  }

  const height = state.rows.length * ROW_HEIGHT
  return (
    <div className="dsh-git-graph-body" onScroll={props.onScroll}>
      <div
        className="dsh-git-graph-list"
        style={{
          height,
          ['--dsh-git-graph-gutter' as never]: `${props.gutter}px`,
        }}
      >
        {props.nodes.map((node, index) => (
          <button
            key={node.row.sha + ':' + String(index)}
            type="button"
            className={rowClass(node.row, props.selected)}
            onClick={() => props.onSelect(node.row.sha)}
            onContextMenu={(event) => props.onMenu(event, node.row)}
          >
            <span className="dsh-git-graph-gutter" />
            <span className="dsh-git-graph-meta">
              <RowBadges refs={node.row.refs} />
              <span className="dsh-git-graph-subject">{node.row.subject}</span>
            </span>
            <span className="dsh-git-graph-sha">{node.row.shortSha}</span>
            <span
              className="dsh-git-graph-date"
              title={formatCommitDateTitle(node.row.timestamp)}
            >
              {formatCommitDate(node.row.timestamp)}
            </span>
            <span
              className="dsh-git-graph-author"
              title={node.row.author}
            >
              {node.row.author}
            </span>
          </button>
        ))}
        <div
          className="dsh-git-graph-svg-clip"
          style={{ width: props.gutter, height }}
        >
          <svg
            className="dsh-git-graph-svg"
            width={props.gutter}
            height={height}
            viewBox={`0 0 ${props.gutter} ${height}`}
            overflow="hidden"
            aria-hidden="true"
          >
            {props.edges.map((edge, index) => (
              <EdgePath key={index} edge={edge} />
            ))}
            {props.nodes.map((node, index) => (
              <circle
                key={node.row.sha + ':dot'}
                cx={laneX(node.column)}
                cy={index * ROW_HEIGHT + ROW_HEIGHT / 2}
                r={node.row.kind === 'workdir' ? 4 : 3.5}
                fill={node.row.kind === 'workdir'
                  ? 'transparent'
                  : LANE_COLORS[node.column % LANE_COLORS.length]}
                stroke={LANE_COLORS[node.column % LANE_COLORS.length]}
                strokeWidth={node.row.kind === 'workdir' ? 1.5 : 0}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}

/** Gap between row badges; mirrored in the stylesheet's `gap`. */
const BADGE_GAP = 4
/** Share of the meta cell the badge strip may occupy at most. */
const BADGES_MAX_RATIO = 0.46

/** Overflow badges are taken out of the flow but stay measurable. */
const HIDDEN_BADGE_STYLE = {
  position: 'absolute',
  visibility: 'hidden',
} as const

/**
 * A row's ref badges: as many WHOLE badges as fit are shown, the rest hide
 * outright — a half-clipped badge reads as a rendering bug. CSS alone can't
 * clip a flex row at item boundaries (the wrap-and-clip trick sizes the box
 * as if nothing wrapped, leaving dead space), so the fit is measured: every
 * badge renders, widths are summed against the strip's cap, and the tail is
 * pulled out of the flow. The cap is set inline from the same ratio so the
 * measurement and the layout never disagree.
 */
function RowBadges(props: { refs: readonly GitGraphRef[] }) {
  const { refs } = props
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(refs.length)

  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.parentElement
    if (el === null || parent === null || parent === undefined) return
    const measure = (): void => {
      const budget = Math.floor(parent.clientWidth * BADGES_MAX_RATIO)
      el.style.maxWidth = String(budget) + 'px'
      let used = 0
      let count = 0
      for (const child of Array.from(el.children)) {
        const width = (child as HTMLElement).offsetWidth
        const next = used + (count === 0 ? 0 : BADGE_GAP) + width
        if (next > budget) break
        used = next
        count += 1
      }
      setVisible(count)
    }
    measure()
    // The strip's width is content-driven once badges hide, so the meta
    // cell (not the strip) is observed — it tracks panel resizes.
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [refs])

  if (refs.length === 0) return null
  return (
    <span className="dsh-git-graph-badges" ref={ref}>
      {refs.map((badgeRef, index) => (
        <span
          key={badgeRef.type + ':' + badgeRef.name}
          className={'dsh-git-graph-badge is-' + badgeRef.type}
          title={refBadgeLabel(badgeRef)}
          style={index < visible ? undefined : HIDDEN_BADGE_STYLE}
        >
          {refBadgeLabel(badgeRef)}
        </span>
      ))}
    </span>
  )
}

function EdgePath(props: { edge: GraphEdge }) {
  const { edge } = props
  const x1 = laneX(edge.fromCol)
  const x2 = laneX(edge.toCol)
  const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2
  const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2
  const midY = (y1 + y2) / 2
  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
      fill="none"
      stroke={LANE_COLORS[edge.fromCol % LANE_COLORS.length]}
      strokeWidth="1.5"
    />
  )
}

function errorText(state: GraphState, t: (key: string) => string): string {
  if (state.code === 'no-cwd') return t('gitGraph.noCwd')
  if (state.code === 'not-git') return t('gitGraph.notGit')
  const suffix = state.message === undefined ? '' : ` ${state.message}`
  return t('gitGraph.error') + suffix
}

function rowClass(row: GitGraphRow, selected: string | undefined): string {
  const classes = ['dsh-git-graph-row']
  if (row.kind === 'workdir') classes.push('is-workdir')
  if (selected === row.sha) classes.push('is-selected')
  return classes.join(' ')
}

function laneX(column: number): number {
  return LANE_PAD + column * LANE_GAP
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value)
}

function formatCommitDate(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  if (sameDay) return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  if (date.getFullYear() === now.getFullYear()) {
    return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
  }
  return String(date.getFullYear()).slice(2)
    + '-' + pad2(date.getMonth() + 1)
    + '-' + pad2(date.getDate())
}

function formatCommitDateTitle(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

async function fetchGraph(
  cwd: string,
  skip: number,
  refs?: readonly string[],
): Promise<GitGraphResponse> {
  const params = new URLSearchParams({
    cwd,
    skip: String(skip),
    limit: String(DEFAULT_GRAPH_LIMIT),
  })
  if (refs !== undefined) {
    for (const ref of refs) params.append('ref', ref)
  }
  try {
    const response = await fetch(`${GIT_GRAPH_PATH}?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    const value = await response.json() as GitGraphResponse
    if (typeof value.ok !== 'boolean') {
      return { ok: false, code: 'git', message: `graph failed: ${response.status}` }
    }
    return value
  } catch (error) {
    return {
      ok: false,
      code: 'git',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
