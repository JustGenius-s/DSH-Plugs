import type {
  AgentInstalledRecord,
  AgentPluginStateFile,
  UninstallCleanupReport,
} from './types.ts'
import { emptyAgentState } from './paths.ts'

export function createInstalledRecord(
  variables: Record<string, string | boolean | number> = {},
  now = new Date(),
): AgentInstalledRecord {
  return {
    enabled: false,
    variables: { ...variables },
    installedAt: now.toISOString(),
    connection: { status: 'idle' },
  }
}

/** Pure state transition: mark enabled. Does not touch runtime. */
export function enableInState(
  state: AgentPluginStateFile,
  pluginId: string,
): AgentPluginStateFile {
  const current = state.plugins[pluginId]
  if (current === undefined) {
    throw new Error(`agent plugin "${pluginId}" is not installed`)
  }
  return {
    ...state,
    plugins: {
      ...state.plugins,
      [pluginId]: {
        ...current,
        enabled: true,
        connection: { status: 'idle' },
      },
    },
  }
}

/** Pure state transition: mark disabled; keep variables. */
export function disableInState(
  state: AgentPluginStateFile,
  pluginId: string,
): AgentPluginStateFile {
  const current = state.plugins[pluginId]
  if (current === undefined) {
    throw new Error(`agent plugin "${pluginId}" is not installed`)
  }
  return {
    ...state,
    plugins: {
      ...state.plugins,
      [pluginId]: {
        ...current,
        enabled: false,
        connection: { status: 'idle' },
      },
    },
  }
}

/** Pure state transition: drop the plugin entry entirely. */
export function removeFromState(
  state: AgentPluginStateFile,
  pluginId: string,
): AgentPluginStateFile {
  if (state.plugins[pluginId] === undefined) return state
  const plugins = { ...state.plugins }
  delete plugins[pluginId]
  return { ...state, plugins }
}

export function setConnectionStatus(
  state: AgentPluginStateFile,
  pluginId: string,
  connection: AgentInstalledRecord['connection'],
): AgentPluginStateFile {
  const current = state.plugins[pluginId]
  if (current === undefined) return state
  return {
    ...state,
    plugins: {
      ...state.plugins,
      [pluginId]: { ...current, connection },
    },
  }
}

export function setVariables(
  state: AgentPluginStateFile,
  pluginId: string,
  variables: Record<string, string | boolean | number>,
): AgentPluginStateFile {
  const current = state.plugins[pluginId]
  if (current === undefined) {
    throw new Error(`agent plugin "${pluginId}" is not installed`)
  }
  return {
    ...state,
    plugins: {
      ...state.plugins,
      [pluginId]: {
        ...current,
        variables: { ...current.variables, ...variables },
      },
    },
  }
}

/**
 * Compute the uninstall cleanup checklist outcome from boolean flags.
 * Order is always: detach → dir → state → credentials.
 */
export function summarizeUninstallCleanup(flags: {
  runtimeDetached: boolean
  directoryRemoved: boolean
  stateRemoved: boolean
  credentialsCleared: boolean
  failures?: string[]
}): UninstallCleanupReport {
  return {
    runtimeDetached: flags.runtimeDetached,
    directoryRemoved: flags.directoryRemoved,
    stateRemoved: flags.stateRemoved,
    credentialsCleared: flags.credentialsCleared,
    failures: flags.failures ?? [],
  }
}

export function parseStateFile(raw: unknown): AgentPluginStateFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyAgentState()
  }
  const value = raw as { version?: unknown; plugins?: unknown }
  if (value.version !== 1 || value.plugins === null || typeof value.plugins !== 'object') {
    return emptyAgentState()
  }
  const plugins: AgentPluginStateFile['plugins'] = {}
  for (const [id, entry] of Object.entries(value.plugins as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    plugins[id] = {
      enabled: row.enabled === true,
      variables: isVariableMap(row.variables) ? row.variables : {},
      installedAt: typeof row.installedAt === 'string' ? row.installedAt : new Date(0).toISOString(),
      connection: parseConnection(row.connection),
    }
  }
  return { version: 1, plugins }
}

function isVariableMap(value: unknown): value is Record<string, string | boolean | number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (item) => typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number',
  )
}

function parseConnection(value: unknown): AgentInstalledRecord['connection'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'idle' }
  }
  const row = value as Record<string, unknown>
  const status = row.status
  if (
    status !== 'idle'
    && status !== 'connected'
    && status !== 'error'
    && status !== 'needs_auth'
  ) {
    return { status: 'idle' }
  }
  return {
    status,
    error: typeof row.error === 'string' ? row.error : undefined,
    toolCount: typeof row.toolCount === 'number' ? row.toolCount : undefined,
  }
}
