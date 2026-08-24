import { getResult, postResult } from '@just-genius/dsh-plugin-runtime/client'
import {
  ENTRY_PATH,
  LIST_PATH,
  type MemoryEntry,
  type MemoryEntryAction,
} from '../shared.ts'

interface ListPayload {
  root: string
  entries: MemoryEntry[]
}

export interface MemorySnapshot {
  root: string
  entries: readonly MemoryEntry[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  busy: boolean
}

export class MemoryController {
  private snapshot: MemorySnapshot = {
    root: '',
    entries: [],
    status: 'loading',
    error: null,
    busy: false,
  }
  private readonly listeners = new Set<() => void>()
  private disposed = false

  getSnapshot = (): MemorySnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async reload(): Promise<void> {
    this.publish({ status: 'loading', error: null })
    try {
      const list = await getResult<ListPayload>(LIST_PATH)
      this.publish({ root: list.root, entries: list.entries, status: 'ready' })
    } catch (error) {
      this.publish({ status: 'error', error: message(error) })
    }
  }

  save(action: MemoryEntryAction): Promise<MemoryEntry> {
    return this.mutate(() => postResult<MemoryEntry>(ENTRY_PATH, action))
  }

  toggle(id: string, enabled: boolean): Promise<MemoryEntry> {
    return this.mutate(() => postResult<MemoryEntry>(ENTRY_PATH, { action: 'toggle', id, enabled }))
  }

  remove(id: string): Promise<{ deleted: true; id: string }> {
    return this.mutate(() => postResult(ENTRY_PATH, { action: 'delete', id }))
  }

  clearError(): void {
    this.publish({ error: null })
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.publish({ busy: true, error: null })
    try {
      const value = await operation()
      await this.reload()
      return value
    } catch (error) {
      this.publish({ error: message(error) })
      throw error
    } finally {
      this.publish({ busy: false })
    }
  }

  private publish(patch: Partial<MemorySnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
