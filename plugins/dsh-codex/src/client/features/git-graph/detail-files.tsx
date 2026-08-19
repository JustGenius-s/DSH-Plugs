import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPlusOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  GIT_GRAPH_FILES_PATH,
  type GitChangeFile,
  type GitGraphFilesResponse,
} from '../../../shared/git-graph'
import { fileIconSvg, folderIconSvg } from '../files/file-icons'

const STATUS_LABEL: Record<GitChangeFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: 'C',
}

export interface GitGraphDetailProps {
  cwd: string
  /** Commit the files belong to; undefined for the working tree. */
  sha?: string
  /** Short label shown in the detail header; omitted = no header row. */
  title?: string
  t: (key: string) => string
  onOpenFile: (file: string, sha?: string) => void
  /** List layout: flat rows (default) or a collapsible directory tree. */
  display?: 'flat' | 'tree'
  /**
   * Working-tree mode: stage/unstage one file from its row hover action.
   * Omitting it hides the hover buttons (read-only lists).
   */
  onStageChange?: (file: GitChangeFile, stage: boolean) => void
  /** Section-header hover actions: stage/unstage every file in the group. */
  onStageAll?: () => void
  onUnstageAll?: () => void
  /**
   * Working-tree mode: discard one file's worktree changes from its row
   * hover action (untracked files are deleted). Omitting it hides the button.
   */
  onDiscard?: (file: GitChangeFile) => void
  /** Reports the fetched list so the parent can react to group counts. */
  onFilesChange?: (files: readonly GitChangeFile[]) => void
}

/**
 * The structured file list under the commit graph: every file a commit touched,
 * or every working-tree change. Rows are clickable and open the `files` panel
 * on that file's diff. Working-tree lists arrive flagged per index/worktree
 * side and render as two VSCode-style groups: staged on top, changes below.
 */
export function GitGraphDetail(props: GitGraphDetailProps) {
  const { cwd, sha, title, t, onOpenFile, display = 'flat', onStageChange, onStageAll, onUnstageAll, onDiscard, onFilesChange } = props
  const [files, setFiles] = useState<readonly GitChangeFile[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setError(undefined)
    setCollapsed(new Set())
    void fetchFiles(cwd, sha).then((value) => {
      if (cancelled) return
      if (!value.ok) {
        setError(value.message)
        return
      }
      setFiles(value.files)
      onFilesChange?.(value.files)
    })
    return () => { cancelled = true }
  }, [cwd, sha, onFilesChange])

  const toggleDir = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Commit lists never carry the staged flag; workdir lists split by it.
  const grouped = sha === undefined
  const stagedFiles = useMemo(
    () => (grouped ? (files ?? []).filter((file) => file.staged === true) : []),
    [files, grouped],
  )
  const unstagedFiles = useMemo(
    () => (grouped ? (files ?? []).filter((file) => file.staged !== true) : []),
    [files, grouped],
  )

  const listProps = { display, collapsed, onToggleDir: toggleDir, sha, t, onOpenFile, onStageChange, onDiscard }

  return (
    <div className="dsh-git-graph-detail">
      {title === undefined ? null : (
        <div className="dsh-git-graph-detail-title">{title}</div>
      )}
      {error !== undefined ? (
        <div className="dsh-git-graph-detail-status is-error">{error}</div>
      ) : files === null ? (
        <div className="dsh-git-graph-detail-status">{t('gitGraph.loading')}</div>
      ) : files.length === 0 ? (
        <div className="dsh-git-graph-detail-status">{t('gitGraph.noFiles')}</div>
      ) : grouped ? (
        <>
          <ChangeSection
            label={t('gitGraph.staged')}
            files={stagedFiles}
            stageAction="unstage"
            onStageAll={onUnstageAll}
            {...listProps}
          />
          <ChangeSection
            label={t('gitGraph.changes')}
            files={unstagedFiles}
            stageAction="stage"
            onStageAll={onStageAll}
            {...listProps}
          />
        </>
      ) : (
        <FileList files={files} {...listProps} />
      )}
    </div>
  )
}

/** One VSCode-style group header plus its file list; empty groups hide. */
function ChangeSection(props: {
  label: string
  files: readonly GitChangeFile[]
  stageAction: 'stage' | 'unstage'
  display: 'flat' | 'tree'
  collapsed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  sha?: string
  t: (key: string) => string
  onOpenFile: (file: string, sha?: string) => void
  onStageChange?: (file: GitChangeFile, stage: boolean) => void
  onDiscard?: (file: GitChangeFile) => void
  /** Header hover action matching stageAction's direction (all files). */
  onStageAll?: () => void
}) {
  const { label, files, stageAction, onStageAll, t, ...listProps } = props
  if (files.length === 0) return null
  const allLabel = stageAction === 'stage' ? 'gitGraph.stageAll' : 'gitGraph.unstageAll'
  return (
    <div className="dsh-git-graph-detail-group">
      <div className="dsh-git-graph-detail-section">
        <span className="dsh-git-graph-detail-section-label">{label}</span>
        <span className="dsh-git-graph-detail-section-count">{files.length}</span>
        {onStageAll === undefined ? null : (
          <button
            type="button"
            className="dsh-git-graph-detail-section-action"
            aria-label={t(allLabel)}
            title={t(allLabel)}
            onClick={onStageAll}
          >
            {stageAction === 'stage' ? <IconPlusOutline16 size={16} /> : <IconMinus size={16} />}
          </button>
        )}
      </div>
      <FileList files={files} stageAction={stageAction} t={t} {...listProps} />
    </div>
  )
}

/** Flat rows or a directory tree for one list of change files. */
function FileList(props: {
  files: readonly GitChangeFile[]
  display: 'flat' | 'tree'
  collapsed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  sha?: string
  t: (key: string) => string
  onOpenFile: (file: string, sha?: string) => void
  stageAction?: 'stage' | 'unstage'
  onStageChange?: (file: GitChangeFile, stage: boolean) => void
  onDiscard?: (file: GitChangeFile) => void
}) {
  const { files, display, collapsed, onToggleDir, sha, t, onOpenFile, stageAction, onStageChange, onDiscard } = props
  const tree = useMemo(
    () => (display !== 'tree' ? undefined : buildTree(files)),
    [files, display],
  )
  const rowProps = { sha, t, onOpenFile, stageAction, onStageChange, onDiscard }
  return (
    <div className="dsh-git-graph-detail-list">
      {tree !== undefined ? (
        <TreeRows
          node={tree}
          depth={0}
          collapsed={collapsed}
          onToggleDir={onToggleDir}
          {...rowProps}
        />
      ) : (
        files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            depth={0}
            showDir
            {...rowProps}
          />
        ))
      )}
    </div>
  )
}

/** One change row: file icon, name, +/- counts and the status badge. */
function FileRow(props: {
  file: GitChangeFile
  depth: number
  /** Flat mode shows the directory after the name; tree mode implies it. */
  showDir: boolean
  sha?: string
  t: (key: string) => string
  onOpenFile: (file: string, sha?: string) => void
  /** Hover action this row offers; undefined = read-only row. */
  stageAction?: 'stage' | 'unstage'
  onStageChange?: (file: GitChangeFile, stage: boolean) => void
  /** Discard hover action, only meaningful on the unstaged (Changes) side. */
  onDiscard?: (file: GitChangeFile) => void
}) {
  const { file, sha, t, stageAction, onStageChange, onDiscard } = props
  // Tree rows skip the caret a directory row carries, so file icons line up
  // with directory icons at the same level (caret 12px + row gap 6px).
  const indent = 4 + props.depth * 14 + (props.showDir ? 0 : 18)
  return (
    <button
      type="button"
      className="dsh-git-graph-detail-row"
      style={indent === 4 ? undefined : { paddingLeft: indent }}
      onClick={() => props.onOpenFile(file.path, sha)}
      title={file.path}
    >
      <span
        className="dsh-git-graph-detail-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: fileIconSvg(fileName(file.path)) }}
      />
      <span className="dsh-git-graph-detail-name">
        {fileName(file.path)}
        {!props.showDir || fileDir(file.path) === '' ? null : (
          <span className="dsh-git-graph-detail-dir">{fileDir(file.path)}</span>
        )}
      </span>
      {stageAction === 'stage' && onDiscard !== undefined ? (
        <span
          role="button"
          tabIndex={-1}
          className="dsh-git-graph-detail-action"
          aria-label={t('gitGraph.discard')}
          title={t('gitGraph.discard')}
          onClick={(event) => {
            event.stopPropagation()
            onDiscard(file)
          }}
        >
          <IconUndo size={14} />
        </span>
      ) : null}
      {stageAction === undefined || onStageChange === undefined ? null : (
        <span
          role="button"
          tabIndex={-1}
          className="dsh-git-graph-detail-action"
          aria-label={t(stageAction === 'stage' ? 'gitGraph.stage' : 'gitGraph.unstage')}
          title={t(stageAction === 'stage' ? 'gitGraph.stage' : 'gitGraph.unstage')}
          onClick={(event) => {
            event.stopPropagation()
            onStageChange(file, stageAction === 'stage')
          }}
        >
          {stageAction === 'stage' ? <IconPlusOutline16 size={14} /> : <IconMinus size={14} />}
        </span>
      )}
      {file.added !== undefined || file.removed !== undefined ? (
        <span className="dsh-git-graph-detail-count">
          <span className="is-add">+{String(file.added ?? 0)}</span>
          <span className="is-del">−{String(file.removed ?? 0)}</span>
        </span>
      ) : null}
      <span className={'dsh-git-graph-detail-status is-' + file.status}>
        {STATUS_LABEL[file.status]}
      </span>
    </button>
  )
}

/** Lucide `undo-2`, inlined (the primitives sheet has no discard glyph). */
function IconUndo(props: { size?: number }) {
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
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  )
}

/** Lucide `minus`, inlined (the primitives sheet has no minus glyph). */
function IconMinus(props: { size?: number }) {
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
      <path d="M5 12h14" />
    </svg>
  )
}

interface DirNode {
  name: string
  path: string
  dirs: Map<string, DirNode>
  files: GitChangeFile[]
}

/** Group flat repo-relative paths into a directory tree. */
function buildTree(files: readonly GitChangeFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index] ?? ''
      const path = node.path === '' ? name : node.path + '/' + name
      let child = node.dirs.get(name)
      if (child === undefined) {
        child = { name, path, dirs: new Map(), files: [] }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return root
}

/** Recursive tree body: directories (collapsible) first, then files. */
function TreeRows(props: {
  node: DirNode
  depth: number
  collapsed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  sha?: string
  t: (key: string) => string
  onOpenFile: (file: string, sha?: string) => void
  stageAction?: 'stage' | 'unstage'
  onStageChange?: (file: GitChangeFile, stage: boolean) => void
  onDiscard?: (file: GitChangeFile) => void
}) {
  const { node, depth, collapsed } = props
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
  return (
    <>
      {dirs.map((dir) => {
        const open = !collapsed.has(dir.path)
        return (
          <Fragment key={dir.path}>
            <button
              type="button"
              className="dsh-git-graph-detail-row is-dir"
              style={depth === 0 ? undefined : { paddingLeft: 4 + depth * 14 }}
              onClick={() => props.onToggleDir(dir.path)}
              title={dir.path}
            >
              <span className="dsh-git-graph-detail-caret" aria-hidden="true">
                {open
                  ? <IconChevronDownOutline14 size={12} />
                  : <IconChevronRightOutline14 size={12} />}
              </span>
              <span
                className="dsh-git-graph-detail-icon"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: folderIconSvg(dir.name, open) }}
              />
              <span className="dsh-git-graph-detail-name">{dir.name}</span>
            </button>
            {open ? (
              <TreeRows
                node={dir}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleDir={props.onToggleDir}
                sha={props.sha}
                t={props.t}
                onOpenFile={props.onOpenFile}
                stageAction={props.stageAction}
                onStageChange={props.onStageChange}
                onDiscard={props.onDiscard}
              />
            ) : null}
          </Fragment>
        )
      })}
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={depth}
          showDir={false}
          sha={props.sha}
          t={props.t}
          onOpenFile={props.onOpenFile}
          stageAction={props.stageAction}
          onStageChange={props.onStageChange}
          onDiscard={props.onDiscard}
        />
      ))}
    </>
  )
}

function fileName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

function fileDir(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function fetchFiles(cwd: string, sha?: string): Promise<GitGraphFilesResponse> {
  const params = new URLSearchParams({ cwd })
  if (sha !== undefined) params.set('sha', sha)
  try {
    return fetch(`${GIT_GRAPH_FILES_PATH}?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then((response) => response.json() as Promise<GitGraphFilesResponse>)
  } catch (error) {
    return Promise.resolve({
      ok: false,
      code: 'git',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
