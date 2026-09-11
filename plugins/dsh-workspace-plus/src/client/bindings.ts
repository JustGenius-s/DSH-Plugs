import type { BindingListPayload, WorkspaceBinding } from '../shared.ts'
import { PROJECT_PATH } from '../shared.ts'
import { getJson } from './http.ts'

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
