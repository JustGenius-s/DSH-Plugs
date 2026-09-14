import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index'

/**
 * Minimal stand-in for the cordis host context, wiring only what the plugin
 * touches: a settings scope, an llm service, an effect hook, and an event bus
 * that composes listeners in Cordis waterfall order (outermost-first, and a
 * listener registered with `prepend` wraps later plain registrations).
 */
function harness(options: {
  defaults: Record<string, Record<string, string>>
  efforts: readonly string[]
  /** Simulates dsh-agent's model selection: re-applies a selection and DROPS inherited effort. */
  inner?: (config: any) => any
}) {
  const listeners: { callback: any, prepend: boolean }[] = []
  const scope = { get: () => ({ defaults: options.defaults }) }
  const llm = {
    resolveModelInfo: async (provider: string, model: string) => ({
      provider,
      id: model,
      reasoning: options.efforts.length === 0
        ? undefined
        : { efforts: options.efforts.map(id => ({ id })) },
    }),
  }
  const ctx = {
    settings: { register: () => scope },
    llm,
    logger: () => ({ warn: vi.fn() }),
    effect: (fn: () => () => void) => { fn() },
    on: (name: string, callback: any, opts?: { prepend?: boolean }) => {
      if (name !== 'agent/request') return
      if (opts?.prepend) listeners.unshift({ callback, prepend: true })
      else listeners.push({ callback, prepend: false })
    },
  }
  apply(ctx as any)

  /** Dispatch the waterfall the way Cordis does: outermost first, last arg is next. */
  const dispatch = async (config: any) => {
    const chain = listeners.map(l => l.callback)
    const run = async (index: number, current: any): Promise<any> => {
      const listener = chain[index]
      if (listener === undefined) return current
      return listener({}, () => run(index + 1, current))
    }
    return run(0, config)
  }
  return { dispatch, listeners, llm }
}

describe('dsh-model-custom-ex', () => {
  it('sends the pinned level on the wire when the request carries no effort', async () => {
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    const config = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast' })
    expect(config.reasoningEffort).toBe('xhigh')
  })

  it('keeps the pin even though dsh-agent strips inherited effort afterwards', async () => {
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast' })
    // The plugin must be registered OUTERMOST, or the selection would overwrite it.
    const inner = async (_p: any, next: any) => {
      const resolved = await next()
      const { reasoningEffort: _dropped, ...rest } = resolved
      return { ...rest, provider: 'cursor', model: 'cursor-grok-4.6-fast' }
    }
    // Re-run with the stripping listener registered innermost.
    const { dispatch: d2, listeners: l2 } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    const plugin = l2.find(l => l.prepend)!
    const chain = [plugin.callback, inner]
    const run = async (index: number, current: any): Promise<any> =>
      chain[index] === undefined ? current : chain[index]({}, () => run(index + 1, current))
    const config = await run(0, { provider: 'cursor', model: 'cursor-grok-4.6-fast' })
    expect(config.reasoningEffort).toBe('xhigh')
  })

  it('never overrides an explicit effort already on the request', async () => {
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    const config = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast', reasoningEffort: 'low' })
    expect(config.reasoningEffort).toBe('low')
  })

  it('ignores a pin the model does not offer, instead of dispatching a rejected level', async () => {
    // dsh-llm throws UNSUPPORTED_REASONING_EFFORT rather than clamping.
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.5-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high'],
    })
    const config = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.5-fast' })
    expect(config.reasoningEffort).toBeUndefined()
  })

  it('leaves unpinned models untouched, so no level is invented for them', async () => {
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    const config = await dispatch({ provider: 'cursor', model: 'gemini-3.8-flash' })
    expect(config.reasoningEffort).toBeUndefined()
  })

  it('lets a deliberately chosen level beat the pin, then restores the pin on clear', async () => {
    // Picker precedence the plugin's UI promises: the pin is the "switch-to"
    // default, an explicit choice outranks it, and clearing back to Default
    // returns to the pin.
    const { dispatch } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    // Explicit session choice of "low" wins.
    const explicit = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast', reasoningEffort: 'low' })
    expect(explicit.reasoningEffort).toBe('low')
    // Cleared back to Default: the pinned level applies again.
    const cleared = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast' })
    expect(cleared.reasoningEffort).toBe('xhigh')
  })

  it('leaves the request intact when resolving the default throws', async () => {
    // This listener wraps every dispatched request, so a failure inside it must
    // degrade to "no default", never to a failed model call.
    const { dispatch, llm } = harness({
      defaults: { cursor: { 'cursor-grok-4.6-fast': 'xhigh' } },
      efforts: ['low', 'medium', 'high', 'xhigh'],
    })
    llm.resolveModelInfo = async () => { throw new Error('catalog exploded') }
    const config = await dispatch({ provider: 'cursor', model: 'cursor-grok-4.6-fast' })
    expect(config.reasoningEffort).toBeUndefined()
    expect(config.provider).toBe('cursor')
  })

  it('leaves models with no thinking levels untouched', async () => {
    const { dispatch } = harness({
      defaults: { cursor: { 'plain-model': 'high' } },
      efforts: [],
    })
    const config = await dispatch({ provider: 'cursor', model: 'plain-model' })
    expect(config.reasoningEffort).toBeUndefined()
  })
})
