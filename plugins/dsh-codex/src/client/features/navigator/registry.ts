import { createSnapshotChannel } from '../../core/observable'

export interface NavigatorRegistrySnapshot {
  readonly ownerBySession: ReadonlyMap<string, symbol>
}

export interface NavigatorRegistry {
  register(sessionId: string, token: symbol, seq: number): () => void
  isOwner(snapshot: NavigatorRegistrySnapshot, sessionId: string, token: symbol): boolean
  getSnapshot(): NavigatorRegistrySnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

interface Candidate {
  readonly token: symbol
  readonly seq: number
}

/**
 * Elects one mounted turn-tail as the session navigator host. Registration is
 * effect-owned and replacement is automatic when the current host unmounts.
 */
export function createNavigatorRegistry(): NavigatorRegistry {
  const candidates = new Map<string, Candidate[]>()
  const channel = createSnapshotChannel<NavigatorRegistrySnapshot>({
    ownerBySession: new Map(),
  })

  const publish = (): void => {
    const ownerBySession = new Map<string, symbol>()
    for (const [sessionId, values] of candidates) {
      const owner = values.reduce<Candidate | undefined>((current, candidate) => {
        if (current === undefined || candidate.seq < current.seq) return candidate
        return current
      }, undefined)
      if (owner !== undefined) ownerBySession.set(sessionId, owner.token)
    }
    channel.publish({ ownerBySession })
  }

  return {
    register(sessionId, token, seq) {
      const values = candidates.get(sessionId) ?? []
      values.push({ token, seq })
      candidates.set(sessionId, values)
      publish()
      return () => {
        const current = candidates.get(sessionId)
        if (current === undefined) return
        const next = current.filter(candidate => candidate.token !== token)
        if (next.length === 0) candidates.delete(sessionId)
        else candidates.set(sessionId, next)
        publish()
      }
    },
    isOwner(snapshot, sessionId, token) {
      return snapshot.ownerBySession.get(sessionId) === token
    },
    getSnapshot: channel.getSnapshot,
    subscribe: channel.subscribe,
    dispose() {
      candidates.clear()
      channel.dispose()
    },
  }
}
