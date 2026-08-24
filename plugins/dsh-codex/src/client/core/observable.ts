/** A stable snapshot source consumable by React's useSyncExternalStore. */
export interface ReadableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * Small lifecycle-aware observable used by dsh-codex application stores.
 *
 * It deliberately owns no mutation semantics: feature controllers decide how
 * a snapshot changes and publish complete immutable snapshots here. This keeps
 * listener delivery and teardown consistent without turning every feature
 * into an instance of a generic state framework.
 */
export interface SnapshotChannel<T> extends ReadableSnapshot<T> {
  publish(snapshot: T): void
  dispose(): void
}

export function createSnapshotChannel<T>(initial: T): SnapshotChannel<T> {
  let snapshot = initial
  let disposed = false
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next) {
      snapshot = next
      if (disposed) return
      for (const listener of [...listeners]) listener()
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
    },
  }
}
