import type {
  SettingsScope,
  SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  CODEX_CONFIG_FIELDS,
  DEFAULT_CONFIG,
  parseCodexConfig,
  SETTINGS_PATH,
  type CodexConfigField,
  type DshCodexConfig,
} from '../../shared/config'

interface SettingsWire {
  ok?: unknown
  value?: unknown
}

/**
 * Browser mirror of the Codex section that talks to the plugin's own HTTP
 * route instead of the Host settings RPC (which refuses `dsh-codex`).
 */
export function createCodexSettingsStore(): SettingsScope<DshCodexConfig> {
  let snapshot: SettingsScopeSnapshot<DshCodexConfig> = {
    status: 'loading',
    value: undefined,
    base: DEFAULT_CONFIG,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'memory',
  }
  const listeners = new Set<() => void>()
  let writes = Promise.resolve()

  const publish = (next: SettingsScopeSnapshot<DshCodexConfig>): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const ready = (value: DshCodexConfig): SettingsScopeSnapshot<DshCodexConfig> => ({
    status: 'ready',
    value,
    base: DEFAULT_CONFIG,
    user: value,
    revision: (snapshot.revision ?? 0) + 1,
    writable: true,
    mode: 'host',
  })

  const unavailable = (
    value: DshCodexConfig,
  ): SettingsScopeSnapshot<DshCodexConfig> => ({
    status: 'unavailable',
    value,
    base: DEFAULT_CONFIG,
    user: undefined,
    revision: snapshot.revision,
    writable: false,
    mode: 'memory',
  })

  const reload = async (): Promise<void> => {
    try {
      publish(ready(await fetchCodexSettings()))
    } catch {
      publish(unavailable(snapshot.value ?? DEFAULT_CONFIG))
    }
  }

  const set = (field: string, value: unknown): Promise<void> => {
    if (!isConfigField(field)) return Promise.resolve()
    const run = writes.then(async () => {
      const current = snapshot.value ?? DEFAULT_CONFIG
      const optimistic = { ...current, [field]: value } as DshCodexConfig
      publish(ready(optimistic))
      try {
        publish(ready(await patchCodexSettings({ [field]: value })))
      } catch {
        await reload()
      }
    })
    writes = run.then(() => undefined, () => undefined)
    return run
  }

  void reload()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset: (field) => {
      if (!isConfigField(field)) return Promise.resolve()
      return set(field, DEFAULT_CONFIG[field])
    },
  }
}

function isConfigField(field: string): field is CodexConfigField {
  return (CODEX_CONFIG_FIELDS as readonly string[]).includes(field)
}

async function fetchCodexSettings(): Promise<DshCodexConfig> {
  const response = await fetch(SETTINGS_PATH, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  return readSettingsBody(response)
}

async function patchCodexSettings(
  patch: Partial<DshCodexConfig>,
): Promise<DshCodexConfig> {
  const response = await fetch(SETTINGS_PATH, {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(patch),
  })
  return readSettingsBody(response)
}

async function readSettingsBody(response: Response): Promise<DshCodexConfig> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) {
    throw new Error('invalid settings response')
  }
  const wire = body as SettingsWire
  if (wire.ok !== true || !response.ok) {
    throw new Error('settings request failed')
  }
  const parsed = parseCodexConfig(wire.value)
  if (parsed === undefined) throw new Error('invalid settings value')
  return parsed
}
