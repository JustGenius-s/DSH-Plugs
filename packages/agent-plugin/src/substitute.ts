/**
 * Replace `${VAR}` placeholders in a template string.
 * Unknown variables are left untouched so callers can detect leftovers.
 */
export function substituteVariables(
  template: string,
  variables: Readonly<Record<string, string | boolean | number>>,
): string {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    if (!(name in variables)) return match
    const value = variables[name]
    if (value === undefined || value === null) return match
    return String(value)
  })
}

/** Recursively substitute string leaves inside a JSON-compatible value. */
export function substituteDeep<T>(
  value: T,
  variables: Readonly<Record<string, string | boolean | number>>,
): T {
  if (typeof value === 'string') {
    return substituteVariables(value, variables) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, variables)) as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substituteDeep(child, variables)
    }
    return out as T
  }
  return value
}

/** True when any `${VAR}` placeholder remains unsubstituted. */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(text)
}
