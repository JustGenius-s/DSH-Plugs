import {
  GIT_GRAPH_DIFF_PATH,
  GIT_GRAPH_FILE_PATH,
  GIT_GRAPH_TREE_PATH,
  type GitGraphDiffResponse,
  type GitGraphFileResponse,
  type GitGraphTreeResponse,
} from '../../../shared/git-graph'
import { requestJson } from '../../infrastructure/http'

export function fetchTree(cwd: string, path = '', showIgnored = true): Promise<GitGraphTreeResponse> {
  const params = new URLSearchParams({ cwd })
  if (path.length > 0) params.set('path', path)
  if (!showIgnored) params.set('ignored', '0')
  return safeRequest<GitGraphTreeResponse>(`${GIT_GRAPH_TREE_PATH}?${params.toString()}`)
}

export function fetchTreeSearch(cwd: string, query: string, showIgnored = true): Promise<GitGraphTreeResponse> {
  const params = new URLSearchParams({ cwd, q: query })
  if (!showIgnored) params.set('ignored', '0')
  return safeRequest<GitGraphTreeResponse>(`${GIT_GRAPH_TREE_PATH}?${params.toString()}`)
}

export function fetchFile(cwd: string, path: string, sha?: string): Promise<GitGraphFileResponse> {
  const params = new URLSearchParams({ cwd, path })
  if (sha !== undefined) params.set('sha', sha)
  return safeRequest<GitGraphFileResponse>(`${GIT_GRAPH_FILE_PATH}?${params.toString()}`)
}

export function fetchDiff(cwd: string, path: string, sha?: string): Promise<GitGraphDiffResponse> {
  const params = new URLSearchParams({ cwd, path })
  if (sha !== undefined) params.set('sha', sha)
  return safeRequest<GitGraphDiffResponse>(`${GIT_GRAPH_DIFF_PATH}?${params.toString()}`)
}

async function safeRequest<T>(url: string): Promise<T> {
  try {
    return await requestJson<T>(url)
  } catch (error) {
    return {
      ok: false,
      code: 'git',
      message: error instanceof Error ? error.message : String(error),
    } as T
  }
}
