/**
 * Settings-section registration against the DSH 0.1.2 settings API.
 *
 * 0.1.2 reshaped `@deepseek-ai/dsh-settings`: registration moved onto the
 * `SettingsProvider` service as `register(ns, schema, options)`, namespace
 * strings became a branded type validated structurally at the call site, and
 * the old `installSettingsSection` helper was removed. These two shims keep
 * every plugin's registration call site unchanged while routing through the
 * new API.
 */
import type { Context } from '@deepseek-ai/cordis'
import type SchemaType from '@deepseek-ai/schemastery'
import type {
  SettingsNamespace,
  SettingsRegisterOptions,
  SettingsScope,
} from '@deepseek-ai/dsh-settings'

/**
 * Brand a namespace string for the settings service.
 *
 * 0.1.2 validates namespaces structurally (`SettingsNamespaceInput`) instead
 * of through a constructor, so this is a pure cast: the runtime stores the
 * same string the caller passed.
 *
 * @param ns - dot-separated namespace, e.g. `plugin.desktop-update`.
 * @returns the namespace as the branded settings type.
 */
export function settingsNamespace<T extends string>(ns: T): T & SettingsNamespace {
  return ns as T & SettingsNamespace
}

/** What a plugin hands to {@link installSettingsSection}. */
export interface InstallSettingsSectionOptions<T> {
  /** Replace the getter the section reads its live value from. */
  setSource?: ((source: () => T) => void) | undefined
  /** Invoked after the resolved section changes. */
  onChange?: ((value: T) => void) | undefined
  /** Composition-layer values resolved below the user layer. */
  base?: Partial<T> | undefined
  /** Owner's effect timing; defaults to `live`. */
  applies?: SettingsRegisterOptions<T>['applies'] | undefined
}

/**
 * Register a settings namespace and keep a plugin's config in step with it.
 *
 * Wraps `ctx.settings.register` (which needs the `settings` service) and wires
 * the returned scope's watcher to the caller's source/onChange pair, so a
 * plugin keeps one code path for "read my config" across DSH versions.
 *
 * @param ctx - host context; injects `settings` on the caller's behalf.
 * @param ns - namespace to own.
 * @param schema - schemastery-compatible schema for the section.
 * @param initial - value used before the scope reports its first resolve.
 * @param options - source/onChange wiring plus registration options.
 * @returns a disposer unregistering the section.
 */
export function installSettingsSection<T>(
  ctx: Context,
  ns: string,
  /**
   * The schemastery schema for this section. Plugins build one from the
   * `Schema` re-exported by `@just-genius/dsh-plugin-runtime/host`.
   */
  schema: SchemaType<T>,
  initial: T,
  options: InstallSettingsSectionOptions<T> = {},
): () => void {
  let current = initial
  let dispose: (() => void) | undefined

  ctx.inject(['settings'], (sctx) => {
    const injected = sctx as Context & {
      settings: {
        register<N extends string, V>(
          ns: N & SettingsNamespace,
          schema: unknown,
          options?: SettingsRegisterOptions<V>,
        ): SettingsScope<V>
      }
    }
    const scope = injected.settings.register<string, T>(
      settingsNamespace(ns),
      schema,
      {
        ...(options.base === undefined ? {} : { base: options.base }),
        ...(options.applies === undefined ? {} : { applies: options.applies }),
      },
    )
    options.setSource?.(() => current)
    current = scope.get()
    const stop = scope.watch((next) => {
      current = next
      options.onChange?.(next)
    })
    dispose = () => {
      stop()
    }
  })

  return () => {
    dispose?.()
    dispose = undefined
  }
}
