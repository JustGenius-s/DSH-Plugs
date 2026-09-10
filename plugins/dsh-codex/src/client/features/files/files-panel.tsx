import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconSearchOutline16,
  Input,
  Menu,
  type MenuEntry,
  Toast,
  writeClipboard,
} from '@just-genius/dsh-plugin-ui'
import {
  type GitChangeStatus,
  type GitFileDiff,
  type GitGraphFileOk,
  type GitTreeEntry,
} from '../../../shared/git-graph'
import type { FilesNavigationState } from './resource-address'
import { fileIconSvg, folderIconSvg } from './file-icons'
import { subscribeRepoWatch } from '../repo-watch'
import {
  absolutePathOf,
  relativePathOf,
  revealPath,
} from './files-actions'
import { buildFilesMenu } from './files-menu'
import { FileCodeView, FileDiffView, FileMarkdownView, type ViewLabels } from './file-views'
import type { FileReviewComment } from './review-comment'
import { isMarkdownFile } from './markdown'
import { ensureFilesStyles } from './styles'
import { fetchDiff, fetchFile } from './files-api'
import { createFilesTreeStore, type FilesTreeStore } from './tree-store'

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
  cwd?: string
  t: (key: string) => string
  /** Navigation target this instance was opened with (mode/file/sha). */
  navState?: FilesNavigationState
  /** Durable state for the official Sidebar tab occurrence. */
  treeStore?: FilesTreeStore
  /** Navigate through the official Sidebar to another files tab or resource. */
  onOpen: (state: FilesNavigationState) => void
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
   * Insert a worktree path into the conversation draft as an `@path` chip —
   * a directory mention keeps its trailing slash and folder glyph.
   * Wired by the feature wrapper; omitted when conversation is unavailable.
   */
  onAddToChat?: (path: string, kind: 'file' | 'dir') => boolean
  /** Append an inline file/diff review comment to the conversation draft. */
  onAddComment?: (comment: FileReviewComment) => boolean
}

/**
 * The rich Files body mounted into DSH's official right Sidebar.
 *
 * A `files` instance shows exactly one of:
 *  - tree — the working-tree directory browser
 *  - preview — one file's contents
 *  - diff — one file's change (working tree vs HEAD, or one commit)
 *
 * The tree is a page tab. Preview and diff bodies are resource tabs whose
 * navigation params select the form; `onOpen` delegates placement/reveal to
 * the official Sidebar controller.
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
          store={props.treeStore}
        />
      ) : file === undefined ? (
        <div className="dsh-files-status">{t('files.noCwd')}</div>
      ) : mode === 'preview' ? (
        <FileLoader
          cwd={cwd}
          file={file}
          sha={sha}
          render={(data, busy, error) => (
            error !== undefined ? (
              <div className="dsh-files-status is-error">{error}</div>
            ) : (
              <FilesPreview
                file={file}
                data={data}
                busy={busy}
                visible={visible}
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
  /** Directory rows insert a folder mention (trailing slash, folder glyph). */
  kind: 'file' | 'dir'
  x: number
  y: number
}

function FilesTree(props: {
  cwd: string
  t: (key: string) => string
  onOpen: (state: FilesNavigationState) => void
  showIgnored: boolean
  visible: boolean
  onAddToChat?: (path: string, kind: 'file' | 'dir') => boolean
  store?: FilesTreeStore
}) {
  const { cwd, t, onOpen, showIgnored, visible, onAddToChat } = props
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const localStoreRef = useRef<FilesTreeStore | null>(null)
  if (props.store === undefined && localStoreRef.current === null) {
    localStoreRef.current = createFilesTreeStore()
  }
  const store = props.store ?? localStoreRef.current
  if (store === null) throw new Error('FilesTree requires a state store')
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  const {
    childrenByDir,
    busy,
    error,
    query,
    expanded,
    matches,
    searchBusy,
    hostInfo,
  } = snapshot
  const [notice, setNotice] = useState<{ seq: number; text: string } | null>(null)
  const noticeSeq = useRef(0)

  const showNotice = useCallback((text: string): void => {
    noticeSeq.current += 1
    setNotice({ seq: noticeSeq.current, text })
  }, [])

  useEffect(() => {
    store.configure(cwd, showIgnored)
  }, [cwd, showIgnored, store])

  useEffect(() => () => {
    if (props.store === undefined) store.dispose()
  }, [props.store, store])

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
      void store.refreshOpen()
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
  }, [store, visible])

  /** Warm a collapsed folder so the next expand paints with children ready. */
  const prefetchDir = useCallback((dir: string): void => {
    store.prefetch(dir)
  }, [store])

  const toggle = useCallback((dir: string): void => {
    void store.toggle(dir)
  }, [store])

  const needle = query.trim()

  const rootEntries = childrenByDir.get('')
  const searchList = matches ?? []

  const openFileMenu = useCallback((event: ReactMouseEvent, path: string, kind: 'file' | 'dir'): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ path, kind, x: event.clientX, y: event.clientY })
  }, [])

  const menuItems = useMemo((): readonly MenuEntry[] => {
    if (contextMenu === null) return []
    return buildFilesMenu(
      { path: contextMenu.path, kind: contextMenu.kind, cwd },
      { canAddToChat: onAddToChat !== undefined, hostInfo },
      t,
    )
  }, [contextMenu, cwd, hostInfo, onAddToChat, t])

  const onMenuSelect = useCallback((id: string): void => {
    if (contextMenu === null) return
    const { path, kind } = contextMenu
    setContextMenu(null)
    switch (id) {
      case 'add-to-chat':
        onAddToChat?.(path, kind)
        return
      case 'copy-path':
        void copyText(absolutePathOf(path, cwd), t, showNotice)
        return
      case 'copy-relative-path': {
        const relative = relativePathOf(path, cwd)
        if (relative !== undefined) void copyText(relative, t, showNotice)
        return
      }
      case 'reveal':
        void (async (): Promise<void> => {
          const result = await revealPath(cwd, path, kind)
          if (!result.ok) showNotice(t('context.revealFailed'))
        })()
        return
      default:
        return
    }
  }, [contextMenu, cwd, onAddToChat, showNotice, t])

  return (
    <div className="dsh-files-tree">
      <div className="dsh-files-search">
        <Input
          className="dsh-files-search-input"
          icon={<IconSearchOutline16 />}
          placeholder={t('files.searchPlaceholder')}
          value={query}
          onChange={(event) => store.setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="dsh-files-tree-list" data-dsh-codex-retained-scroll="">
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
      {menuItems.length > 0 ? (
        <Menu
          open={visible && contextMenu !== null}
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
      {/* Keyed so a repeated action re-triggers the 4s dismiss timer. */}
      {visible && notice !== null ? (
        <Toast key={notice.seq} text={notice.text} onDone={() => setNotice(null)} />
      ) : null}
    </div>
  )
}

/**
 * Put `text` on the clipboard and confirm it, or report the failure.
 *
 * Clipboard writes are user-gesture-scoped in most browsers, so this runs
 * straight from the menu's click handler — never after an await that would
 * lose the gesture and make the write a no-op.
 */
async function copyText(
  text: string,
  t: (key: string) => string,
  notice: (text: string) => void,
): Promise<void> {
  const copied = await writeClipboard(text)
  notice(copied ? t('context.copied') : t('context.copyFailed'))
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
  onOpen: (state: FilesNavigationState) => void
  onContextMenu?: (event: ReactMouseEvent, path: string, kind: 'file' | 'dir') => void
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
                onContextMenu={onContextMenu === undefined
                  ? undefined
                  : (event) => onContextMenu(event, node.path, 'dir')}
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
  onOpen: (state: FilesNavigationState) => void
  onContextMenu?: (event: ReactMouseEvent, path: string, kind: 'file' | 'dir') => void
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
          : (event) => onContextMenu(event, entry.path, 'file')}
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
  visible: boolean
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
      <div className="dsh-files-image" data-dsh-codex-retained-scroll="">
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
        visible={props.visible}
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
  visible: boolean
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
        visible={props.visible}
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
          visible={props.visible}
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
