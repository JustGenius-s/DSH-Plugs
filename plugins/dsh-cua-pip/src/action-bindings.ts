import { cuaTool, isCuaInput } from './shared/cua-tools.ts'
import type { WatchTarget } from './shared/types.ts'

const MAX_WINDOWS = 16
const MAX_ELEMENTS = 2000
export const BINDING_TTL_MS = 60_000
type Row = Record<string, unknown>
function row(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined
}
function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function opaque(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 1024
}
function failed(value: Row): boolean {
  return value.isError === true || value.ok === false || value.success === false
    || ['failed', 'refused'].includes(String(value.effect))
    || ['error', 'failed', 'refused'].includes(String(value.status))
    || Boolean(value.error) || typeof value.code === 'string' && value.code !== ''
      && value.ok !== true && value.success !== true && value.effect !== 'confirmed'
}

interface Binding {
  target: WatchTarget
  provider: string
  snapshot: string | undefined
  tokens: Map<string, number>
  indices: Set<number>
  at: number
}

export interface ResolvedAction {
  args: unknown
  target?: WatchTarget
  error?: string
}

/** Only canonical driver results may resolve a token to a window. */
export class ActionBindings {
  private readonly sessions = new Map<string, Map<string, Binding>>()
  constructor(private readonly now: () => number = Date.now) {}

  record(sessionId: string, name: string, value: unknown): void {
    const tool = cuaTool(name)
    if (tool?.operation !== 'get_window_state') return
    const envelope = row(value)
    const state = row(envelope?.structuredContent)
    if (envelope === undefined || state === undefined || !id(state.pid) || !id(state.window_id)) return
    const bindings = this.sessions.get(sessionId) ?? new Map<string, Binding>()
    const key = `${tool.provider}:${state.pid}:${state.window_id}`
    bindings.delete(key)
    if (failed(envelope) || failed(state) || !Array.isArray(state.elements)) {
      if (bindings.size === 0) this.sessions.delete(sessionId)
      return
    }
    const tokens = new Map<string, number>()
    const indices = new Set<number>()
    for (const value of state.elements.slice(0, MAX_ELEMENTS)) {
      const element = row(value)
      const index = element?.element_index
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) continue
      indices.add(index)
      if (opaque(element?.element_token)) tokens.set(element.element_token, index)
    }
    bindings.set(key, {
      provider: tool.provider, target: { pid: state.pid, windowId: state.window_id },
      snapshot: opaque(state.snapshot_id) ? state.snapshot_id : undefined, tokens, indices, at: this.now(),
    })
    while (bindings.size > MAX_WINDOWS) bindings.delete(bindings.keys().next().value!)
    this.sessions.set(sessionId, bindings)
  }

  resolve(sessionId: string | undefined, name: string, raw: unknown): ResolvedAction {
    let value = raw
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw) } catch { return { args: raw } }
    }
    const args = row(value)
    const tool = cuaTool(name)
    if (args === undefined || tool === undefined) return { args: raw }
    const nested = row(args.target)
    const pid = args.pid ?? nested?.pid
    const windowId = args.window_id ?? nested?.window_id
    if (id(pid) && id(windowId)) return { args: value, target: { pid, windowId } }
    if (!isCuaInput(name) || args.scope === 'desktop' || nested?.kind === 'desktop') return { args: value }
    // A caller-supplied invalid window ID must not be silently repaired.
    if (!id(pid) || windowId !== undefined) return { args: value }
    const hasToken = opaque(args.element_token)
    const hasSnapshot = opaque(args.snapshot_id)
      && typeof args.element_index === 'number' && Number.isSafeInteger(args.element_index) && args.element_index >= 0
    if (!hasToken && !hasSnapshot) return { args: value }
    const candidates = sessionId === undefined ? [] : [...(this.sessions.get(sessionId)?.values() ?? [])]
    const matches = candidates.filter((binding) => binding.provider === tool.provider && binding.target.pid === pid
      && this.now() >= binding.at && this.now() - binding.at < BINDING_TTL_MS
      && (hasToken ? binding.tokens.has(args.element_token as string)
        : binding.snapshot === args.snapshot_id && binding.indices.has(args.element_index as number)))
    const binding = matches.length === 1 ? matches[0] : undefined
    if (binding === undefined) return {
      args: value,
      error: 'action_binding_missing: obtain a fresh get_window_state in this session/provider, or supply its exact pid and window_id; do not guess a token window',
    }
    if (hasToken && (
      args.element_index !== undefined && binding.tokens.get(args.element_token as string) !== args.element_index
      || args.snapshot_id !== undefined && args.snapshot_id !== binding.snapshot
    )) return { args: value, error: 'action_binding_conflict: element_token conflicts with snapshot_id or element_index' }
    // This copy is for policy/monitoring only. The actual driver receives its
    // original immutable args and performs its own authoritative token check.
    return { args: { ...args, window_id: binding.target.windowId }, target: { ...binding.target } }
  }

  clear(sessionId?: string): void {
    if (sessionId === undefined) this.sessions.clear()
    else this.sessions.delete(sessionId)
  }
}
