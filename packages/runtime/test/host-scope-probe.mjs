import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , toolsEntry, profile] = process.argv
const host = createRequire(realpathSync(toolsEntry))
const plugin = createRequire(join(profile, 'package.json'))
const { Context } = await import(pathToFileURL(host.resolve('@deepseek-ai/cordis')))
const hostScope = await import(pathToFileURL(host.resolve('@deepseek-ai/dsh-scope')))
const pluginScope = await import(pathToFileURL(plugin.resolve('@deepseek-ai/dsh-scope')))
const { ToolRuntime } = await import(pathToFileURL(toolsEntry))
const ctx = new Context()
ctx.provide('systemPrompt', { tools() {} })
const runtime = ctx.plugin(ToolRuntime)
await runtime
let result
const probe = ctx.plugin({
  inject: ['tools'],
  async apply(ctx) {
    const key = {}
    const secondKey = {}
    const first = pluginScope.createScope(ctx, key)
    const second = pluginScope.createScope(ctx, secondKey)
    const definition = {
      name: 'mcp__playwright-mcp__browser_close',
      description: 'scope contract test; no browser or transport',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: async () => ({}),
    }
    result = { recognized: hostScope.scopeOf(first.ctx) === key }
    try {
      first.ctx.tools.register(definition)
      result.globalLeak = ctx.tools.get(definition.name) !== undefined
      const secondDefinition = { ...definition, description: 'second agent' }
      second.ctx.tools.register(secondDefinition)
      result.isolated = ctx.tools.get(definition.name, key) === definition
        && ctx.tools.get(definition.name, secondKey) === secondDefinition
      await first.dispose()
      result.secondSurvives = ctx.tools.get(definition.name, secondKey) === secondDefinition
        && ctx.tools.get(definition.name, key) === undefined
    } catch (error) {
      result.error = error.message
    } finally {
      await first.dispose()
      await second.dispose()
    }
  },
})
try {
  await probe
  console.log(JSON.stringify(result))
} finally {
  await probe.dispose()
  await runtime.dispose()
}
