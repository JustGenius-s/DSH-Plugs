import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconSearchOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  GIT_GRAPH_DIFF_PATH,
  GIT_GRAPH_FILE_PATH,
  GIT_GRAPH_TREE_PATH,
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
import { FileCodeView, FileDiffView, type ViewLabels } from './file-views'
import { ensureFilesStyles } from './styles'

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

  return (
    <div className="dsh-files">
      {cwd === undefined ? (
        <div className="dsh-files-status">{t('files.noCwd')}</div>
      ) : mode === 'tree' ? (
        <FilesTree cwd={cwd} t={t} onOpen={props.onOpen} />
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
              <FilesPreview file={file} data={data} busy={busy} t={t} />
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
              <FilesDiffView file={file} diff={diff} busy={busy} t={t} />
            )
          )}
        />
      )}
    </div>
  )
}

/** Search results render at most this many rows; the rest is summarized. */
const MAX_SEARCH_ROWS = 200

/**
 * Working-tree file browser. The whole listing arrives in one round trip as
 * flat file paths; directories are assembled client-side, so panel search
 * can match any file in the repo — expanded or not.
 */
function FilesTree(props: {
  cwd: string
  t: (key: string) => string
  onOpen: (state: PanelNavState) => void
}) {
  const { cwd, t, onOpen } = props
  const [files, setFiles] = useState<readonly GitTreeEntry[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(undefined)
    void fetchTree(cwd).then((value) => {
      if (cancelled) return
      setBusy(false)
      if (!value.ok) {
        setError(value.message)
        return
      }
      setFiles(value.entries)
    })
    return () => { cancelled = true }
  }, [cwd])

  const toggle = useCallback((dir: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(dir)) {
        next.delete(dir)
      } else {
        next.add(dir)
      }
      return next
    })
  }, [])

  const needle = query.trim().toLowerCase()
  const tree = useMemo(() => (files === null ? [] : buildTree(files)), [files])
  const matches = useMemo(() => {
    if (files === null || needle.length === 0) return []
    return files.filter((entry) => entry.path.toLowerCase().includes(needle))
  }, [files, needle])

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
        ) : busy && files === null ? (
          <div className="dsh-files-status">{t('files.loading')}</div>
        ) : files === null || files.length === 0 ? (
          <div className="dsh-files-status">{t('files.empty')}</div>
        ) : needle.length > 0 ? (
          matches.length === 0 ? (
            <div className="dsh-files-status">{t('files.searchEmpty')}</div>
          ) : (
            <>
              {matches.slice(0, MAX_SEARCH_ROWS).map((entry) => (
                <FileRow key={entry.path} entry={entry} depth={0} onOpen={onOpen} hint />
              ))}
              {matches.length > MAX_SEARCH_ROWS ? (
                <div className="dsh-files-status dsh-files-tree-note">
                  {t('files.searchTruncated').replace('{count}', String(MAX_SEARCH_ROWS))}
                </div>
              ) : null}
            </>
          )
        ) : (
          <TreeLevel
            nodes={tree}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  )
}

/** One directory level of the assembled tree; children render when open. */
function TreeLevel(props: {
  nodes: readonly TreeNode[]
  depth: number
  expanded: ReadonlySet<string>
  onToggle: (dir: string) => void
  onOpen: (state: PanelNavState) => void
}) {
  const { nodes, depth, expanded, onToggle, onOpen } = props
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'file') {
          return (
            <FileRow
              key={node.path}
              entry={node}
              depth={depth}
              onOpen={onOpen}
            />
          )
        }
        const open = expanded.has(node.path)
        return (
          <div key={node.path}>
            <div
              className="dsh-files-tree-row"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <button
                type="button"
                className="dsh-files-tree-row-main"
                onClick={() => onToggle(node.path)}
                title={node.path}
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
            {open ? (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/** One file row: click opens a preview instance, hover reveals the diff button. */
function FileRow(props: {
  entry: GitTreeEntry
  depth: number
  onOpen: (state: PanelNavState) => void
  /** Show the parent directory after the name (search results are flat). */
  hint?: boolean
}) {
  const { entry, depth, onOpen, hint } = props
  return (
    <div className="dsh-files-tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
      <button
        type="button"
        className="dsh-files-tree-row-main"
        onClick={() => onOpen({ mode: 'preview', file: entry.path })}
        title={entry.path}
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
      <button
        type="button"
        className="dsh-files-tree-diff"
        onClick={() => onOpen({ mode: 'diff', file: entry.path })}
      >
        {diffGlyph}
      </button>
    </div>
  )
}

interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  status?: GitChangeStatus
  children: TreeNode[]
}

/** Assemble nested directories from a flat file listing, sorted dirs-first. */
function buildTree(entries: readonly GitTreeEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let siblings = root
    let prefix = ''
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? ''
      prefix = prefix === '' ? part : prefix + '/' + part
      let dir = dirs.get(prefix)
      if (dir === undefined) {
        dir = { name: part, path: prefix, kind: 'dir', children: [] }
        dirs.set(prefix, dir)
        siblings.push(dir)
      }
      siblings = dir.children
    }
    siblings.push({
      name: entry.name,
      path: entry.path,
      kind: 'file',
      status: entry.status,
      children: [],
    })
  }
  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.kind === 'dir') sortNodes(node.children)
    }
  }
  sortNodes(root)
  return root
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
    void fetchFile(cwd, file, sha).then((value) => {
      if (cancelled) return
      setBusy(false)
      if (!value.ok) {
        setError(value.message)
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

const diffGlyph = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M2.4 1.5h11.2A.9.9 0 0 1 14.5 2.4v11.2a.9.9 0 0 1-.9.9H2.4a.9.9 0 0 1-.9-.9V2.4a.9.9 0 0 1 .9-.9Z" fill="currentColor" fillOpacity=".14" />
    <path fillRule="evenodd" clipRule="evenodd" d="M5.1 4.5h5.8v1.2H5.1V4.5ZM5.1 7.4h5.8v1.2H5.1V7.4ZM5.1 10.3h3.6v1.2H5.1v-1.2Z" fill="currentColor" />
  </svg>
)

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
  }
}

function FilesPreview(props: {
  file: string
  data: GitGraphFileOk | null
  busy: boolean
  t: (key: string) => string
}) {
  const { data, busy, t } = props
  if (busy && data === null) {
    return <div className="dsh-files-status">{t('files.loading')}</div>
  }
  if (data === null || !data.exists) {
    return <div className="dsh-files-status">{t('files.missing')}</div>
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
      <FileCodeView
        content={data.content}
        lang={langHintOf(props.file)}
        labels={viewLabels(t)}
      />
    </div>
  )
}

function FilesDiffView(props: {
  file: string
  diff: GitFileDiff | null
  busy: boolean
  t: (key: string) => string
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
      <FileDiffView patch={diff.patch} labels={viewLabels(t)} />
    </div>
  )
}

function fetchTree(cwd: string): Promise<GitGraphTreeResponse> {
  const params = new URLSearchParams({ cwd })
  return fetchJson<GitGraphTreeResponse>(`${GIT_GRAPH_TREE_PATH}?${params.toString()}`)
}

function fetchFile(cwd: string, path: string, sha?: string): Promise<GitGraphFileResponse> {
  const params = new URLSearchParams({ cwd, path })
  if (sha !== undefined) params.set('sha', sha)
  return fetchJson<GitGraphFileResponse>(`${GIT_GRAPH_FILE_PATH}?${params.toString()}`)
}

function fetchDiff(cwd: string, path: string, sha?: string): Promise<GitGraphDiffResponse> {
  const params = new URLSearchParams({ cwd, path })
  if (sha !== undefined) params.set('sha', sha)
  return fetchJson<GitGraphDiffResponse>(`${GIT_GRAPH_DIFF_PATH}?${params.toString()}`)
}

async function fetchJson<T>(url: string): Promise<T> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    return await response.json() as T
  } catch (error) {
    return {
      ok: false,
      code: 'git',
      message: error instanceof Error ? error.message : String(error),
    } as T
  }
}
