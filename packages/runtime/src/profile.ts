import type {} from '@deepseek-ai/cordis'

export interface PluginProfileSnapshot {
  dependencies: Readonly<Record<string, string>>
  patchText: string
  modifiedAt: number | null
}

export interface PluginProfileDependencyChange {
  name: string
  spec?: string
}

export interface PluginProfileApplyResult {
  added: string[]
  removed: string[]
  failed: Array<{ name: string; error: string }>
  patchChanged: boolean
  needsRestart: boolean
}

/**
 * The single Host authority for the mutable web profile. Consumers never read
 * package.json/cordis.patch.yml or spawn the DSH CLI themselves.
 */
export interface PluginProfileManager {
  snapshot(): PluginProfileSnapshot
  reconcile(input: {
    dependencies: Readonly<Record<string, string>>
    patchText: string
  }): Promise<PluginProfileApplyResult>
  install(spec: string): Promise<{ detail: string; needsRestart: boolean }>
  remove(packageName: string): Promise<{ detail: string; needsRestart: boolean }>
  update(packageName: string): Promise<{ detail: string; needsRestart: boolean }>
  outdated(packageNames: readonly string[]): Promise<unknown>
  setDisabled(localId: string, entryId: string, disabled: boolean): Promise<{ live: boolean }>
  removeDisable(localId: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginProfile: PluginProfileManager
  }
}
