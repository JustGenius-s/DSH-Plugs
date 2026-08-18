import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
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
}

/**
 * The structured file list under the commit graph: every file a commit touched,
 * or every working-tree change. Rows are clickable and open the `files` panel
 * on that file's diff.
 */
export function GitGraphDetail(props: GitGraphDetailProps) {
  const { cwd, sha, title, t, onOpenFile, display = 'flat' } = props
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
    })
    return () => { cancelled = true }
  }, [cwd, sha])

  const tree = useMemo(
    () => (files === null || display !== 'tree' ? undefined : buildTree(files)),
    [files, display],
  )
  const toggleDir = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

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
      ) : (
        <div className="dsh-git-graph-detail-list">
          {tree !== undefined ? (
            <TreeRows
              node={tree}
              depth={0}
              collapsed={collapsed}
              onToggleDir={toggleDir}
              sha={sha}
              onOpenFile={onOpenFile}
            />
          ) : (
            files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                depth={0}
                showDir
                sha={sha}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
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
  onOpenFile: (file: string, sha?: string) => void
}) {
  const { file, sha } = props
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
  onOpenFile: (file: string, sha?: string) => void
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
                onOpenFile={props.onOpenFile}
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
          onOpenFile={props.onOpenFile}
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
