/** Agent-pack HTTP routes hosted by dsh-plugin-config. */
export const AGENT_CATALOG_PATH = '/dsh-plugin-config/agent/catalog'
export const AGENT_INSTALLED_PATH = '/dsh-plugin-config/agent/installed'
export const AGENT_INSTALL_PATH = '/dsh-plugin-config/agent/install'
export const AGENT_ACTION_PATH = '/dsh-plugin-config/agent/action'
export const AGENT_CONFIGURE_PATH = '/dsh-plugin-config/agent/configure'
export const AGENT_AUTH_PATH = '/dsh-plugin-config/agent/auth'
export const AGENT_OAUTH_START_PATH = '/dsh-plugin-config/agent/oauth/start'
export const AGENT_OAUTH_CALLBACK_PATH = '/dsh-plugin-config/agent/oauth/callback'
export const AGENT_OAUTH_STATUS_PATH = '/dsh-plugin-config/agent/oauth/status'

export type AgentPackAction = 'enable' | 'disable' | 'uninstall'

export interface AgentActionRequest {
  action: AgentPackAction
  pluginId: string
}

export interface AgentConfigureRequest {
  pluginId: string
  variables: Record<string, string | boolean | number>
}

export interface AgentAuthRequest {
  pluginId: string
  /** oauth: access token; headers: map of headerSecrets → values */
  token?: string
  secrets?: Record<string, string>
  logout?: boolean
}

export interface AgentOpResult {
  ok: boolean
  pluginId?: string
  needsRestart?: boolean
  error?: string
  detail?: string
}

export type AgentOAuthPhase = 'idle' | 'pending' | 'ok' | 'error'

export interface AgentOAuthStartResult {
  ok: boolean
  authorizeUrl?: string
  error?: string
}

export interface AgentOAuthStatusResult {
  ok: boolean
  status: AgentOAuthPhase
  error?: string
}
