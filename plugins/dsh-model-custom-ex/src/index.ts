// Host half of @just-genius/dsh-model-custom-ex.
//
// Owns the per-model switch-to thinking defaults namespace and stamps the
// resolved level onto catalog metadata, so the composer never lands on
// Default for a model that offers thinking levels. The browser half ships
// through `exports["./client"]` and is discovered via the `dsh.client`
// manifest in package.json.
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, Schema, settingsNamespace } from '@just-genius/dsh-plugin-runtime/host'
import {
  DEFAULTS_NAMESPACE,
  EMPTY_CONFIG,
  injectDefaultEffort,
  type ModelCustomExConfig,
} from './shared'

export const name = 'dsh-model-custom-ex'
export const inject = [HOST_SERVICES.settings, HOST_SERVICES.llm] as const

const ConfigSchema: Schema<ModelCustomExConfig> = Schema.object({
  defaults: Schema.dict(Schema.dict(Schema.string())).default({}),
})

export function apply(ctx: Context): void {
  const scope = ctx.settings.register(
    settingsNamespace(DEFAULTS_NAMESPACE),
    ConfigSchema,
    { base: EMPTY_CONFIG },
  )

  const original = ctx.llm.resolveModelInfo.bind(ctx.llm)
  ctx.llm.resolveModelInfo = async (provider, model, signal) => {
    const info = await original(provider, model, signal)
    return injectDefaultEffort(info, (scope.get() as ModelCustomExConfig).defaults)
  }

  ctx.effect(() => () => {
    ctx.llm.resolveModelInfo = original
  }, 'dsh-model-custom-ex: restore resolveModelInfo')
}
