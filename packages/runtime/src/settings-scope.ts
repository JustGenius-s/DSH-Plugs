import type { Context } from '@deepseek-ai/cordis'
import type {
  SettingsScope,
  SettingsScopeSnapshot,
  SettingsScopeSpec as LegacySettingsScopeSpec,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'

export interface SettingsScopeSpec<T> extends LegacySettingsScopeSpec<T> {
  /** Host entry id when configForms replaced a legacy settings namespace. */
  entryId?: string
}

/** The plugin-facing settings contract across the 0.1.7 service rename. */
export interface SettingsScopeBinder {
  describe(): SettingsDescribeFace
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
}

interface ConfigForm<T> extends Pick<SettingsScope<T>, 'getSnapshot' | 'subscribe'> {
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

interface ConfigForms {
  describe(): SettingsDescribeFace
  get<T>(namespace: string): ConfigForm<T>
}

type SettingsContext = Pick<Context, 'get' | 'effect'>

/**
 * Callers inject settingsSchema: both settings providers publish it together
 * with their transport, so neither version waits for a removed service name.
 * ctx.get resolves the version-specific service without a property injection.
 */
export function getSettingsScope(ctx: SettingsContext): SettingsScopeBinder {
  const forms = ctx.get('configForms') as ConfigForms | undefined
  if (forms !== undefined) {
    return {
      describe: () => forms.describe(),
      bind: <T>(spec: SettingsScopeSpec<T>) => bindForm(ctx, forms.get<T>(spec.entryId ?? spec.namespace), spec),
    }
  }
  const legacy = ctx.get('settingsScope') as SettingsScopeBinder | undefined
  if (legacy !== undefined) return legacy
  throw new Error('Settings service is unavailable (expected configForms or settingsScope)')
}

function bindForm<T>(
  ctx: SettingsContext,
  form: ConfigForm<T>,
  spec: SettingsScopeSpec<T>,
): SettingsScope<T> {
  let previous: SettingsScopeSnapshot<T> | undefined
  let decoded: SettingsScopeSnapshot<T> | undefined
  let disposed = false
  const subscriptions = new Set<() => void>()
  // Forms belong to the provider in 0.1.7. Release only this consumer's
  // subscriptions; another plugin may still be using the same shared form.
  ctx.effect(() => () => {
    disposed = true
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.clear()
  }, 'settings: bound form subscriptions')

  return {
    getSnapshot() {
      const snapshot = form.getSnapshot()
      if (spec.decode === undefined) return snapshot
      if (snapshot !== previous) {
        const value = snapshot.value === undefined ? undefined : spec.decode(snapshot.value)
        decoded = {
          ...snapshot,
          value: value === undefined ? decoded?.value : value,
          status: snapshot.status === 'ready' && value === undefined
            ? decoded?.status ?? 'loading'
            : snapshot.status,
        }
        previous = snapshot
      }
      return decoded!
    },
    subscribe(listener) {
      if (disposed) return () => {}
      const stop = form.subscribe(listener)
      const unsubscribe = () => {
        if (subscriptions.delete(unsubscribe)) stop()
      }
      subscriptions.add(unsubscribe)
      return unsubscribe
    },
    async set(field, value) {
      if (!disposed) await form.set(field, value)
    },
    async unset(field) {
      if (!disposed) await form.unset(field)
    },
  }
}
