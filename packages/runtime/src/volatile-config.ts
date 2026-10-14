/** Read DSH 0.1.7 live Config handles, retaining defaults for direct tests. */
export function readVolatileConfig<T extends object>(config: unknown, defaults: T): T {
  const source = config !== null && typeof config === 'object'
    ? config as Record<string, unknown>
    : {}
  const result: Record<string, unknown> = {}
  for (const [key, fallback] of Object.entries(defaults)) {
    const field = source[key]
    const value = field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function'
      ? (field as { get(): unknown }).get()
      : field
    result[key] = value === undefined ? fallback : value
  }
  return result as T
}
