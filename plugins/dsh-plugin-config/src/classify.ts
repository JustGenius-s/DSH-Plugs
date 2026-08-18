import type { PluginOrigin, PluginPlane } from './types.ts'

/** Host-plane rows the web surface cannot lose without going dark. */
export const PROTECTED_IDS = new Set([
  'api-gateway',
  'api-remotes',
  'client-runtime',
  'connection',
  'cordis-client-runner',
  'cordis-host-runner',
  'locale',
  'modules',
  'plugin-inventory',
  'ui-layout',
  'ui-settings',
  'ui-settings-general',
  'ui-settings-plugins',
  'ui-sidebar',
  'web-runtime',
  'web-startup',
  'webserver',
  'ui-settings-plugin-inventory',
])

/**
 * Agent-preset rows the web bundle parks on the host as disabled.
 * They belong to a session isolate, not the process-global tree.
 */
export const SESSION_PLANE_IDS = new Set([
  'agent-instructions',
  'command-compact',
  'compaction-basic',
  'plan-mode',
  'skill-filesystem',
  'tool-bash',
  'tool-fs',
  'tool-fs-search',
  'tool-goal',
  'tool-jobs',
  'tool-pwsh',
  'tool-ralph',
  'tool-result-pruner',
  'tool-skill',
  'tool-str-replace-editor',
  'tool-subagent',
  'tool-subagent-control',
  'tool-subagent-fork',
  'tool-subagent-list-agents',
  'tool-todo',
  'tool-web',
  'tool-workflow',
  'workflow-worker-thread',
])

const MARKETPLACE_SCOPES = ['@just-genius/']

export function moduleShortName(moduleName: string): string {
  const trimmed = moduleName.replace(/^cordis:/, '')
  return (trimmed.startsWith('@') ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed)
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

export function isBuiltinModule(moduleName: string): boolean {
  return moduleName.startsWith('@deepseek-ai/') || moduleName.startsWith('cordis:')
}

export function isMarketplacePackage(packageName: string | null, catalogNames: Set<string>): boolean {
  if (!packageName) return false
  const lower = packageName.toLowerCase()
  if (catalogNames.has(lower)) return true
  return MARKETPLACE_SCOPES.some((scope) => lower.startsWith(scope))
}

export function classifyOrigin(
  moduleName: string,
  packageName: string | null,
  catalogNames: Set<string>,
): PluginOrigin {
  if (isBuiltinModule(moduleName) || (packageName !== null && isBuiltinModule(packageName))) {
    return 'builtin'
  }
  if (isMarketplacePackage(packageName, catalogNames) || isMarketplacePackage(moduleName, catalogNames)) {
    return 'marketplace'
  }
  return 'external'
}

export function classifyPlane(input: {
  localId: string
  isolate: boolean
  ancestorIsolate: boolean
}): PluginPlane {
  if (input.isolate || input.ancestorIsolate) return 'session'
  if (SESSION_PLANE_IDS.has(input.localId)) return 'session'
  return 'global'
}

export function localEntryId(entryId: string): string {
  const sep = entryId.lastIndexOf(':')
  return sep >= 0 ? entryId.slice(sep + 1) : entryId
}
