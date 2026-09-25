import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  readLegacySessionPins,
  readWorkspacePins,
  updateWorkspacePins,
  type PinAction,
  type PinSnapshot,
} from './pin-state.ts'
import { storeRoot } from './store.ts'

function storePath(): string {
  return join(storeRoot(), 'pins.json')
}

/**
 * Read the store, accepting the current shape and the two legacy ones.
 *
 * Only a missing file means "not initialized"; unreadable, corrupt, or
 * future-versioned data must survive rather than be silently replaced by an
 * empty store — an unknown version could carry pins this build cannot see, and
 * writing over it would destroy them. Legacy session pins are reported so the
 * client can migrate them into DSH exactly once.
 */
export function readStoredPins(): PinSnapshot {
  let raw: string
  try {
    raw = readFileSync(storePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { initialized: false, legacySessionPins: [], workspacePins: [] }
    }
    throw error
  }
  const value = JSON.parse(raw) as Record<string, unknown> | null
  if (value === null || typeof value !== 'object') throw new Error('invalid pin store')
  // v1 stored `pins`; v3 stores `workspacePins` plus unmigrated session ids.
  // A store without a version predates the field and is read as v1.
  if (value.version !== undefined && value.version !== 1 && value.version !== 3) {
    throw new Error('unsupported pin store version')
  }
  return {
    initialized: true,
    legacySessionPins: readLegacySessionPins(value),
    workspacePins: readWorkspacePins(value),
  }
}

function writePins(workspacePins: readonly string[], legacySessionPins: readonly string[]): void {
  const file = storePath()
  const tmp = `${file}.${randomUUID()}.tmp`
  mkdirSync(storeRoot(), { recursive: true })
  const body: Record<string, unknown> = { version: 3, workspacePins: [...workspacePins] }
  // Keep rows the client has not yet migrated into DSH: dropping them here
  // would lose the user's pins if the official write fails afterwards.
  if (legacySessionPins.length > 0) body.legacySessionPins = [...legacySessionPins]
  try {
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', flush: true })
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/**
 * Apply one action to disk state, never to a possibly stale window snapshot.
 *
 * `import` is the first-connect adoption of legacy browser pins: it is ignored
 * once the store exists, and an empty one does NOT initialize the store, so a
 * browser that has nothing cached cannot permanently block a later real import.
 * Any other action does write, including an unpin — an explicit empty list is
 * authoritative and must be able to record itself.
 */
export function changeStoredPins(action: PinAction): PinSnapshot {
  const previous = readStoredPins()
  let workspacePins = previous.workspacePins
  let legacySessionPins = previous.legacySessionPins

  switch (action.action) {
    case 'import': {
      if (previous.initialized || action.workspacePins.length === 0) return previous
      workspacePins = action.workspacePins
      break
    }
    case 'set':
      workspacePins = updateWorkspacePins(workspacePins, action.workspaceId, action.pinned)
      break
    case 'clearLegacySessions':
      legacySessionPins = []
      break
  }

  writePins(workspacePins, legacySessionPins)
  return { initialized: true, legacySessionPins, workspacePins }
}
