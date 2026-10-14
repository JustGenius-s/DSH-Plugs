/**
 * The plugin's own pin store: WORKSPACE pins only.
 *
 * DSH has no workspace pin, so this plugin keeps its own. Session pins are DSH's
 * (`UiWorkspace.pinSession`, persisted in the Workspace registry), so they are
 * NOT duplicated here — one source of truth keeps the official row button and
 * the plugin's pinned area in agreement by construction.
 *
 * The store file still carries the v1 shape written by earlier versions, so the
 * reader accepts both and the migration in `client/pin-migration.ts` moves the
 * legacy session pins into the official registry once.
 */

export interface PinSnapshot {
  initialized: boolean
  /** Legacy session pins still on disk, pending migration into DSH. */
  legacySessionPins: string[]
  workspacePins: string[]
}

export type PinAction =
  | { action: 'import'; workspacePins: string[] }
  | { action: 'set'; workspaceId: string; pinned: boolean }
  | { action: 'clearLegacySessions' }

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function uniqueText(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const value of values) {
    if (!isText(value) || seen.has(value)) continue
    seen.add(value)
    kept.push(value)
  }
  return kept
}

/** Workspace pin ids from either the v1 pin objects or the v3 plain id list. */
export function readWorkspacePins(value: Record<string, unknown>): string[] {
  if (Array.isArray(value.workspacePins)) return uniqueText(value.workspacePins)
  if (!Array.isArray(value.pins)) return uniqueText(Array.isArray(value.pinnedWorkspaces) ? value.pinnedWorkspaces : [])
  const ids: unknown[] = []
  for (const item of value.pins) {
    if (item === null || typeof item !== 'object') continue
    const pin = item as Record<string, unknown>
    if (pin.kind === 'workspace') ids.push(pin.id)
  }
  return uniqueText(ids)
}

/** Session pin ids still stored by a previous version, awaiting migration. */
export function readLegacySessionPins(value: Record<string, unknown>): string[] {
  // v3 keeps them under their own key; v1 had them mixed into `pins`.
  if (Array.isArray(value.legacySessionPins)) return uniqueText(value.legacySessionPins)
  if (!Array.isArray(value.pins)) return []
  const ids: unknown[] = []
  for (const item of value.pins) {
    if (item === null || typeof item !== 'object') continue
    const pin = item as Record<string, unknown>
    if (pin.kind === 'session') ids.push(pin.id)
  }
  return uniqueText(ids)
}

/** Newest first: a pin write fronts its id, matching the panel's reading order. */
export function updateWorkspacePins(
  pins: readonly string[],
  workspaceId: string,
  pinned: boolean,
): string[] {
  const rest = pins.filter((id) => id !== workspaceId)
  return pinned ? [workspaceId, ...rest] : rest
}

export function isWorkspacePinned(pins: readonly string[], workspaceId: string): boolean {
  return pins.includes(workspaceId)
}

/**
 * Reject malformed writes instead of reading them as "clear everything".
 *
 * `clearLegacySessions` is the migration's acknowledgement: only after every
 * legacy session pin is durable in the official registry does the client ask
 * for it, so a failed migration retries on the next load.
 */
export function parsePinAction(value: unknown): PinAction | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const body = value as Record<string, unknown>
  if (body.action === 'clearLegacySessions') return { action: 'clearLegacySessions' }
  if (body.action === 'set' && typeof body.pinned === 'boolean') {
    if (!isText(body.workspaceId)) return undefined
    return { action: 'set', workspaceId: body.workspaceId, pinned: body.pinned }
  }
  if (body.action === 'import' && Array.isArray(body.workspacePins)) {
    return { action: 'import', workspacePins: uniqueText(body.workspacePins) }
  }
  return undefined
}
