import type { ModelsOperations } from './operations.ts'
import type { SettingsNamespaceView } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULTS_NAMESPACE, pickProviderDefaults } from '../shared.ts'

/** Read one provider's defaults from the page's settings snapshot. */
export function defaultsFromNamespace(
  namespace: SettingsNamespaceView | undefined,
  provider: string,
): Record<string, string> {
  const root = namespace?.value
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return {}
  const defaults = (root as { defaults?: Record<string, Record<string, string>> }).defaults
  return pickProviderDefaults(defaults, provider)
}

/** Persist one provider's defaults, or drop the row when the map is empty. */
export async function writeProviderDefaults(
  operations: ModelsOperations,
  provider: string,
  next: Record<string, string>,
  expectedRevision: number,
): Promise<{ ok: true; revision: number } | { ok: false; message: string }> {
  const outcome = await operations.writeSettings(
    DEFAULTS_NAMESPACE,
    Object.keys(next).length === 0
      ? [{ op: 'unset', path: ['defaults', provider] }]
      : [{ op: 'set', path: ['defaults', provider], value: next }],
    expectedRevision,
  )
  if (outcome.kind !== 'written') {
    return { ok: false, message: outcome.message }
  }
  return { ok: true, revision: outcome.view.revision }
}
