/** Same-origin routes for the Codex commit-graph feature. */
export const GIT_GRAPH_PATH = '/dsh-codex/git-graph'
export const GIT_GRAPH_COMMIT_PATH = '/dsh-codex/git-graph/commit'
export const GIT_GRAPH_ACTION_PATH = '/dsh-codex/git-graph/action'

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

export type GitResetMode = 'soft' | 'mixed' | 'hard'

export interface GitGraphActionRequest {
  cwd: string
  sha: string
  action: GitGraphActionName
  branch?: string
  mode?: GitResetMode
}

export interface GitGraphActionOk {
  ok: true
  action: GitGraphActionName
  sha: string
  message?: string
}

export type GitGraphActionResponse = GitGraphActionOk | GitGraphErr
