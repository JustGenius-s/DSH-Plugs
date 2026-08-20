import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconEllipsisOutline16,
  IconLoadingOutline16,
  IconRefreshOutline14,
  IconSparkle16,
  IconWarningOutline16,
  Menu,
  Modal,
  RiskConfirmation,
  Toast,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelIconGraph } from '../side-panels/icons'
import {
  GIT_GRAPH_ACTION_PATH,
  GIT_GRAPH_MESSAGE_PATH,
  GIT_GRAPH_WATCH_PATH,
  type GitChangeFile,
  type GitGraphActionName,
  type GitGraphActionRequest,
  type GitGraphActionResponse,
  type GitGraphMessageResponse,
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

type CommitAction = Extract<
  GitGraphActionName,
  'commit' | 'commit-push' | 'commit-amend' | 'commit-push-amend'
>

/** Overflow-menu actions that run directly (no message, no confirmation). */
type QuickAction = Extract<
  GitGraphActionName,
  'stage-all' | 'unstage-all' | 'pull' | 'push' | 'fetch' | 'stash' | 'stash-pop'
>

/** Tallest the commit box grows before it scrolls (about five lines). */
const MESSAGE_MAX_HEIGHT = 110

/**
 * The Git tab's default body, modeled on VSCode's source-control panel: an
 * auto-growing multi-line commit box on top (Mod+Enter commits), a toolbar
 * with the view toggles, the segmented commit button (its chevron lists the
 * commit variants, including amend) and an overflow menu for the remaining
 * git operations, then the staged/changes file groups.
 */
export function GitChangesView(props: GitChangesViewProps) {
  const { cwd, t, onOpenFile, onOpenGraph } = props
  const [refreshSeq, setRefreshSeq] = useState(0)
  const [display, setDisplay] = useState<'flat' | 'tree'>('flat')
  const [busyAction, setBusyAction] = useState<GitGraphActionName | null>(null)
  const busy = busyAction !== null
  const [commitMenuOpen, setCommitMenuOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [counts, setCounts] = useState({ staged: 0, total: 0 })
  const [commitAll, setCommitAll] = useState<{ action: CommitAction; message: string } | null>(null)
  const [discardFile, setDiscardFile] = useState<GitChangeFile | null>(null)
  const [discardDir, setDiscardDir] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string; kind: 'ok' | 'error' } | null>(null)
  const toastSeq = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const commitMoreRef = useRef<HTMLButtonElement>(null)
  const overflowRef = useRef<HTMLButtonElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  const showToast = useCallback((text: string, kind: 'ok' | 'error') => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text, kind })
  }, [])
  const refresh = useCallback(() => setRefreshSeq((seq) => seq + 1), [])

  // Auto-refresh, VSCode-style: the host's repo watcher pushes a `change`
  // event over SSE whenever the worktree, index, or refs move. Window focus
  // and tab visibility backstop environments where EventSource cannot
  // connect (Electron's fetch bridge) or a watch event was missed.
  useEffect(() => {
    if (cwd === undefined || cwd.length === 0) return
    let source: EventSource | undefined
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(
        `${GIT_GRAPH_WATCH_PATH}?cwd=${encodeURIComponent(cwd)}`,
      )
      source.addEventListener('change', refresh)
    }
    const onFocus = (): void => refresh()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      source?.close()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cwd, refresh])

  // Auto-grow the commit box with its content, capped at MESSAGE_MAX_HEIGHT.
  useEffect(() => {
    const el = messageRef.current
    if (el === null) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, MESSAGE_MAX_HEIGHT) + 'px'
  }, [message])

  const onFilesChange = useCallback((files: readonly GitChangeFile[]) => {
    let staged = 0
    for (const file of files) {
      if (file.staged === true) staged += 1
    }
    setCounts({ staged, total: files.length })
  }, [])

  const run = useCallback(async (
    action: GitGraphActionName,
    commitMessage?: string,
    path?: string,
    all?: boolean,
  ): Promise<boolean> => {
    if (cwd === undefined || cwd.length === 0) {
      showToast(t('gitGraph.noCwd'), 'error')
      return false
    }
    setBusyAction(action)
    const request: GitGraphActionRequest = { cwd, action }
    if (commitMessage !== undefined) request.message = commitMessage
    if (path !== undefined) request.path = path
    if (all === true) request.all = true
    const result = await postAction(request)
    setBusyAction(null)
    if (!result.ok) {
      showToast(result.message, 'error')
      return false
    }
    // Row-level workdir actions stay silent; the list refresh is the feedback.
    if (action !== 'stage' && action !== 'unstage' && action !== 'discard') {
      showToast(result.message ?? t('gitGraph.actionOk'), 'ok')
    }
    refresh()
    return true
  }, [cwd, refresh, showToast, t])

  const submitCommit = (action: CommitAction, all?: boolean): void => {
    const text = message.trim()
    if (text.length === 0 || busy) return
    const isAmend = action === 'commit-amend' || action === 'commit-push-amend'
    // VSCode parity: committing with nothing staged asks to stage all first.
    // Amend is exempt — it rewrites the tip commit, not the worktree state.
    if (all !== true && !isAmend && counts.staged === 0 && counts.total > 0) {
      setCommitAll({ action, message: text })
      return
    }
    void run(action, text, undefined, all).then((ok) => {
      if (ok) setMessage('')
    })
  }

  // Progress label inside the commit button while a commit action runs.
  const commitProgress = busyAction === 'commit' || busyAction === 'commit-amend'
    ? t('gitGraph.committing')
    : busyAction === 'commit-push' || busyAction === 'commit-push-amend'
      ? t('gitGraph.pushing')
      : undefined

  const generateMessage = async (): Promise<void> => {
    if (generating || cwd === undefined || cwd.length === 0) return
    setGenerating(true)
    const result = await postMessage(cwd)
    setGenerating(false)
    if (!result.ok) {
      showToast(result.message, 'error')
      return
    }
    setMessage(result.message)
    messageRef.current?.focus()
  }

  const onSelectCommitVariant = (id: string): void => {
    setCommitMenuOpen(false)
    if (busy) return
    submitCommit(id as CommitAction)
  }

  const onSelectOverflow = (id: string): void => {
    setOverflowOpen(false)
    if (busy) return
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
        <textarea
          ref={messageRef}
          className="dsh-git-changes-message"
          rows={1}
          value={message}
          placeholder={t('gitGraph.commitPlaceholder').replace('{mod}', modKey())}
          aria-label={t('gitGraph.commitMessage')}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            submitCommit('commit')
          }}
        />
        <div className="dsh-git-changes-toolbar">
          <button
            type="button"
            className={'dsh-git-changes-icon' + (generating ? ' is-generating' : '')}
            disabled={generating}
            aria-label={t('gitGraph.generateMessage')}
            title={t('gitGraph.generateMessage')}
            onClick={() => void generateMessage()}
          >
            {generating ? <IconLoadingOutline16 size={16} /> : <IconSparkle16 size={16} />}
          </button>
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
          <span className="dsh-git-changes-spacer" />
          <div className="dsh-git-changes-commit">
            <button
              type="button"
              className="dsh-git-changes-commit-main"
              disabled={busy || message.trim().length === 0}
              onClick={() => submitCommit('commit')}
            >
              {commitProgress === undefined ? t('gitGraph.commit') : (
                <>
                  <span className="dsh-git-changes-commit-spinner" aria-hidden="true">
                    <IconLoadingOutline16 size={14} />
                  </span>
                  {commitProgress}
                </>
              )}
            </button>
            <button
              ref={commitMoreRef}
              type="button"
              className="dsh-git-changes-commit-more"
              disabled={busy}
              aria-label={t('gitGraph.commitVariants')}
              aria-expanded={commitMenuOpen}
              title={t('gitGraph.commitVariants')}
              onClick={() => setCommitMenuOpen((open) => !open)}
            >
              <IconChevronDownOutline14 size={14} />
            </button>
          </div>
          <button
            ref={overflowRef}
            type="button"
            className="dsh-git-changes-icon"
            aria-label={t('gitGraph.moreActions')}
            aria-expanded={overflowOpen}
            title={t('gitGraph.moreActions')}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <IconEllipsisOutline16 size={16} />
          </button>
        </div>
      </div>
      {/* refreshSeq re-fetches in place (rows and tree state survive); the
          keyed Toast below must keep its `toast-` prefix — two siblings
          sharing a numeric key corrupt React's keyed reconciliation. */}
      <GitGraphDetail
        cwd={cwd}
        t={t}
        display={display}
        refreshSeq={refreshSeq}
        onOpenFile={(file, sha) => onOpenFile?.(file, sha)}
        onStageChange={(file, stage) => void run(stage ? 'stage' : 'unstage', undefined, file.path)}
        onStageAll={() => void run('stage-all')}
        onUnstageAll={() => void run('unstage-all')}
        onDiscard={(file) => setDiscardFile(file)}
        onStageDirChange={(path, stage) => void run(stage ? 'stage' : 'unstage', undefined, path)}
        onDiscardDir={(path) => setDiscardDir(path)}
        onFilesChange={onFilesChange}
      />
      <Menu
        open={commitMenuOpen}
        portal
        dense
        side="bottom"
        align="end"
        anchor={<span className="dsh-git-graph-menu-anchor" aria-hidden="true" />}
        getAnchorRect={() => commitMoreRef.current?.getBoundingClientRect() ?? null}
        items={commitVariantItems(t)}
        onSelect={onSelectCommitVariant}
        onClose={() => setCommitMenuOpen(false)}
      />
      <Menu
        open={overflowOpen}
        portal
        dense
        side="bottom"
        align="end"
        anchor={<span className="dsh-git-graph-menu-anchor" aria-hidden="true" />}
        getAnchorRect={() => overflowRef.current?.getBoundingClientRect() ?? null}
        items={overflowItems(t)}
        onSelect={onSelectOverflow}
        onClose={() => setOverflowOpen(false)}
      />
      <Modal
        open={commitAll !== null}
        onClose={() => setCommitAll(null)}
        title={t('gitGraph.commitAllTitle')}
        closeLabel={t('gitGraph.close')}
        description={t('gitGraph.confirmCommitAll')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setCommitAll(null)}>
              {t('gitGraph.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => {
                const pending = commitAll
                setCommitAll(null)
                if (pending === null) return
                void run(pending.action, pending.message, undefined, true).then((ok) => {
                  if (ok) setMessage('')
                })
              }}
            >
              {t('gitGraph.commitAllConfirm')}
            </Button>
          </>
        )}
      />
      <Modal
        open={discardFile !== null}
        onClose={() => setDiscardFile(null)}
        title={t('gitGraph.discard')}
        closeLabel={t('gitGraph.close')}
        description={t(discardFile?.status === 'untracked'
          ? 'gitGraph.confirmDiscardUntracked'
          : 'gitGraph.confirmDiscardFile').replace('{file}', discardFile?.path ?? '')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setDiscardFile(null)}>
              {t('gitGraph.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => {
                const file = discardFile
                setDiscardFile(null)
                if (file === null) return
                void run('discard', undefined, file.path)
              }}
            >
              {t('gitGraph.discardConfirm')}
            </Button>
          </>
        )}
      />
      <Modal
        open={discardDir !== null}
        onClose={() => setDiscardDir(null)}
        title={t('gitGraph.discard')}
        closeLabel={t('gitGraph.close')}
        description={t('gitGraph.confirmDiscardDir').replace('{file}', discardDir ?? '')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setDiscardDir(null)}>
              {t('gitGraph.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => {
                const dir = discardDir
                setDiscardDir(null)
                if (dir === null) return
                void run('discard', undefined, dir)
              }}
            >
              {t('gitGraph.discardConfirm')}
            </Button>
          </>
        )}
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

/**
 * Folder-tree glyph, hand-drawn to the DSH fill-type spec (16px grid, 1.3px
 * stroke equivalent) — the primitives sheet has no tree glyph.
 */
function IconFolderTree(props: { size?: number }) {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2.55 1.8h1.3v12.4h-1.3z" fill="currentColor" />
      <path d="M3.85 4.85h2.55v1.3H3.85z" fill="currentColor" />
      <path d="M3.85 10.85h2.55v1.3H3.85z" fill="currentColor" />
      <path
        d="M8 3.1h3.6a1.6 1.6 0 0 1 1.6 1.6v1.6a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6V4.7A1.6 1.6 0 0 1 8 3.1z"
        fill="currentColor"
      />
      <path
        d="M8 9.1h3.6a1.6 1.6 0 0 1 1.6 1.6v1.6a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6v-1.6A1.6 1.6 0 0 1 8 9.1z"
        fill="currentColor"
      />
    </svg>
  )
}

/** The commit button's chevron menu: every way to create the commit. */
function commitVariantItems(t: (key: string) => string): readonly MenuEntry[] {
  return [
    { id: 'commit', label: t('gitGraph.commit') },
    { id: 'commit-push', label: t('gitGraph.commitPush') },
    { type: 'separator', id: 'sep-amend' },
    { id: 'commit-amend', label: t('gitGraph.commitAmend') },
    { id: 'commit-push-amend', label: t('gitGraph.commitPushAmend') },
  ]
}

/** The overflow menu: workdir batch actions, remotes, and the stash. */
function overflowItems(t: (key: string) => string): readonly MenuEntry[] {
  return [
    { id: 'stage-all', label: t('gitGraph.stageAll') },
    { id: 'unstage-all', label: t('gitGraph.unstageAll') },
    { id: 'discard-all', label: t('gitGraph.discardAll'), danger: true },
    { type: 'separator', id: 'sep-remote' },
    { id: 'pull', label: t('gitGraph.pull') },
    { id: 'push', label: t('gitGraph.push') },
    { id: 'fetch', label: t('gitGraph.fetch') },
    { type: 'separator', id: 'sep-stash' },
    { id: 'stash', label: t('gitGraph.stash') },
    { id: 'stash-pop', label: t('gitGraph.stashPop') },
  ]
}

/** The platform's primary modifier, for the commit shortcut hint. */
function modKey(): string {
  if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)) {
    return '⌘'
  }
  return 'Ctrl+'
}

async function postMessage(cwd: string): Promise<GitGraphMessageResponse> {
  try {
    const response = await fetch(GIT_GRAPH_MESSAGE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ cwd }),
    })
    const value = await response.json() as GitGraphMessageResponse
    if (typeof value.ok !== 'boolean') {
      return { ok: false, code: 'git', message: `request failed: ${response.status}` }
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
