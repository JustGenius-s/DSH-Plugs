import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { cuaTool } from './shared/cua-tools.ts'

type Tools = Pick<Context['tools'], 'get' | 'execute'>
type Call = Parameters<Tools['execute']>[0] & { readonly token: symbol }
type Agent = Call['agent']
type Result = Awaited<ReturnType<Tools['execute']>>
interface Session { id: string; stopped: boolean; epoch: number }
const LIFECYCLE = new Set(['start_session', 'end_session', 'get_session', 'get_session_state', 'list_sessions'])

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function failure(message: string): Result {
  return { isError: true, error: { message }, content: [{ type: 'text', text: `Error: ${message}` }] }
}

/**
 * Cua transport labels belong to the calling DSH session, not the model.
 * Redispatch preserves immutable call identity and runs all host guards again.
 */
export class DriverSessions {
  private readonly hostOwner = Symbol('Cua host diagnostics')
  private readonly sessions = new Map<string | symbol, Map<string, Session>>()
  private readonly forwarded = new WeakMap<object, Result>()
  private readonly preflights = new Map<string, symbol>()
  private readonly dispatches = new Map<string, symbol>()
  private disposed = false

  constructor(
    private readonly tools: Tools,
    private readonly mint: () => string = randomUUID,
    private readonly accepts: (exec: Call) => boolean = () => true,
  ) {}

  manages(exec: Call): boolean {
    return this.accepts(exec) || exec.parent !== undefined && this.dispatches.get(String(exec.callId)) === exec.parent
  }

  private async dispatch(exec: Parameters<Tools['execute']>[0]): Promise<Result> {
    this.dispatches.set(String(exec.callId), exec.parent!)
    try { return await this.tools.execute(exec) }
    finally { this.dispatches.delete(String(exec.callId)) }
  }

  private session(name: string, agent: Agent): Session {
    if (this.disposed) throw new Error('cua_session_unavailable: session manager was unloaded')
    const provider = cuaTool(name)!.provider
    const owner = agent === undefined ? this.hostOwner : String(agent.session.id)
    let providers = this.sessions.get(owner)
    if (providers === undefined) {
      providers = new Map()
      this.sessions.set(owner, providers)
    }
    let session = providers.get(provider)
    if (session === undefined) {
      session = { id: `dsh-${this.mint()}`, stopped: false, epoch: 0 }
      providers.set(provider, session)
    }
    return session
  }

  arguments(name: string, args: Record<string, unknown>, agent: Agent): Record<string, unknown> {
    const tool = cuaTool(name)
    return tool === undefined ? args : {
      ...args, session: this.session(name, agent).id,
      ...(tool.operation === 'check_permissions' && args.prompt === undefined ? { prompt: false } : {}),
    }
  }

  /** Called before PiP input accounting; only the managed leaf dispatches input. */
  async execute(exec: Call, next: () => Promise<Result>): Promise<Result> {
    if (!this.manages(exec)) return next()
    const tool = cuaTool(exec.name)
    const args = object(exec.arguments)
    if (tool === undefined || args === undefined || this.tools.get(exec.name, exec.agent) === undefined) return next()
    exec.signal.throwIfAborted()
    const session = this.session(exec.name, exec.agent)
    if (args.session !== session.id || tool.operation === 'check_permissions' && args.prompt === undefined) {
      const result = await this.dispatch({
        callId: `${exec.callId}:cua-session:${this.mint()}` as Call['callId'],
        rootCallId: exec.rootCallId, parent: exec.token as NonNullable<Call['parent']>,
        agent: exec.agent, signal: exec.signal, name: exec.name,
        arguments: this.arguments(exec.name, args, exec.agent),
      })
      this.forwarded.set(exec, result)
      if (result.concludesTurn) {
        // The registry's dispatch object also owns the enclosing run context.
        if ('concludeTurn' in exec && typeof exec.concludeTurn === 'function') exec.concludeTurn()
        else return failure('cua_session_stopped: the nested provider concluded the turn')
      }
      return result
    }
    let preflight: Result | undefined
    if (!LIFECYCLE.has(tool.operation)) {
      if (session.stopped) return failure('cua_session_ended: call start_session to explicitly restart this DSH session')
      const start = exec.name.slice(0, -tool.operation.length) + 'start_session'
      if (this.tools.get(start, exec.agent) === undefined) {
        return failure('cua_session_unavailable: the configured provider does not expose start_session')
      }
      // Idempotent preflight also revives idle expiry, without replaying input,
      // changing capture policy, or recovering through another provider.
      const callId = `${exec.callId}:cua-start:${this.mint()}` as Call['callId']
      this.preflights.set(String(callId), exec.token)
      let ready: Result
      try {
        ready = await this.dispatch({
          callId, rootCallId: exec.rootCallId, parent: exec.token as NonNullable<Call['parent']>,
          agent: exec.agent, signal: exec.signal, name: start, arguments: { session: session.id },
        })
      } finally { this.preflights.delete(String(callId)) }
      if (ready.isError) return ready
      if (ready.concludesTurn) return failure('cua_session_stopped: lifecycle preflight concluded the turn; no action was dispatched')
      preflight = ready
      exec.signal.throwIfAborted()
      if (this.disposed || session.stopped) return failure('cua_session_stopped: session closed before dispatch')
    }
    const internalStart = this.preflights.get(String(exec.callId)) === exec.parent && exec.parent !== undefined
    const epoch = tool.operation === 'end_session' || tool.operation === 'start_session' && !internalStart
      ? ++session.epoch : session.epoch
    if (tool.operation === 'end_session') session.stopped = true
    const result = await next()
    if (!result.isError) {
      if (tool.operation === 'start_session' && !internalStart && session.epoch === epoch) session.stopped = false
    }
    return preflight?.additionalContexts === undefined ? result : {
      ...result, additionalContexts: [...preflight.additionalContexts, ...(result.additionalContexts ?? [])],
    }
  }

  isForwarded(exec: object): boolean { return this.forwarded.has(exec) }

  /** Outer normalization re-renders text. Restore accepted inner images only. */
  content(exec: object, result: Result): Result['content'] | undefined {
    const inner = this.forwarded.get(exec)
    return inner !== undefined && !inner.isError && !result.isError
      && isDeepStrictEqual(inner.value, result.value) ? inner.content : undefined
  }

  owners(): string[] { return [...this.sessions.keys()].filter((id): id is string => typeof id === 'string') }
  clear(owner: string): void {
    for (const session of this.sessions.get(owner)?.values() ?? []) {
      session.stopped = true
      session.epoch += 1
    }
    this.sessions.delete(owner)
  }
  dispose(): void {
    this.disposed = true
    this.sessions.clear()
    // Driver-owned idle expiry reclaims labels; never end another MCP client's run.
  }
}

export function computerToolNameRefusal(name: string): string | undefined {
  const tool = cuaTool(name)
  if (tool === undefined) return undefined
  if (['computer_pip', 'computer_window', 'computer_pip_placeholder'].includes(tool.operation)) {
    const correct = tool.operation === 'computer_window' ? 'computer_window' : 'computer_pip'
    return `unknown_tool: ${name} is not a Cua Driver tool. Call ${correct} without an MCP prefix.`
  }
  return undefined
}
