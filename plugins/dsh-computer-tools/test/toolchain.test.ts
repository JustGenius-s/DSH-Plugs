import { describe, expect, it, vi } from 'vitest'
import { createToolchainProbe } from '../src/toolchain.ts'

const name = 'mcp__cua-driver-mcp__list_windows'
type Tools = NonNullable<ReturnType<Parameters<typeof createToolchainProbe>[0]>>
function harness() {
  let now = 1000
  const execute = vi.fn<Tools['execute']>(async () => ({ isError: false, content: [], value: { structuredContent: { windows: [] } } }))
  const tools = { get: (candidate: string) => candidate === name ? { name } : undefined, execute }
  const probe = createToolchainProbe(() => tools as unknown as Tools, () => now)
  return { probe, execute, advance: () => { now += 5001 } }
}

describe('registered MCP toolchain health', () => {
  it('probes without images or input through the existing provider and caches/coalesces polls', async () => {
    const h = harness()
    const [first, second] = await Promise.all([h.probe(), h.probe()])
    expect(first).toEqual({ state: 'ready', tool: name, checkedAt: 1000, error: null })
    expect(second).toEqual(first)
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.execute.mock.calls[0]![0]).toMatchObject({ name, arguments: {}, signal: expect.any(AbortSignal) })
    await h.probe()
    expect(h.execute).toHaveBeenCalledTimes(1)
    h.advance()
    await h.probe()
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it('reports a dead session instead of daemon health', async () => {
    const h = harness()
    h.execute.mockResolvedValue({ isError: true, content: [], error: { message: "session 'implicit' has ended" } })
    expect(await h.probe()).toMatchObject({ state: 'failed', error: expect.stringContaining('has ended') })
  })

  it('reports missing providers and malformed successful responses', async () => {
    expect(await createToolchainProbe(() => undefined)()).toMatchObject({ state: 'unavailable' })
    const h = harness()
    h.execute.mockResolvedValue({ isError: false, content: [], value: {} })
    expect(await h.probe()).toMatchObject({ state: 'failed', error: expect.stringContaining('canonical') })
  })

  it('contains transport failures and allows a subsequent successful probe', async () => {
    const h = harness()
    h.execute.mockRejectedValueOnce(new Error('transport closed'))
    expect(await h.probe()).toMatchObject({ state: 'failed', error: 'transport closed' })
    h.advance()
    expect(await h.probe()).toMatchObject({ state: 'ready' })
  })
})
