import { Schema } from '@just-genius/dsh-plugin-runtime/host'
import { installDefaultResolver, type ModelResolver } from './default-resolver.ts'
import type { ModelCustomExConfig } from '../shared.ts'

export const name = 'dsh-model-custom-ex'
export const inject = ['llm', 'settings'] as const
// Shared types describe 3.18.2; desktop bundles the installed 3.18.4 runtime.
const defaultsSchema = Schema.dict(Schema.dict(Schema.string())).default({})
const volatileDefaults = (defaultsSchema as typeof defaultsSchema & { volatile(): typeof defaultsSchema }).volatile()
export const Config = Schema.object({ defaults: volatileDefaults })
interface DesktopContext {
  llm: ModelResolver
  fiber: unknown
  settings: { configure(options: { auto: boolean }, fiber: unknown): () => void }
  effect(setup: () => (() => void), label?: string): void
  on(event: string, listener: () => void): void
  emit(event: string): void
}
export function apply(ctx: DesktopContext, config: { defaults: { get(): ModelCustomExConfig['defaults'] } }): void {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  ctx.effect(() => installDefaultResolver(ctx.llm, () => config.defaults.get()), 'model-custom-ex: default effort')
  ctx.on('loader/volatile-update', () => { ctx.emit('llm/adapters-updated') })
}
