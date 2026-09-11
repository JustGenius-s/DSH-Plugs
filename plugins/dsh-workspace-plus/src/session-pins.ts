export interface SessionPin {
  /** Empty only while migrating the old global string-array format. */
  workspaceId: string
  sessionId: string
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Read both the current scoped rows and the legacy global session-id array. */
export function parseSessionPins(value: unknown): SessionPin[] {
  if (!Array.isArray(value)) return []
  const pins: SessionPin[] = []
  for (const item of value) {
    if (validText(item)) {
      pins.push({ workspaceId: '', sessionId: item })
      continue
    }
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.workspaceId !== 'string' || !validText(row.sessionId)) continue
    pins.push({ workspaceId: row.workspaceId, sessionId: row.sessionId })
  }
  return dedupeSessionPins(pins)
}

function dedupeSessionPins(pins: readonly SessionPin[]): SessionPin[] {
  const seen = new Set<string>()
  const kept: SessionPin[] = []
  for (let index = pins.length - 1; index >= 0; index -= 1) {
    const pin = pins[index]
    if (pin === undefined) continue
    const key = `${pin.workspaceId}\0${pin.sessionId}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(pin)
  }
  return kept.reverse()
}
