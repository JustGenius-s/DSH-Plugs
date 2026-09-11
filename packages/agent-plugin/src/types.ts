/** Agent capability-pack manifest and runtime state types. */

export type AgentAuthKind = 'oauth' | 'headers' | 'none'

export type AgentVariableType = 'string' | 'boolean' | 'number'

export interface AgentVariableSpec {
  type: AgentVariableType
  description?: string
  label?: { en?: string; zh?: string }
  required?: boolean
  default?: string | boolean | number
}

export interface AgentPluginManifest {
  name: string
  version: string
  description: string
  displayName?: { en?: string; zh?: string }
  keywords?: string[]
  logo?: string
  auth: AgentAuthKind
  /** Header names used when auth === 'headers' (values come from credentials). */
  headerSecrets?: string[]
  variables?: Record<string, AgentVariableSpec>
  comingSoon?: boolean
}

export interface AgentMcpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

/** Map of server id → HTTP MCP endpoint. */
export type AgentMcpConfig = Record<string, AgentMcpServerConfig>

export interface AgentSkillFile {
  name: string
  description: string
  body: string
  relativePath: string
}

export interface AgentPackSnapshot {
  manifest: AgentPluginManifest
  mcp: AgentMcpConfig
  skills: AgentSkillFile[]
  rootDir: string
}

export type AgentConnectionStatus =
  | 'idle'
  | 'connected'
  | 'error'
  | 'needs_auth'

export interface AgentInstalledRecord {
  enabled: boolean
  variables: Record<string, string | boolean | number>
  installedAt: string
  connection: {
    status: AgentConnectionStatus
    error?: string
    toolCount?: number
  }
}

export interface AgentPluginStateFile {
  version: 1
  plugins: Record<string, AgentInstalledRecord>
}

export interface AgentCatalogEntry {
  name: string
  version: string
  description: string
  displayName: { en: string; zh: string }
  auth: AgentAuthKind
  comingSoon: boolean
  keywords: string[]
  installed: boolean
  enabled: boolean
  connectionStatus: AgentConnectionStatus | null
  hasAuth: boolean
}

export interface AgentVariableView {
  type: AgentVariableType
  required: boolean
  label: { en: string; zh: string }
}

export interface AgentInstalledEntry extends AgentCatalogEntry {
  variables: Record<string, string | boolean | number>
  variableSpecs: Record<string, AgentVariableView>
  headerSecrets: string[]
  installedAt: string
  connectionError?: string
  toolCount?: number
}

export interface UninstallCleanupReport {
  runtimeDetached: boolean
  directoryRemoved: boolean
  stateRemoved: boolean
  credentialsCleared: boolean
  failures: string[]
}
