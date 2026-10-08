import type { BindingListPayload, WorkspaceBinding } from '../shared.ts'
import { PROJECT_PATH } from '../shared.ts'
import { getJson, postJson } from './http.ts'

let cache: WorkspaceBinding[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeBindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getBindings(): WorkspaceBinding[] {
  return cache
}

export async function refreshBindings(): Promise<WorkspaceBinding[]> {
  const list = await getJson<BindingListPayload>(PROJECT_PATH)
  cache = list.bindings
  emit()
  return cache
}

/**
 * Drop bindings whose workspace no longer exists.
 *
 * Deleting a workspace through the official row menu removes the registration
 * but cannot touch this plugin's store, so the stale binding has to be cleaned
 * up from the client side — otherwise re-adding the same directory silently
 * resurrects the previous extra folders.
 *
 * The live paths come from the official snapshot, and an empty list is never
 * sent: while the workspace list is still loading, "no workspaces" would be a
 * fact about the connection, not about the user's data.
 */
export async function pruneStaleBindings(livePaths: readonly string[]): Promise<number> {
  if (livePaths.length === 0) return 0
  const result = await postJson<{ removed: string[] }>(PROJECT_PATH, {
    action: 'prune',
    livePaths: [...livePaths],
  })
  if (result.removed.length > 0) await refreshBindings()
  return result.removed.length
}
