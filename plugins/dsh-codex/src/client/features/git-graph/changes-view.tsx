import { useCallback, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconRefreshOutline14,
  IconWarningOutline16,
  Input,
  Menu,
  RiskConfirmation,
  Toast,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelIconGraph } from '../side-panels/icons'
import {
  GIT_GRAPH_ACTION_PATH,
  type GitGraphActionName,
  type GitGraphActionRequest,
  type GitGraphActionResponse,
} from '../../../shared/git-graph'
import { GitGraphDetail } from './detail-files'

export interface GitChangesViewProps {
  cwd?: string
  t: (key: string) => string
  /** Open the `files` panel on a file's working-tree diff. */
  onOpenFile?: (file: string, sha?: string) => void
  /** Open the commit-graph tab. */
  onOpenGraph?: () => void
}

/** Workdir actions the dropdown can fire directly (no extra input). */
type QuickAction = Extract<
  GitGraphActionName,
  'stage-all' | 'unstage-all' | 'pull' | 'push' | 'fetch' | 'stash' | 'stash-pop'
>

/**
 * The Git tab's default body: the working-tree change list, VSCode-style.
 * The header carries the commit-message input, a refresh action, the button
 * that opens the commit graph as its own tab, and — on the far right — a
 * segmented commit button: the left segment commits with the typed message,
 * the right segment opens a dropdown with the other basic git operations.
 */
export function GitChangesView(props: GitChangesViewProps) {
  const { cwd, t, onOpenFile, onOpenGraph } = props
  const [refreshSeq, setRefreshSeq] = useState(0)
  const [display, setDisplay] = useState<'flat' | 'tree'>('flat')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string; kind: 'ok' | 'error' } | null>(null)
  const toastSeq = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  const showToast = useCallback((text: string, kind: 'ok' | 'error') => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text, kind })
  }, [])
  const refresh = useCallback(() => setRefreshSeq((seq) => seq + 1), [])

  const run = useCallback(async (
    action: GitGraphActionName,
    commitMessage?: string,
    path?: string,
  ): Promise<boolean> => {
    if (cwd === undefined || cwd.length === 0) {
      showToast(t('gitGraph.noCwd'), 'error')
      return false
    }
    setBusy(true)
    const request: GitGraphActionRequest = { cwd, action }
    if (commitMessage !== undefined) request.message = commitMessage
    if (path !== undefined) request.path = path
    const result = await postAction(request)
    setBusy(false)
    if (!result.ok) {
      showToast(result.message, 'error')
      return false
    }
    if (action !== 'stage' && action !== 'unstage') {
      showToast(result.message ?? t('gitGraph.actionOk'), 'ok')
    }
    refresh()
    return true
  }, [cwd, refresh, showToast, t])

  const submitCommit = (action: 'commit' | 'commit-push'): void => {
    const text = message.trim()
    if (text.length === 0 || busy) return
    void run(action, text).then((ok) => {
      if (ok) setMessage('')
    })
  }

  const onSelectMore = (id: string): void => {
    setMenuOpen(false)
    if (busy) return
    if (id === 'commit-push') {
      submitCommit('commit-push')
      return
    }
    if (id === 'discard-all') {
      setAcknowledged(false)
      setDiscardOpen(true)
      return
    }
    void run(id as QuickAction)
  }

  if (cwd === undefined || cwd.length === 0) {
    return <div className="dsh-git-graph-status">{t('gitGraph.noCwd')}</div>
  }

  return (
    <div className="dsh-git-changes" ref={panelRef}>
      <div className="dsh-git-changes-header">
        <Input
          className="dsh-git-changes-message"
          value={message}
          placeholder={t('gitGraph.commitPlaceholder')}
          aria-label={t('gitGraph.commitMessage')}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submitCommit('commit')
          }}
        />
        <button
          type="button"
          className={'dsh-git-changes-icon' + (display === 'tree' ? ' is-active' : '')}
          aria-label={t(display === 'tree' ? 'gitGraph.listView' : 'gitGraph.treeView')}
          aria-pressed={display === 'tree'}
          title={t(display === 'tree' ? 'gitGraph.listView' : 'gitGraph.treeView')}
          onClick={() => setDisplay((mode) => (mode === 'tree' ? 'flat' : 'tree'))}
        >
          <IconFolderTree size={16} />
        </button>
        <button
          type="button"
          className="dsh-git-changes-icon"
          aria-label={t('gitGraph.refresh')}
          title={t('gitGraph.refresh')}
          onClick={refresh}
        >
          <IconRefreshOutline14 size={16} />
        </button>
        <button
          type="button"
          className="dsh-git-changes-icon"
          aria-label={t('view.gitGraphGraph')}
          title={t('view.gitGraphGraph')}
          onClick={onOpenGraph}
        >
          <PanelIconGraph size={16} />
        </button>
        <div className="dsh-git-changes-commit">
          <button
            type="button"
            className="dsh-git-changes-commit-main"
            disabled={busy || message.trim().length === 0}
            onClick={() => submitCommit('commit')}
          >
            {t('gitGraph.commit')}
          </button>
          <button
            ref={moreRef}
            type="button"
            className="dsh-git-changes-commit-more"
            disabled={busy}
            aria-label={t('gitGraph.moreActions')}
            aria-expanded={menuOpen}
            title={t('gitGraph.moreActions')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconChevronDownOutline14 size={14} />
          </button>
        </div>
      </div>
      {/* Key prefixes matter: this list and the Toast below are siblings, and
          two siblings sharing a numeric key corrupt React's keyed reconciliation
          (the overwritten fiber is orphaned — never unmounted, never updated). */}
      <GitGraphDetail
        key={`detail-${refreshSeq}`}
        cwd={cwd}
        t={t}
        display={display}
        onOpenFile={(file, sha) => onOpenFile?.(file, sha)}
        onStageChange={(file, stage) => void run(stage ? 'stage' : 'unstage', undefined, file.path)}
        onStageAll={() => void run('stage-all')}
        onUnstageAll={() => void run('unstage-all')}
      />
      <Menu
        open={menuOpen}
        portal
        compact
        dense
        side="bottom"
        align="end"
        anchor={<span className="dsh-git-graph-menu-anchor" aria-hidden="true" />}
        getAnchorRect={() => moreRef.current?.getBoundingClientRect() ?? null}
        items={moreItems(t)}
        onSelect={onSelectMore}
        onClose={() => setMenuOpen(false)}
      />
      <RiskConfirmation
        open={discardOpen}
        title={t('gitGraph.discardAll')}
        description={t('gitGraph.confirmDiscard')}
        acknowledgeLabel={t('gitGraph.confirmDiscardAck')}
        cancelLabel={t('gitGraph.cancel')}
        confirmLabel={t('gitGraph.confirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false)
          void run('discard-all')
        }}
      />
      {toast !== null ? (
        <Toast
          key={`toast-${toast.seq}`}
          text={toast.text}
          icon={toast.kind === 'error'
            ? <IconWarningOutline16 />
            : <IconCheckOutline16 />}
          anchor={panelRef.current}
          onDone={() => setToast(null)}
        />
      ) : null}
    </div>
  )
}

/** Lucide `folder-tree`, inlined (the primitives sheet has no tree glyph). */
function IconFolderTree(props: { size?: number }) {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M3 5a2 2 0 0 0 2 2h3" />
      <path d="M3 3v13a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

function moreItems(t: (key: string) => string): readonly MenuEntry[] {
  return [
    { id: 'commit-push', label: t('gitGraph.commitPush') },
    { type: 'separator', id: 'sep-commit' },
    { id: 'stage-all', label: t('gitGraph.stageAll') },
    { id: 'unstage-all', label: t('gitGraph.unstageAll') },
    { id: 'discard-all', label: t('gitGraph.discardAll'), danger: true },
    { type: 'separator', id: 'sep-workdir' },
    { id: 'pull', label: t('gitGraph.pull') },
    { id: 'push', label: t('gitGraph.push') },
    { id: 'fetch', label: t('gitGraph.fetch') },
    { type: 'separator', id: 'sep-remote' },
    { id: 'stash', label: t('gitGraph.stash') },
    { id: 'stash-pop', label: t('gitGraph.stashPop') },
  ]
}

async function postAction(request: GitGraphActionRequest): Promise<GitGraphActionResponse> {
  try {
    const response = await fetch(GIT_GRAPH_ACTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    })
    const value = await response.json() as GitGraphActionResponse
    if (typeof value.ok !== 'boolean') {
      return { ok: false, code: 'git', message: `action failed: ${response.status}` }
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
