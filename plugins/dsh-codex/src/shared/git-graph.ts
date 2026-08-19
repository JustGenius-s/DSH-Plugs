/** Same-origin routes for the Codex commit-graph feature. */
export const GIT_GRAPH_PATH = '/dsh-codex/git-graph'
export const GIT_GRAPH_COMMIT_PATH = '/dsh-codex/git-graph/commit'
export const GIT_GRAPH_ACTION_PATH = '/dsh-codex/git-graph/action'
export const GIT_GRAPH_FILES_PATH = '/dsh-codex/git-graph/files'
export const GIT_GRAPH_TREE_PATH = '/dsh-codex/git-graph/tree'
export const GIT_GRAPH_FILE_PATH = '/dsh-codex/git-graph/file'
export const GIT_GRAPH_DIFF_PATH = '/dsh-codex/git-graph/diff'

/** Sentinel `ref` query value: show every local, remote, and tag tip. */
export const GIT_GRAPH_ALL_SCOPE = '__all__'

export const DEFAULT_GRAPH_LIMIT = 200
export const MAX_GRAPH_LIMIT = 400
export const MAX_GRAPH_SCOPE_REFS = 64

export type GitGraphRefType = 'head' | 'branch' | 'remote' | 'tag'

export interface GitGraphRef {
  name: string
  type: GitGraphRefType
  current?: boolean
}

/** A named tip the graph can be filtered to, without checking it out. */
export interface GitGraphScopeRef {
  name: string
  fullName: string
  type: GitGraphRefType
  current?: boolean
}

export type GitGraphRowKind = 'commit' | 'merge' | 'workdir'

export interface GitGraphRow {
  sha: string
  shortSha: string
  parents: string[]
  author: string
  timestamp: number
  subject: string
  refs: GitGraphRef[]
  kind: GitGraphRowKind
  /** Porcelain status, only on the synthetic workdir row. */
  detail?: string
}

export interface GitGraphOk {
  ok: true
  cwd: string
  head?: string
  branch?: string
  refs: GitGraphScopeRef[]
  selected: string[]
  rows: GitGraphRow[]
  hasMore: boolean
}

export interface GitGraphErr {
  ok: false
  code: 'no-cwd' | 'not-git' | 'git' | 'bad-request'
  message: string
}

export type GitGraphResponse = GitGraphOk | GitGraphErr

export interface GitGraphCommitOk {
  ok: true
  sha: string
  body: string
}

export type GitGraphCommitResponse = GitGraphCommitOk | GitGraphErr

export type GitGraphActionName =
  | 'checkout'
  | 'create-branch'
  | 'cherry-pick'
  | 'revert'
  | 'reset'
  | 'commit'
  | 'commit-push'
  | 'stage'
  | 'unstage'
  | 'stage-all'
  | 'unstage-all'
  | 'discard-all'
  | 'pull'
  | 'push'
  | 'fetch'
  | 'stash'
  | 'stash-pop'

export type GitResetMode = 'soft' | 'mixed' | 'hard'

export interface GitGraphActionRequest {
  cwd: string
  /** Target commit; only the history actions (checkout … reset) need it. */
  sha?: string
  action: GitGraphActionName
  branch?: string
  mode?: GitResetMode
  /** Commit message, required by `commit` / `commit-push`. */
  message?: string
  /** Repo-relative file path, required by `stage` / `unstage`. */
  path?: string
}

export interface GitGraphActionOk {
  ok: true
  action: GitGraphActionName
  sha?: string
  message?: string
}

export type GitGraphActionResponse = GitGraphActionOk | GitGraphErr

/** Status of one changed file in a commit or the working tree. */
export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export interface GitChangeFile {
  /** File path relative to the repository root. */
  path: string
  status: GitChangeStatus
  /**
   * Working-tree mode only: true when this entry is the index (staged) side
   * of the change, false/absent for the worktree side. A path modified in
   * both appears twice, once per side. Never set for commit file lists.
   */
  staged?: boolean
  /** Old path for a rename/copy; undefined otherwise. */
  oldPath?: string
  /** Insertions, when git reported them. */
  added?: number
  /** Deletions, when git reported them. */
  removed?: number
}

export interface GitGraphFilesOk {
  ok: true
  cwd: string
  /** Files changed by a commit (sha set) or in the working tree (sha absent). */
  files: GitChangeFile[]
}

export type GitGraphFilesResponse = GitGraphFilesOk | GitGraphErr

/** One directory entry in the file-tree browser. */
export interface GitTreeEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  /** Working-tree status for files (tree browser only, workdir mode). */
  status?: GitChangeStatus
}

export interface GitGraphTreeOk {
  ok: true
  cwd: string
  /** The directory shown; a trailing empty path means the repository root. */
  path: string
  entries: GitTreeEntry[]
}

export type GitGraphTreeResponse = GitGraphTreeOk | GitGraphErr

export interface GitGraphFileOk {
  ok: true
  cwd: string
  path: string
  /**
   * File contents. With `encoding: 'utf8'` this is decoded text; with
   * `'base64'` it is the raw bytes encoded for binary previews (images).
   */
  content: string
  /** How `content` is encoded. */
  encoding: 'utf8' | 'base64'
  /** MIME type of the file, set when it is served as a base64 binary. */
  mime?: string
  /** True for binary files with no preview form (content stays empty). */
  binary?: boolean
  /** True when the path exists; false when it does not (deleted file, missing path). */
  exists: boolean
}

export type GitGraphFileResponse = GitGraphFileOk | GitGraphErr

/**
 * One file's change as a raw unified patch (the `git diff`/`git show` output
 * restricted to `path`, or a synthesized new-file patch for an untracked
 * file). The client renders it line by line; keeping the unified form
 * preserves hunk boundaries and line numbers that a split old/new text loses.
 */
export interface GitFileDiff {
  path: string
  patch: string
}

export interface GitGraphDiffOk {
  ok: true
  cwd: string
  path: string
  /** The commit the diff is against, when a sha was given. */
  sha?: string
  diff: GitFileDiff | null
}

export type GitGraphDiffResponse = GitGraphDiffOk | GitGraphErr
