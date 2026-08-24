/**
 * Shared repo-change SSE per workspace cwd.
 *
 * Files tree / Git changes / Git graph each used to open their own
 * `EventSource` on `/dsh-codex/git-graph/watch`. Inactive side-panel panes
 * stay mounted, so three-plus tabs easily exhaust the browser's ~6
 * HTTP/1.1 connections to this origin (chat + other streams already use
 * some). New file/diff fetches then hang forever, and sending a message
 * stalls for the same reason.
 *
 * Callers must subscribe only while their pane is visible; hidden retained
 * panes unsubscribe so multi-session workspaces still share one stream at
 * a time. Within a cwd, listeners are ref-counted onto one EventSource.
 */
import { GIT_GRAPH_WATCH_PATH } from '../../shared/git-graph'

type RepoWatchListener = () => void

interface RepoWatchBus {
  source: EventSource
  listeners: Set<RepoWatchListener>
  onChange: () => void
}

const buses = new Map<string, RepoWatchBus>()

/**
 * Subscribe to worktree / index / refs changes for `cwd`.
 * Returns an unsubscribe that closes the shared stream when the last
 * listener leaves.
 */
export function subscribeRepoWatch(
  cwd: string,
  listener: RepoWatchListener,
): () => void {
  if (cwd.length === 0 || typeof EventSource === 'undefined') {
    return () => {}
  }

  let bus = buses.get(cwd)
  if (bus === undefined) {
    const listeners = new Set<RepoWatchListener>()
    const onChange = (): void => {
      for (const next of listeners) next()
    }
    const source = new EventSource(
      `${GIT_GRAPH_WATCH_PATH}?cwd=${encodeURIComponent(cwd)}`,
    )
    source.addEventListener('change', onChange)
    bus = { source, listeners, onChange }
    buses.set(cwd, bus)
  }
  bus.listeners.add(listener)

  return () => {
    const current = buses.get(cwd)
    if (current === undefined) return
    current.listeners.delete(listener)
    if (current.listeners.size > 0) return
    current.source.removeEventListener('change', current.onChange)
    current.source.close()
    buses.delete(cwd)
  }
}
