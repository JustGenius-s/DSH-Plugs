export type ResolvedIngestSession =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'missing' | 'ambiguous' }

/** Prefer an explicit session; otherwise the sole live debug session. */
export function resolveIngestSessionId(
  requested: string,
  activeIds: readonly string[],
): ResolvedIngestSession {
  if (requested !== '') return { ok: true, sessionId: requested }
  if (activeIds.length === 1) {
    const only = activeIds[0]
    if (only !== undefined) return { ok: true, sessionId: only }
  }
  return { ok: false, reason: activeIds.length === 0 ? 'missing' : 'ambiguous' }
}
