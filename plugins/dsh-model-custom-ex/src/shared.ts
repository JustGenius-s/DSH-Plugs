/** Settings namespace for per-model switch-to thinking defaults. */
export const DEFAULTS_NAMESPACE = 'dsh-model-custom-ex'

/** Durable config written under {@link DEFAULTS_NAMESPACE}. */
export interface ModelCustomExConfig {
  /** `defaults[provider][modelId] = effort`. */
  defaults: Record<string, Record<string, string>>
}

/** Empty config used as the composition base. */
export const EMPTY_CONFIG: ModelCustomExConfig = { defaults: {} }

/**
 * Copy one provider's stored defaults, dropping empty values.
 * @param defaults - the full map, or nothing when the section is unset.
 * @param provider - route id.
 * @returns a new object keyed by model id.
 */
export function pickProviderDefaults(
  defaults: Record<string, Record<string, string>> | undefined,
  provider: string,
): Record<string, string> {
  const row = defaults?.[provider]
  if (row === undefined) return {}
  return Object.fromEntries(
    Object.entries(row).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && entry[1].length > 0
    )),
  )
}

/**
 * Pick the switch-to thinking level: a stored override, else the model's
 * own recommended default, else the first offered level. There is no
 * empty / Default choice.
 */
export function resolveDefaultEffort(
  offered: readonly string[],
  stored: string | undefined,
  recommended: string | undefined,
): string | undefined {
  if (offered.length === 0) return undefined
  if (typeof stored === 'string' && offered.includes(stored)) return stored
  if (typeof recommended === 'string' && offered.includes(recommended)) return recommended
  return offered[0]
}

/**
 * Stamp a concrete `defaultEffort` onto resolved catalog metadata so the
 * composer never lands on Default when the model offers any level.
 */
export function injectDefaultEffort<T extends {
  provider: string
  id: string
  reasoning?: { efforts: readonly { id: string }[]; defaultEffort?: string }
}>(info: T, defaults: Record<string, Record<string, string>>): T {
  const reasoning = info.reasoning
  if (reasoning === undefined) return info
  const offered = reasoning.efforts.map(level => level.id)
  const chosen = resolveDefaultEffort(offered, defaults[info.provider]?.[info.id], reasoning.defaultEffort)
  if (chosen === undefined || chosen === reasoning.defaultEffort) return info
  return { ...info, reasoning: { ...reasoning, defaultEffort: chosen } }
}
