import { randomUUID } from 'node:crypto'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { cuaTool } from './shared/cua-tools.ts'

export type WindowExecution = Parameters<NonNullable<ReturnType<Context['tools']['get']>>['execute']>[1]
type PipelineExecution = Parameters<Context['tools']['execute']>[0]
type PipelineResult = Awaited<ReturnType<Context['tools']['execute']>>
type Permit = { parent: WindowExecution['token']; sessionId: string; name: string; args: string; validate: () => Promise<void> }

/** Nested calls retain the host's normal approval, guard and result policies. */
export class WindowDriver {
  private readonly permits = new Map<string, Permit>()
  private readonly calls = new Map<string, WindowExecution['token']>()
  constructor(
    private readonly tools: Pick<Context['tools'], 'schemas' | 'get' | 'execute'>,
    private readonly sessionArguments = (_name: string, args: Record<string, unknown>, _exec: WindowExecution) => args,
  ) {}

  select(exec: WindowExecution): string {
    const candidates = this.tools.schemas(exec.agent).map((tool) => tool.name).filter((name) =>
      cuaTool(name)?.operation === 'get_window_state')
    // Code Mode may collapse public schemas. Resolve only known provider
    // names through the scoped registry, never import or spawn another driver.
    for (const name of [
      'mcp__cua-driver-mcp__get_window_state', 'cua_driver_native__get_window_state',
      'mcp__cua-driver__get_window_state',
    ]) {
      if (this.tools.get(name, exec.agent) !== undefined && !candidates.includes(name)) candidates.push(name)
    }
    if (candidates.length !== 1) throw new Error('window_provider_unavailable: computer_window requires exactly one visible Cua provider; call the configured Cua tools directly without binding')
    return candidates[0]!
  }

  name(stateTool: string, operation: string, exec: WindowExecution): string {
    const name = stateTool.replace(/get_window_state$/, operation)
    if (this.tools.get(name, exec.agent) === undefined) throw new Error(`window_action_unavailable: ${operation}`)
    return name
  }

  owns(exec: PipelineExecution): boolean {
    return exec.parent !== undefined && this.calls.get(String(exec.callId)) === exec.parent
  }

  permitted(exec: PipelineExecution): boolean {
    const permit = this.permits.get(String(exec.callId))
    return permit !== undefined && permit.parent === exec.parent && permit.name === exec.name
      && permit.sessionId === String(exec.agent?.session.id) && permit.args === JSON.stringify(exec.arguments)
  }

  async validate(exec: PipelineExecution): Promise<void> {
    if (!this.permitted(exec)) throw new Error('window_batch_permit_invalid')
    await this.permits.get(String(exec.callId))!.validate()
    exec.signal.throwIfAborted()
  }

  async call(
    name: string, args: Record<string, unknown>, exec: WindowExecution, validate?: () => Promise<void>,
  ): Promise<PipelineResult> {
    args = this.sessionArguments(name, args, exec)
    // The registry brands this transport identity; the unique suffix is never
    // model-supplied and the opaque parent token authenticates the permit.
    const callId = `${exec.callId}:window:${randomUUID()}` as WindowExecution['callId']
    this.calls.set(callId, exec.token)
    if (validate !== undefined) this.permits.set(callId, {
      parent: exec.token, sessionId: String(exec.agent?.session.id), name, args: JSON.stringify(args), validate,
    })
    try {
      const result = await this.tools.execute({
        callId, rootCallId: exec.rootCallId, parent: exec.token, name, arguments: args,
        agent: exec.agent, signal: exec.signal,
      })
      for (const context of result.additionalContexts ?? []) exec.deferContext(context)
      if (result.concludesTurn) exec.concludeTurn()
      return result
    } finally {
      this.permits.delete(callId)
      this.calls.delete(callId)
    }
  }
}
