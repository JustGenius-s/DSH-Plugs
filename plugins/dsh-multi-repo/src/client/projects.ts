import type { MultiRepoProject } from '../shared'
import { PROJECT_PATH } from '../shared'
import { getJson } from './http'

interface ListPayload {
  root: string
  projects: MultiRepoProject[]
}

let cache: MultiRepoProject[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getProjects(): MultiRepoProject[] {
  return cache
}

export async function refreshProjects(): Promise<MultiRepoProject[]> {
  const list = await getJson<ListPayload>(PROJECT_PATH)
  cache = list.projects
  emit()
  return cache
}
