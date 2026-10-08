import type { SettingsPathOpView } from '@just-genius/dsh-plugin-runtime/client'

type JsonValue = Extract<SettingsPathOpView, { op: 'set' }>['value']

/** Copy a form value through JSON before crossing the settings remote boundary. */
export function jsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('settings value must be JSON serializable')
  return JSON.parse(encoded) as JsonValue
}
