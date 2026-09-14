import { parseSessionPins } from './session-pins.ts'

export type Pin =
  | { kind: 'workspace'; id: string }
  | { kind: 'session'; id: string; workspaceId: string }

export type PinTarget = Pick<Pin, 'kind' | 'id'>

export interface PinSnapshot {
  initialized: boolean
  pins: Pin[]
}

export type PinAction =
  | { action: 'import'; pins: Pin[] }
  | { action: 'set'; pin: Pin; pinned: boolean }

export function pinKey(pin: PinTarget): string {
  return `${pin.kind}:${pin.id}`
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parsePin(value: unknown): Pin | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const pin = value as Record<string, unknown>
  if (!isText(pin.id)) return undefined
  if (pin.kind === 'workspace') return { kind: 'workspace', id: pin.id }
  if (pin.kind === 'session' && typeof pin.workspaceId === 'string') {
    return { kind: 'session', id: pin.id, workspaceId: pin.workspaceId }
  }
  return undefined
}

function uniquePins(pins: readonly Pin[]): Pin[] {
  const seen = new Set<string>()
  return pins.filter((pin) => {
    const key = pinKey(pin)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Current pins are newest-first. Old lists recorded oldest-first per kind. */
export function readPins(value: Record<string, unknown>): Pin[] {
  if (Array.isArray(value.pins)) {
    return uniquePins(value.pins.flatMap((item): Pin[] => {
      const pin = parsePin(item)
      return pin === undefined ? [] : [pin]
    }))
  }
  const workspaces: Pin[] = (Array.isArray(value.pinnedWorkspaces) ? value.pinnedWorkspaces : [])
    .filter(isText)
    .reverse()
    .map((id) => ({ kind: 'workspace', id }))
  const sessions: Pin[] = parseSessionPins(value.pinnedSessions)
    .reverse()
    .map((pin) => ({ kind: 'session', id: pin.sessionId, workspaceId: pin.workspaceId }))
  return uniquePins([...workspaces, ...sessions])
}

export function isPinned(pins: readonly Pin[], target: PinTarget): boolean {
  return pins.some((pin) => pinKey(pin) === pinKey(target))
}

/** Pinning changes only the shortcut list, never the workspace/session order. */
export function updatePin(pins: readonly Pin[], pin: Pin, pinned: boolean): Pin[] {
  const rest = pins.filter((item) => pinKey(item) !== pinKey(pin))
  return pinned ? [pin, ...rest] : rest
}

/** Reject malformed writes instead of interpreting them as a request to clear. */
export function parsePinAction(value: unknown): PinAction | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const body = value as Record<string, unknown>
  if (body.action === 'set' && typeof body.pinned === 'boolean') {
    const pin = parsePin(body.pin)
    if (pin !== undefined) return { action: 'set', pin, pinned: body.pinned }
  }
  if (body.action === 'import' && Array.isArray(body.pins)) {
    if (body.pins.some((pin) => parsePin(pin) === undefined)) return undefined
    return { action: 'import', pins: readPins(body) }
  }
  return undefined
}
