// Host half of @just-genius/dsh-model-custom-ex.
//
// Owns the per-model switch-to thinking defaults namespace and applies it at two
// seams, because the composer's label and the dispatched request read a model's
// capability through different paths:
//
//   - ctx.llm.resolveModelInfo stamps a concrete defaultEffort onto resolved
//     catalog metadata, so the composer never lands on Default for a model that
//     offers thinking levels.
//   - the agent/request waterfall turns that same default into the request's own
//     reasoningEffort, so the level the composer shows is the level the provider is
//     actually asked for.
//
// The second seam is what makes the setting real. dsh-llm resolves a request
// through resolveCallConfig/prepareCall, which go straight to the adapter and never
// read the patched public method above: stamping the catalog alone labels the
// composer without changing anything that leaves the process.
//
// The browser half ships through exports["./client"] and is discovered via the
// dsh.client manifest in package.json.
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, Schema, errorMessage, settingsNamespace } from '@just-genius/dsh-plugin-runtime/host'
import {
  DEFAULTS_NAMESPACE,
  EMPTY_CONFIG,
  injectDefaultEffort,
  pickProviderDefaults,
  type ModelCustomExConfig,
} from './shared'

export const name = 'dsh-model-custom-ex'
export const inject = [HOST_SERVICES.settings, HOST_SERVICES.llm] as const

const ConfigSchema: Schema<ModelCustomExConfig> = Schema.object({
  defaults: Schema.dict(Schema.dict(Schema.string())).default({}),
})

/**
 * The reasoning level type the llm service accepts for a request.
 *
 * Derived from the service rather than imported: plugin sources reach DSH only
 * through the shared runtime boundary, and the branded effort id is not part of it.
 * Deriving also keeps this honest - the value returned to the request waterfall is
 * exactly the one resolveModelInfo offered, never a string this plugin invented.
 */
type OfferedEffort = NonNullable<
  Awaited<ReturnType<Context['llm']['resolveModelInfo']>>['reasoning']
>['efforts'][number]['id']

/** Report one unusable pin per route, rather than once per request. */
function warnOnce(ctx: Context, warned: Set<string>, route: string, detail: string): void {
  const key = route + '|' + detail
  if (warned.has(key)) return
  warned.add(key)
  ctx.logger('dsh-model-custom-ex').warn(route + ' ' + detail)
}

/**
 * Resolve the level this exact route actually offers for a configured pin.
 *
 * The adapter is the only honest source for this answer, and it must be asked:
 * dsh-llm rejects an effort the model does not offer with
 * UNSUPPORTED_REASONING_EFFORT instead of clamping it, so a pin that names an
 * unavailable level has to be skipped, not dispatched. Resolution also hands back
 * the effort id the loop itself validates against, so no value is ever constructed
 * here.
 *
 * A route that cannot be resolved leaves the request untouched - prepareCall
 * reports a genuinely broken route with its own error handling.
 *
 * @param ctx - host context carrying the llm service.
 * @param provider - the request's provider route.
 * @param model - the request's provider-owned model id.
 * @param wanted - the level the user pinned for this route.
 * @param warned - routes already reported, so the warning is not sent per request.
 * @returns the offered effort id, or undefined when the pin must not be applied.
 */
async function pinnedEffort(
  ctx: Context,
  provider: string,
  model: string,
  wanted: string,
  warned: Set<string>,
): Promise<OfferedEffort | undefined> {
  const route = provider + '/' + model
  try {
    const reasoning = (await ctx.llm.resolveModelInfo(provider, model)).reasoning
    if (reasoning === undefined) {
      warnOnce(ctx, warned, route, 'offers no thinking levels; ignoring the pinned "' + wanted + '".')
      return undefined
    }
    const match = reasoning.efforts.find((level) => String(level.id) === wanted)
    if (match !== undefined) return match.id
    const offered = reasoning.efforts.map((level) => String(level.id)).join(', ')
    warnOnce(ctx, warned, route, 'does not offer "' + wanted + '"; keeping the provider default. Offered: ' + (offered || '(none)'))
  } catch (error) {
    warnOnce(ctx, warned, route, 'could not be resolved (' + errorMessage(error) + '); ignoring the pinned "' + wanted + '".')
  }
  return undefined
}

/**
 * Install the defaults namespace and apply it to both the catalog and the wire.
 * @param ctx - host context carrying the settings and llm services.
 */
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

  // prepend is load-bearing. dsh-agent's model selection owns an agent/request
  // listener that re-applies the session selection and drops any inherited effort,
  // so wrapping it - calling next() first and amending the result - is what lets
  // this default survive into the dispatched request. An innermost listener would be
  // overwritten and silently do nothing.
  //
  // Only a request that names no effort is amended: an explicit pick (or the effort
  // already recorded in this session's header) stays authoritative, which is the
  // same precedence the composer shows.
  const warned = new Set<string>()
  ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    if (resolved.reasoningEffort !== undefined) return resolved
    const { provider, model } = resolved
    try {
      const wanted = pickProviderDefaults((scope.get() as ModelCustomExConfig).defaults, provider)[model]
      if (wanted === undefined) return resolved
      const effort = await pinnedEffort(ctx, provider, model, wanted, warned)
      if (effort === undefined) return resolved
      return { ...resolved, reasoningEffort: effort }
    } catch (error) {
      // This runs inside the waterfall every request dispatches through, so a
      // failure here would take the request with it. A missing default is a far
      // better outcome than a model call this plugin prevented.
      warnOnce(ctx, warned, provider + '/' + model, 'defaults could not be applied (' + errorMessage(error) + '); request left unchanged.')
      return resolved
    }
  }, { prepend: true })
}
