import { injectDefaultEffort, type ModelCustomExConfig } from '../shared.ts'
export interface ModelInfo { provider: string; id: string; reasoning?: { efforts: { id: string }[]; defaultEffort?: string } }
export interface ModelResolver { resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<ModelInfo> }
/** Keep the registry's receiver and exact original method when disabling the plugin. */
export function installDefaultResolver(registry: ModelResolver, defaults: () => ModelCustomExConfig['defaults']): () => void {
  const original = registry.resolveModelInfo
  let active = true
  const wrapped: ModelResolver['resolveModelInfo'] = async (provider, model, signal) => {
    const info = await original.call(registry, provider, model, signal)
    if (!active) return info
    const current = defaults()
    const chosen = current[info.provider]?.[info.id]
    return chosen && info.reasoning?.efforts.some(level => level.id === chosen) ? injectDefaultEffort(info, current) : info
  }
  registry.resolveModelInfo = wrapped
  return () => { active = false; if (registry.resolveModelInfo === wrapped) registry.resolveModelInfo = original }
}
