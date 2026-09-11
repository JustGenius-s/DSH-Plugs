import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parsePinAction, updatePin, type PinAction, type PinSnapshot } from './pin-state.ts'
import { storeRoot } from './store.ts'

function storePath(): string {
  return join(storeRoot(), 'pins.json')
}

/** Only a missing file means "not migrated"; unreadable/corrupt data must survive. */
export function readStoredPins(): PinSnapshot {
  let raw: string
  try {
    raw = readFileSync(storePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { initialized: false, pins: [] }
    throw error
  }
  const value = JSON.parse(raw) as { version?: unknown; pins?: unknown } | null
  const action = parsePinAction({ action: 'import', pins: value?.pins })
  if (value?.version !== 1 || action?.action !== 'import') throw new Error('invalid pin store')
  return { initialized: true, pins: action.pins }
}

/** Apply operations to disk state, not a possibly stale whole-window snapshot. */
export function changeStoredPins(action: PinAction): PinSnapshot {
  const previous = readStoredPins()
  if (action.action === 'import' && (previous.initialized || action.pins.length === 0)) return previous
  const pins = action.action === 'import'
    ? action.pins
    : updatePin(previous.pins, action.pin, action.pinned)
  const file = storePath()
  const tmp = `${file}.${randomUUID()}.tmp`
  mkdirSync(storeRoot(), { recursive: true })
  try {
    writeFileSync(tmp, `${JSON.stringify({ version: 1, pins }, null, 2)}\n`, { encoding: 'utf8', flush: true })
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  return { initialized: true, pins }
}
