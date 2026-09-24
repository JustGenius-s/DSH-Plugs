/** Settings wiring for legacy namespaces and DSH 0.1.7 Config forms. */
import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import type {
  SettingsNamespace,
  SettingsRegisterOptions,
  SettingsScope,
} from '@deepseek-ai/dsh-settings'

export function settingsNamespace<T extends string>(ns: T): T & SettingsNamespace {
  return ns as T & SettingsNamespace
}

export interface InstallSettingsSectionOptions<T> {
  setSource?: (source: () => T) => void
  onChange?: (value: T) => void
  /** Read the plugin's Config reference on hosts with live configuration. */
  entrySource?: () => T
  base?: Partial<T>
  applies?: SettingsRegisterOptions<T>['applies']
  validate?: (value: T) => void
}

interface SettingsService {
  register?<T>(ns: SettingsNamespace, schema: Schema<T>, options: SettingsRegisterOptions<T>): SettingsScope<T>
  configure?(presentation: { auto: boolean }, owner: Context['fiber']): () => void
}

/**
 * Keep a custom settings page and its host features on the same live value.
 * New hosts project the plugin's exported volatile Config automatically;
 * legacy hosts still require register(), a base layer and a scope watcher.
 */
export function installSettingsSection<T>(
  ctx: Context,
  ns: string,
  schema: Schema<T>,
  initial: T,
  options: InstallSettingsSectionOptions<T> = {},
): () => void {
  const entrySource = options.entrySource ?? (() => initial)
  let source = entrySource
  let disposed = false
  const changed = (): void => {
    if (!disposed) options.onChange?.(source())
  }
  const useSource = (next: () => T): void => {
    source = next
    options.setSource?.(source)
    changed()
  }

  // Listen on the owning fiber: the loader sends this event only to that
  // instance, not to the child fiber created by optional service injection.
  const owner = ctx as Context & {
    on(name: 'loader/volatile-update', listener: () => void): () => void
  }
  const stopVolatile = owner.on('loader/volatile-update', changed)
  const attachment = ctx.inject(['settings'], (sctx) => {
    const settings = sctx.get('settings') as SettingsService
    if (typeof settings.register === 'function') {
      const scope = settings.register(settingsNamespace(ns), schema, {
        base: options.base ?? initial,
        ...(options.applies === undefined ? {} : { applies: options.applies }),
        ...(options.validate === undefined ? {} : { validate: options.validate }),
      })
      useSource(() => scope.get())
      const stop = scope.watch(changed)
      sctx.effect(() => () => {
        stop()
        if (!disposed && ctx.fiber.state < 3) useSource(entrySource)
      })
      return
    }

    if (typeof settings.configure !== 'function') throw new Error('Unsupported DSH settings service')
    useSource(entrySource)
    sctx.effect(() => settings.configure!({ auto: false }, ctx.fiber))
  })

  return () => {
    if (disposed) return
    disposed = true
    stopVolatile()
    void attachment.dispose()
  }
}
