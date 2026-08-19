export function parseTurnEvent(event: unknown): { kind: 'start' | 'end'; blocked: boolean } | null {
  if (event === null || typeof event !== 'object') return null
  const type = typeof (event as { type?: unknown }).type === 'string' ? (event as { type: string }).type : null
  if (type === 'turn/start') return { kind: 'start', blocked: false }
  if (type === 'turn/end') {
    const data = (event as { data?: unknown }).data
    const reason = typeof data === 'object' && data !== null ? (data as { reason?: unknown }).reason : null
    const blocked = typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'blocked'
    return { kind: 'end', blocked }
  }
  return null
}

export type SessionActivity = 'thinking' | 'waiting' | 'done' | `tool:${string}`

export interface SessionView {
  id: string
  title: string | null
  activity: string
  since: number
}

export function parseSessionEvent(event: unknown):
  | { kind: 'activity'; value: string }
  | { kind: 'title'; value: string }
  | null {
  if (event === null || typeof event !== 'object') return null
  const type = typeof (event as { type?: unknown }).type === 'string' ? (event as { type: string }).type : null
  const data = typeof (event as { data?: unknown }).data === 'object' && (event as { data?: unknown }).data !== null
    ? (event as { data: Record<string, unknown> }).data
    : null
  if (type === 'turn/start') return { kind: 'activity', value: 'thinking' }
  if (type === 'tool/call') {
    const name = data !== null && typeof data.name === 'string' ? data.name : null
    if (name === null || name === '') return null
    return { kind: 'activity', value: `tool:${name}` }
  }
  if (type === 'turn/end') {
    const reason = data !== null ? data.reason : null
    const blocked = typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'blocked'
    return { kind: 'activity', value: blocked ? 'waiting' : 'done' }
  }
  if (type === 'session/title') {
    const title = data !== null && typeof data.title === 'string' ? data.title : null
    if (title === null || title === '') return null
    return { kind: 'title', value: title }
  }
  return null
}

export function createSessionView(id: string, since: number): SessionView {
  return { id, title: null, activity: 'done', since }
}

export function applySessionView(view: SessionView, event: unknown): SessionView {
  const parsed = parseSessionEvent(event)
  if (parsed === null) return view
  if (parsed.kind === 'title') {
    if (parsed.value === view.title) return view
    return { ...view, title: parsed.value }
  }
  if (parsed.value === view.activity) return view
  return { ...view, activity: parsed.value }
}

export function titleFromLog(events: readonly unknown[]): string | null {
  if (!Array.isArray(events)) return null
  let title: string | null = null
  for (const event of events) {
    const parsed = parseSessionEvent(event)
    if (parsed !== null && parsed.kind === 'title') title = parsed.value
  }
  return title
}
