import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconSearchOutline16,
  Input,
  Menu,
  type MenuEntry,
} from '@just-genius/dsh-plugin-ui'
import {
  type GitChangeStatus,
  type GitFileDiff,
  type GitGraphDiffResponse,
  type GitGraphFileOk,
  type GitGraphFileResponse,
  type GitGraphTreeResponse,
  type GitTreeEntry,
} from '../../../shared/git-graph'
import type { PanelNavState } from '../side-panels/service'
import { fileIconSvg, folderIconSvg } from './file-icons'
import { subscribeRepoWatch } from '../repo-watch'
import { FileCodeView, FileDiffView, FileMarkdownView, type ViewLabels } from './file-views'
import type { FileReviewComment } from './review-comment'
import { isMarkdownFile } from './markdown'
import { ensureFilesStyles } from './styles'
import { fetchDiff, fetchFile, fetchTree, fetchTreeSearch } from './files-api'

ensureFilesStyles()

const STATUS_LABEL: Record<GitChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflicted: 'U',
}

export interface FilesPanelProps {
  sessionId: string
  cwd?: string
  instanceKey?: string
  t: (key: string) => string
  /** Navigation target this instance was opened with (mode/file/sha). */
  navState?: PanelNavState
  /** Open a NEW files instance (multi panel): switch form or navigate. */
  onOpen: (state: PanelNavState) => void
  /**
   * When false, the tree hides gitignored paths (`ignored=0` on the host).
   * Defaults to true (VS Code Explorer default).
   */
  showIgnored?: boolean
  /**
   * Whether this pane is the active visible tab. Hidden retained panes skip
   * the repo-watch SSE so many sessions cannot exhaust the connection pool.
   * Defaults to true.
   */
  visible?: boolean
  /**
   * Light syntax-highlight theme id (see files/themes.ts). Fed into the code
   * views so a settings change re-highlights the open file in place.
   */
  highlightThemeLight?: string
  /** Dark syntax-highlight theme id (see files/themes.ts). */
  highlightThemeDark?: string
  /**
   * Insert a worktree file into the conversation draft as an `@file` chip.
   * Wired by the feature wrapper; omitted when conversation is unavailable.
   */
  onAddToChat?: (path: string) => boolean
  /** Append an inline file/diff review comment to the conversation draft. */
  onAddComment?: (comment: FileReviewComment) => boolean
}

/**
 * The `files` side panel: ONE panel, ONE form per instance.
 *
 * A `files` instance shows exactly one of:
 *  - tree — the working-tree directory browser
 *  - preview — one file's contents
 *  - diff — one file's change (working tree vs HEAD, or one commit)
 *
 * Because the panel is `multi`, switching form or opening a file opens a NEW
 * instance (a new tab), each driven by its own `navState` from the store. The
 * `onOpen` prop tells the feature wrapper to do that.
 */
export function FilesPanel(props: FilesPanelProps) {
  const { cwd, t, navState } = props
  const mode = navState?.mode ?? 'tree'
  const file = navState?.file
  const sha = navState?.sha
  const showIgnored = props.showIgnored !== false
  const visible = props.visible !== false

  return (
    <div className="dsh-files">
      {cwd === undefined ? (
        <div className="dsh-files-status">{t('files.noCwd')}</div>
      ) : mode === 'tree' ? (
        <FilesTree
          cwd={cwd}
          t={t}
          onOpen={props.onOpen}
          showIgnored={showIgnored}
          visible={visible}
          onAddToChat={props.onAddToChat}
        />
      ) : file === undefined ? (
        <div className="dsh-files-status">{t('files.noCwd')}</div>
      ) : mode === 'preview' ? (
        <FileLoader
          cwd={cwd}
          file={file}
          sha={sha}
          t={t}
          render={(data, busy, error) => (
            error !== undefined ? (
              <div className="dsh-files-status is-error">{error}</div>
            ) : (
              <FilesPreview
                file={file}
                data={data}
                busy={busy}
                t={t}
                highlightThemeLight={props.highlightThemeLight}
                highlightThemeDark={props.highlightThemeDark}
                onAddComment={props.onAddComment}
              />
            )
          )}
        />
      ) : (
        <DiffLoader
          cwd={cwd}
          file={file}
          sha={sha}
          t={t}
          render={(diff, busy, error) => (
            error !== undefined ? (
              <div className="dsh-files-status is-error">{error}</div>
            ) : (
              <FilesDiffView
                file={file}
                diff={diff}
                busy={busy}
                t={t}
                highlightThemeLight={props.highlightThemeLight}
                highlightThemeDark={props.highlightThemeDark}
                onAddComment={props.onAddComment}
              />
            )
          )}
        />
      )}
    </div>
  )
}

/** Search results render at most this many rows; the rest is summarized. */
const MAX_SEARCH_ROWS = 200
/** Collapse watch/focus storms the way VS Code's ExplorerService does (500ms). */
const TREE_REFRESH_DEBOUNCE_MS = 400

/**
 * Working-tree file browser (VS Code Explorer style).
 *
 * Each directory is loaded on demand from the real filesystem — gitignored
 * folders like `node_modules` appear when their parent is listed. Expand
 * waits for children (hover prefetches) so the row never flashes a loader.
 * Panel search hits a bounded host-side walk (`?q=`). A shared repo watch
 * SSE (plus focus/visibility) silently re-fetches the root and every
 * currently expanded folder.
 */
interface FileContextMenuState {
  path: string
  x: number
  y: number
}

function FilesTree(props: {
  cwd: string
  t: (key: string) => string
  onOpen: (state: PanelNavState) => void
  showIgnored: boolean
  visible: boolean
  onAddToChat?: (path: string) => boolean
}) {
  const { cwd, t, onOpen, showIgnored, visible, onAddToChat } = props
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  /** Children keyed by parent dir path (`''` = workspace root). */
  const [childrenByDir, setChildrenByDir] = useState<ReadonlyMap<string, readonly GitTreeEntry[]>>(
    () => new Map(),
  )
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [matches, setMatches] = useState<readonly GitTreeEntry[] | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)

  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const childrenRef = useRef(childrenByDir)
  childrenRef.current = childrenByDir
  /** Coalesce expand + hover prefetch onto one in-flight promise per path. */
  const loadingDirsRef = useRef(new Map<string, Promise<boolean>>())

  const applyDir = useCallback((dir: string, entries: readonly GitTreeEntry[]): void => {
    setChildrenByDir((current) => {
      const next = new Map(current)
      next.set(dir, entries)
      // Keep the ref in sync inside the updater so callers that await loadDir
      // (expand-after-fetch) see the cache before the next paint. Reading the
      // ref right after applyDir used to miss and abort the expand.
      childrenRef.current = next
      return next
    })
  }, [])

  const loadDir = useCallback(async (dir: string, opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent === true
    if (!silent && dir === '') {
      setBusy(true)
      setError(undefined)
    }
    const inflight = loadingDirsRef.current.get(dir)
    if (inflight !== undefined) return inflight

    const promise = (async (): Promise<boolean> => {
      const value = await fetchTree(cwd, dir, showIgnored)
      if (!value.ok) {
        if (dir === '') {
          setBusy(false)
          setError(value.message)
        }
        return false
      }
      applyDir(dir, value.entries)
      if (dir === '') setBusy(false)
      return true
    })()
    loadingDirsRef.current.set(dir, promise)
    try {
      return await promise
    } finally {
      loadingDirsRef.current.delete(dir)
    }
  }, [applyDir, cwd, showIgnored])

  // Initial root load (and whenever the workspace or ignore visibility changes).
  useEffect(() => {
    let cancelled = false
    setChildrenByDir(new Map())
    setExpanded(new Set())
    setMatches(null)
    setQuery('')
    setBusy(true)
    setError(undefined)
    loadingDirsRef.current.clear()
    void loadDir('').then(() => {
      if (cancelled) return
    })
    return () => { cancelled = true }
  }, [cwd, loadDir])

  // Live refresh only while this pane is visible: shared watch SSE (one
  // EventSource per cwd) + focus/visibility as a backstop. Hidden retained
  // panes unsubscribe so multi-session workspaces cannot exhaust the ~6
  // HTTP/1.1 connections to this origin.
  useEffect(() => {
    if (!visible) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const refreshOpen = (): void => {
      if (cancelled) return
      const dirs = ['', ...expandedRef.current]
      void Promise.all(dirs.map((dir) => loadDir(dir, { silent: true })))
    }
    const schedule = (): void => {
      clearTimeout(debounce)
      debounce = setTimeout(refreshOpen, TREE_REFRESH_DEBOUNCE_MS)
    }

    const unsubscribe = subscribeRepoWatch(cwd, schedule)
    // Catch up after the pane was hidden (missed watch events).
    schedule()
    const onFocus = (): void => schedule()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') schedule()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cwd, loadDir, visible])

  /** Warm a collapsed folder so the next expand paints with children ready. */
  const prefetchDir = useCallback((dir: string): void => {
    if (childrenRef.current.has(dir) || loadingDirsRef.current.has(dir)) return
    void loadDir(dir, { silent: true })
  }, [loadDir])

  const toggle = useCallback((dir: string): void => {
    if (expandedRef.current.has(dir)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(dir)
        return next
      })
      return
    }
    // Cached → open immediately. Otherwise fetch first, then open — never
    // paint an empty / "…" child slot under the folder (VS Code has no flash
    // because local resolve finishes before the next frame).
    if (childrenRef.current.has(dir)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.add(dir)
        return next
      })
      return
    }
    void loadDir(dir, { silent: true }).then((ok) => {
      // applyDir already wrote childrenRef; only bail on fetch failure.
      if (!ok || !childrenRef.current.has(dir)) return
      setExpanded((current) => {
        const next = new Set(current)
        next.add(dir)
        return next
      })
    })
  }, [loadDir])

  const needle = query.trim()
  // Host-side search whenever the query is non-empty (debounced lightly).
  useEffect(() => {
    if (needle.length === 0) {
      setMatches(null)
      setSearchBusy(false)
      return
    }
    let cancelled = false
    setSearchBusy(true)
    setMatches(null)
    const timer = setTimeout(() => {
      void fetchTreeSearch(cwd, needle, showIgnored)
        .then((value) => {
          if (cancelled) return
          if (!value.ok) {
            setMatches([])
            return
          }
          setMatches(value.entries.filter((entry) => entry.kind === 'file'))
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cwd, needle, showIgnored])

  const rootEntries = childrenByDir.get('')
  const searchList = matches ?? []

  const openFileMenu = useCallback((event: ReactMouseEvent, path: string): void => {
    if (onAddToChat === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ path, x: event.clientX, y: event.clientY })
  }, [onAddToChat])

  const menuItems = useMemo((): readonly MenuEntry[] => {
    if (onAddToChat === undefined) return []
    return [{ id: 'add-to-chat', label: t('context.addToChat') }]
  }, [onAddToChat, t])

  const onMenuSelect = useCallback((id: string): void => {
    if (contextMenu === null) return
    if (id === 'add-to-chat') onAddToChat?.(contextMenu.path)
    setContextMenu(null)
  }, [contextMenu, onAddToChat])

  return (
    <div className="dsh-files-tree">
      <div className="dsh-files-search">
        <Input
          className="dsh-files-search-input"
          icon={<IconSearchOutline16 />}
          placeholder={t('files.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="dsh-files-tree-list">
        {error !== undefined ? (
          <div className="dsh-files-status is-error">{error}</div>
        ) : needle.length > 0 ? (
          searchBusy && matches === null ? (
            <div className="dsh-files-status">{t('files.loading')}</div>
          ) : searchList.length === 0 ? (
            <div className="dsh-files-status">{t('files.searchEmpty')}</div>
          ) : (
            <>
              {searchList.slice(0, MAX_SEARCH_ROWS).map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onOpen={onOpen}
                  onContextMenu={openFileMenu}
                  hint
                />
              ))}
              {searchList.length >= MAX_SEARCH_ROWS ? (
                <div className="dsh-files-status dsh-files-tree-note">
                  {t('files.searchTruncated').replace('{count}', String(MAX_SEARCH_ROWS))}
                </div>
              ) : null}
            </>
          )
        ) : busy && rootEntries === undefined ? (
          <div className="dsh-files-status">{t('files.loading')}</div>
        ) : rootEntries === undefined || rootEntries.length === 0 ? (
          <div className="dsh-files-status">{t('files.empty')}</div>
        ) : (
          <TreeLevel
            nodes={rootEntries}
            depth={0}
            expanded={expanded}
            childrenByDir={childrenByDir}
            onToggle={toggle}
            onPrefetch={prefetchDir}
            onOpen={onOpen}
            onContextMenu={openFileMenu}
          />
        )}
      </div>
      {onAddToChat !== undefined ? (
        <Menu
          open={contextMenu !== null}
          portal
          dense
          side="bottom"
          align="start"
          anchor={<span className="dsh-files-menu-anchor" aria-hidden="true" />}
          getAnchorRect={() => (
            contextMenu === null
              ? null
              : new DOMRect(contextMenu.x, contextMenu.y, 1, 1)
          )}
          items={menuItems}
          onSelect={onMenuSelect}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  )
}

/** One directory level; children come from the lazy `childrenByDir` map. */
function TreeLevel(props: {
  nodes: readonly GitTreeEntry[]
  depth: number
  expanded: ReadonlySet<string>
  childrenByDir: ReadonlyMap<string, readonly GitTreeEntry[]>
  onToggle: (dir: string) => void
  /** Hover warm-up so expand usually paints with children already cached. */
  onPrefetch: (dir: string) => void
  onOpen: (state: PanelNavState) => void
  onContextMenu?: (event: ReactMouseEvent, path: string) => void
  /**
   * Ancestor folder was gitignored — paint every descendant faded even if a
   * nested listing omitted the flag (VS Code Explorer under node_modules).
   */
  ancestorIgnored?: boolean
}) {
  const {
    nodes, depth, expanded, childrenByDir, onToggle, onPrefetch, onOpen,
    onContextMenu, ancestorIgnored = false,
  } = props
  return (
    <>
      {nodes.map((node) => {
        const ignored = ancestorIgnored || node.ignored === true
        if (node.kind === 'file') {
          return (
            <FileRow
              key={node.path}
              entry={node}
              depth={depth}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              ignored={ignored}
            />
          )
        }
        const open = expanded.has(node.path)
        const children = childrenByDir.get(node.path)
        return (
          <div key={node.path}>
            <div
              className={'dsh-files-tree-row' + (ignored ? ' is-ignored' : '')}
              style={{ paddingLeft: 8 + depth * 14 }}
              onMouseEnter={() => onPrefetch(node.path)}
            >
              <button
                type="button"
                className="dsh-files-tree-row-main"
                onClick={() => onToggle(node.path)}
                title={ignored ? `${node.path} (gitignore)` : node.path}
              >
                {open
                  ? <IconChevronDownOutline14 className="dsh-files-tree-chevron" />
                  : <IconChevronRightOutline14 className="dsh-files-tree-chevron" />}
                <span
                  className="dsh-files-folder-glyph"
                  // Icon markup is generated from the bundled vscode-icons set.
                  dangerouslySetInnerHTML={{ __html: folderIconSvg(node.name, open) }}
                />
                <span className="dsh-files-tree-name">{node.name}</span>
              </button>
            </div>
            {/* Only expand after children are cached — never paint a loader slot. */}
            {open && children !== undefined && children.length > 0 ? (
              <TreeLevel
                nodes={children}
                depth={depth + 1}
                expanded={expanded}
                childrenByDir={childrenByDir}
                onToggle={onToggle}
                onPrefetch={onPrefetch}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
                ancestorIgnored={ignored}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/** One file row: click opens a preview instance. */
function FileRow(props: {
  entry: GitTreeEntry
  depth: number
  onOpen: (state: PanelNavState) => void
  onContextMenu?: (event: ReactMouseEvent, path: string) => void
  /** Show the parent directory after the name (search results are flat). */
  hint?: boolean
  /** Override when an ancestor directory is ignored. */
  ignored?: boolean
}) {
  const { entry, depth, onOpen, onContextMenu, hint } = props
  const ignored = props.ignored === true || entry.ignored === true
  return (
    <div
      className={'dsh-files-tree-row' + (ignored ? ' is-ignored' : '')}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <button
        type="button"
        className="dsh-files-tree-row-main"
        onClick={() => onOpen({ mode: 'preview', file: entry.path })}
        onContextMenu={onContextMenu === undefined
          ? undefined
          : (event) => onContextMenu(event, entry.path)}
        title={ignored ? `${entry.path} (gitignore)` : entry.path}
      >
        <span className="dsh-files-tree-chevron" />
        <FileGlyph name={entry.name} />
        <span className="dsh-files-tree-name">{entry.name}</span>
        {hint === true ? (
          <span className="dsh-files-tree-dir">{parentOf(entry.path)}</span>
        ) : null}
        {entry.status !== undefined ? (
          <span className={'dsh-files-status-badge is-' + entry.status}>
            {STATUS_LABEL[entry.status]}
          </span>
        ) : null}
      </button>
    </div>
  )
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Loads a file's content and renders it through `render`. */
function FileLoader(props: {
  cwd: string
  file: string
  sha?: string
  t: (key: string) => string
  render: (
    data: GitGraphFileOk | null,
    busy: boolean,
    error: string | undefined,
  ) => React.ReactNode
}) {
  const { cwd, file, sha, render } = props
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [data, setData] = useState<GitGraphFileOk | null>(null)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(undefined)
    setData(null)
    void fetchFile(cwd, file, sha).then((value) => {
      if (cancelled) return
      setBusy(false)
      if (!value.ok) {
        setError(value.message)
        setData(null)
        return
      }
      setData(value)
    })
    return () => { cancelled = true }
  }, [cwd, file, sha])

  return <>{render(data, busy, error)}</>
}

/** Loads a file's diff and renders it through `render`. */
function DiffLoader(props: {
  cwd: string
  file: string
  sha?: string
  t: (key: string) => string
  render: (
    diff: GitFileDiff | null,
    busy: boolean,
    error: string | undefined,
  ) => React.ReactNode
}) {
  const { cwd, file, sha, render } = props
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [diff, setDiff] = useState<GitFileDiff | null>(null)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(undefined)
    void fetchDiff(cwd, file, sha).then((value) => {
      if (cancelled) return
      setBusy(false)
      if (!value.ok) {
        setError(value.message)
        return
      }
      setDiff(value.diff)
    })
    return () => { cancelled = true }
  }, [cwd, file, sha])

  return <>{render(diff, busy, error)}</>
}

/**
 * File-type icon for the tree, from the bundled vscode-icons set
 * (see file-icons-data.ts). Unknown extensions fall back to the generic
 * file icon.
 */
function FileGlyph(props: { name: string }) {
  return (
    <span
      className="dsh-files-file-glyph"
      // Icon markup is generated from the bundled vscode-icons set.
      dangerouslySetInnerHTML={{ __html: fileIconSvg(props.name) }}
    />
  )
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

/**
 * Well-known filenames whose language isn't conveyed by an extension
 * (`Dockerfile`, `Makefile`, …). Keys are lowercase basenames.
 */
const FILENAME_LANG_HINTS = new Map([
  ['dockerfile', 'docker'],
  ['containerfile', 'docker'],
  ['makefile', 'make'],
  ['gnumakefile', 'make'],
  ['cmakelists.txt', 'cmake'],
  ['gemfile', 'ruby'],
  ['rakefile', 'ruby'],
  ['podfile', 'ruby'],
  ['vagrantfile', 'ruby'],
  ['brewfile', 'ruby'],
  ['fastfile', 'ruby'],
  ['nginx.conf', 'nginx'],
  ['.editorconfig', 'ini'],
])

function langHintOf(path: string): string {
  const name = basename(path).toLowerCase()
  const byName = FILENAME_LANG_HINTS.get(name)
  if (byName !== undefined) return byName
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1)
}

function viewLabels(t: (key: string) => string): ViewLabels {
  return {
    expand: (count) => t('files.expand').replace('{count}', String(count)),
    unmodifiedLines: (count) => t(count === 1
      ? 'files.unmodifiedLine'
      : 'files.unmodifiedLines').replace('{count}', String(count)),
    findPlaceholder: t('files.findPlaceholder'),
    findNoResults: t('files.findNoResults'),
    findInvalidRegex: t('files.findInvalidRegex'),
    findMatchCount: (current, total) =>
      t('files.findMatchCount')
        .replace('{current}', String(current))
        .replace('{total}', String(total)),
    findPrev: t('files.findPrev'),
    findNext: t('files.findNext'),
    findClose: t('files.findClose'),
    findMatchCase: t('files.findMatchCase'),
    findWholeWord: t('files.findWholeWord'),
    findRegex: t('files.findRegex'),
    addComment: t('files.addComment'),
    commentPlaceholder: t('files.commentPlaceholder'),
    commentCancel: t('files.commentCancel'),
    commentSubmit: t('files.commentSubmit'),
    commentFailed: t('files.commentFailed'),
    commentAuthor: t('files.commentAuthor'),
    commentLine: (side, line) => t('files.commentLine')
      .replace('{side}', side === 'old' ? t('files.commentOld') : side === 'new' ? t('files.commentNew') : '')
      .replace('{line}', String(line)),
    commentLines: (side, start, end) => t('files.commentLines')
      .replace('{side}', side === 'old' ? t('files.commentOld') : side === 'new' ? t('files.commentNew') : '')
      .replace('{start}', String(start))
      .replace('{end}', String(end)),
  }
}

function FilesPreview(props: {
  file: string
  data: GitGraphFileOk | null
  busy: boolean
  t: (key: string) => string
  highlightThemeLight?: string
  highlightThemeDark?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { data, busy, t } = props
  if (busy && data === null) {
    return <div className="dsh-files-status">{t('files.loading')}</div>
  }
  if (data === null || !data.exists) {
    return <div className="dsh-files-status">{t('files.missing')}</div>
  }
  if (data.directory === true) {
    return <div className="dsh-files-status">{t('files.directory')}</div>
  }
  if (data.binary === true) {
    return <div className="dsh-files-status">{t('files.binary')}</div>
  }
  if (data.encoding === 'base64' && data.mime !== undefined) {
    return (
      <div className="dsh-files-image">
        <img
          src={'data:' + data.mime + ';base64,' + data.content}
          alt={basename(props.file)}
        />
      </div>
    )
  }
  return (
    <div className="dsh-files-preview">
      <FilesTextPreview
        file={props.file}
        content={data.content}
        t={t}
        highlightThemeLight={props.highlightThemeLight}
        highlightThemeDark={props.highlightThemeDark}
        onAddComment={props.onAddComment}
      />
    </div>
  )
}

type TextView = 'preview' | 'source'

/**
 * One text file's contents. Markdown documents get a two-way toggle between
 * the rendered preview and the raw source (VS Code's preview/editor split);
 * every other text file is the single highlighted source view.
 */
function FilesTextPreview(props: {
  file: string
  content: string
  t: (key: string) => string
  highlightThemeLight?: string
  highlightThemeDark?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { file, content, t } = props
  const markdown = isMarkdownFile(file)
  const [view, setView] = useState<TextView>(() => (markdown ? 'preview' : 'source'))
  // A new file/instance (or a different file in the same instance) resets to
  // the default view so the toggle never carries stale state across files.
  useEffect(() => {
    setView(markdown ? 'preview' : 'source')
  }, [file, markdown])

  const themeKey = `${props.highlightThemeLight ?? ''}|${props.highlightThemeDark ?? ''}`

  if (!markdown) {
    return (
      <FileCodeView
        content={content}
        lang={langHintOf(file)}
        labels={viewLabels(t)}
        themeKey={themeKey}
        path={file}
        onAddComment={props.onAddComment}
      />
    )
  }

  return (
    <div className="dsh-files-md">
      <div className="dsh-files-md-bar">
        <MarkdownToggle view={view} t={t} onSelect={setView} />
      </div>
      {view === 'preview' ? (
        <FileMarkdownView content={content} themeKey={themeKey} />
      ) : (
        <FileCodeView
          content={content}
          lang={langHintOf(file)}
          labels={viewLabels(t)}
          themeKey={themeKey}
          path={file}
          onAddComment={props.onAddComment}
        />
      )}
    </div>
  )
}

/** Segmented control switching a markdown file between preview and source. */
function MarkdownToggle(props: {
  view: TextView
  t: (key: string) => string
  onSelect: (view: TextView) => void
}) {
  const { view, t, onSelect } = props
  return (
    <div className="dsh-files-md-toggle" role="tablist" aria-label={t('files.markdownAria')}>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'preview'}
        className={view === 'preview' ? 'is-active' : ''}
        onClick={() => onSelect('preview')}
      >
        {t('files.preview')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'source'}
        className={view === 'source' ? 'is-active' : ''}
        onClick={() => onSelect('source')}
      >
        {t('files.markdown')}
      </button>
    </div>
  )
}

function FilesDiffView(props: {
  file: string
  diff: GitFileDiff | null
  busy: boolean
  t: (key: string) => string
  highlightThemeLight?: string
  highlightThemeDark?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { diff, busy, t } = props
  if (busy && diff === null) {
    return <div className="dsh-files-status">{t('files.loading')}</div>
  }
  if (diff === null) {
    return <div className="dsh-files-status">{t('files.noDiff')}</div>
  }
  return (
    <div className="dsh-files-diff">
      <FileDiffView
        patch={diff.patch}
        lang={langHintOf(props.file)}
        labels={viewLabels(t)}
        themeKey={`${props.highlightThemeLight ?? ''}|${props.highlightThemeDark ?? ''}`}
        path={props.file}
        onAddComment={props.onAddComment}
      />
    </div>
  )
}
