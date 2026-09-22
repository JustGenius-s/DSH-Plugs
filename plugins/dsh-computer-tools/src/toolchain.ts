import { randomUUID } from 'node:crypto'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { ToolchainHealth } from './shared.ts'

type Tools = Pick<Context['tools'], 'get' | 'execute'>
const PROBES = ['mcp__cua-driver-mcp__list_windows', 'mcp__cua-driver__list_windows']

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Uses the installed MCP pipeline, never a fresh CLI connection or screenshot. */
export function createToolchainProbe(getTools: () => Tools | undefined, now = Date.now) {
  let cached: ToolchainHealth | undefined
  let pending: Promise<ToolchainHealth> | undefined
  return (): Promise<ToolchainHealth> => {
    if (pending !== undefined) return pending
    if (cached !== undefined && now() - cached.checkedAt < 5000) return Promise.resolve(cached)
    const check = async (): Promise<ToolchainHealth> => {
      const tools = getTools()
      const names = tools === undefined ? [] : PROBES.filter((name) => tools.get(name) !== undefined)
      const tool = names.length === 1 ? names[0]! : null
      if (tools === undefined || tool === null) {
        return { state: 'unavailable', tool, checkedAt: now(), error: 'Exactly one registered Cua MCP provider is required' }
      }
      try {
        const result = await tools.execute({
          callId: `cua-health:${randomUUID()}` as Parameters<Tools['execute']>[0]['callId'],
          name: tool, arguments: {}, signal: AbortSignal.timeout(5000),
        })
        if (result.isError) return { state: 'failed', tool, checkedAt: now(), error: result.error.message }
        const value = record(result.value)
        const payload = record(value?.structuredContent) ?? value
        if (!Array.isArray(payload?.windows)) {
          return { state: 'failed', tool, checkedAt: now(), error: 'Cua returned no canonical window inventory' }
        }
        return { state: 'ready', tool, checkedAt: now(), error: null }
      } catch (error) {
        return { state: 'failed', tool, checkedAt: now(), error: error instanceof Error ? error.message : String(error) }
      }
    }
    pending = check().then((value) => { cached = value; return value }).finally(() => { pending = undefined })
    return pending
  }
}
