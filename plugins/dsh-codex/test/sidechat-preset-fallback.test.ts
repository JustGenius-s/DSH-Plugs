/**
 * A stale agent preset must not block opening a side chat.
 *
 * `presets.resolve()` THROWS for an id that no longer exists (renamed,
 * deleted, or a root that failed to scan). Uncaught, that turned every side
 * chat open into a 500 — the panel showed only "Cannot read properties of
 * undefined (reading 'length')" with no Host stack, because the failure never
 * reached a handler that could describe it. The side chat is still perfectly
 * usable with the default agent, so resolution is best-effort.
 */

import { describe, expect, it } from 'vitest'
import { composeAgentFor } from '../src/host/side-chat/server'

/** A minimal ctx: a preset registry and a logger, both injectable. */
function ctxWith(presets: unknown, warnings: string[] = []): any {
  return {
    get: (name: string) => (name === 'agentPresets' ? presets : undefined),
    logger: { warn: (message: string) => { warnings.push(message) } },
  }
}

describe('composeAgentFor', () => {
  it('composes the resolved preset when it still exists', async () => {
    const mounted: string[] = []
    const presets = {
      resolve: async (id: string) => ({ id: `resolved:${id}` }),
      mount: async (_ctx: unknown, id: string) => { mounted.push(id) },
    }
    const composition = await composeAgentFor(ctxWith(presets), 'legacy-preset')
    expect(composition.agentPreset).toBe('resolved:legacy-preset')
    await composition.setup({} as never)
    expect(mounted).toEqual(['resolved:legacy-preset'])
  })

  it('falls back to a no-op setup when resolve throws', async () => {
    const warnings: string[] = []
    const presets = {
      resolve: async () => { throw new TypeError("Cannot read properties of undefined (reading 'length')") },
      mount: async () => { throw new Error('must not mount') },
    }
    const composition = await composeAgentFor(ctxWith(presets, warnings), 'stale')
    // No preset, but opening the side chat still succeeds.
    expect(composition.agentPreset).toBeUndefined()
    await expect(composition.setup({} as never)).resolves.toBeUndefined()
    // And the cause is recorded host-side instead of vanishing.
    expect(warnings.join('\n')).toContain('stale')
  })

  it('falls back when the registry is not mounted', async () => {
    const composition = await composeAgentFor(ctxWith(undefined), 'any')
    expect(composition.agentPreset).toBeUndefined()
    await expect(composition.setup({} as never)).resolves.toBeUndefined()
  })

  it('falls back when the parent has no preset at all', async () => {
    const composition = await composeAgentFor(ctxWith({ resolve: async () => ({ id: 'x' }) }), undefined)
    expect(composition.agentPreset).toBeUndefined()
  })

  it('survives a resolve that returns nothing', async () => {
    const warnings: string[] = []
    const composition = await composeAgentFor(
      ctxWith({ resolve: async () => undefined, mount: async () => {} }, warnings),
      'gone',
    )
    expect(composition.agentPreset).toBeUndefined()
    expect(warnings.join('\n')).toContain('gone')
  })
})
