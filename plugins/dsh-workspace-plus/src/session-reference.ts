import type { SessionHeader } from '@just-genius/dsh-plugin-runtime/host'

/**
 * Select one materialized session header before asking the persistence backend
 * for its physical location. A cwd match disambiguates migrated duplicate ids;
 * without one, only a unique id is accepted.
 */
export function selectSessionHeader(
  headers: readonly SessionHeader[],
  sessionId: string,
  cwd?: string,
): SessionHeader | undefined {
  const matches = headers.filter((header) => String(header.id) === sessionId)
  if (cwd !== undefined) {
    const exact = matches.find((header) => header.cwd === cwd)
    if (exact !== undefined) return exact
  }
  return matches.length === 1 ? matches[0] : undefined
}
