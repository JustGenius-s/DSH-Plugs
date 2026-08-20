/** Model-facing tool that proposes a memory and waits for user confirmation. */
export const MEMORY_PROPOSE = 'memory_propose'

/** HTTP path for listing memory entries (metadata). */
export const LIST_PATH = '/dsh-memory/list'

/** HTTP path for reading or mutating one memory entry. */
export const ENTRY_PATH = '/dsh-memory/entry'

/** HTTP path for polling a pending AI propose wait. */
export const PENDING_PATH = '/dsh-memory/pending'

/** HTTP path for resolving a pending AI propose wait. */
export const PROPOSE_PATH = '/dsh-memory/propose'

/** Soft cap for characters injected into the system prompt. */
export const MAX_PROMPT_CHARS = 8_000

/** Soft cap for how many enabled memories are injected. */
export const MAX_PROMPT_ENTRIES = 40

export type MemorySource = 'manual' | 'ai'

export type MemoryProposeAction = 'accept' | 'reject'

export interface MemoryMeta {
  id: string
  title: string
  enabled: boolean
  source: MemorySource
  createdAt: number
  updatedAt: number
}

export interface MemoryEntry extends MemoryMeta {
  content: string
}

export interface MemoryPending {
  id: string
  sessionId: string
  title: string
  content: string
  waiting: boolean
}

export interface MemoryHttpOk<T> {
  ok: true
  value: T
}

export interface MemoryHttpErr {
  ok: false
  message: string
}

export type MemoryHttpResult<T> = MemoryHttpOk<T> | MemoryHttpErr

export type MemoryEntryAction =
  | { action: 'create'; title: string; content: string; enabled?: boolean }
  | { action: 'update'; id: string; title?: string; content?: string; enabled?: boolean }
  | { action: 'delete'; id: string }
  | { action: 'toggle'; id: string; enabled: boolean }

export interface MemoryProposePost {
  sessionId: string
  action: MemoryProposeAction
  title?: string
  content?: string
}

export function mintMemoryId(prefix = 'mem'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

export function summarize(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}
