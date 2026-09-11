export type {
  AgentAuthKind,
  AgentCatalogEntry,
  AgentConnectionStatus,
  AgentInstalledEntry,
  AgentInstalledRecord,
  AgentMcpConfig,
  AgentMcpServerConfig,
  AgentPackSnapshot,
  AgentPluginManifest,
  AgentPluginStateFile,
  AgentSkillFile,
  AgentVariableSpec,
  AgentVariableType,
  AgentVariableView,
  UninstallCleanupReport,
} from './types.ts'

export {
  ManifestValidationError,
  parseManifest,
  parseMcpConfig,
} from './validate.ts'

export {
  hasUnresolvedPlaceholders,
  substituteDeep,
  substituteVariables,
} from './substitute.ts'

export {
  agentCredentialKey,
  mcpToolName,
} from './tool-name.ts'

export {
  agentInstalledDir,
  agentPluginsRoot,
  agentStatePath,
  dshHome,
  emptyAgentState,
} from './paths.ts'

export {
  createInstalledRecord,
  disableInState,
  enableInState,
  parseStateFile,
  removeFromState,
  setConnectionStatus,
  setVariables,
  summarizeUninstallCleanup,
} from './lifecycle.ts'

export {
  McpHttpClient,
  McpHttpError,
  parseMcpResponseBody,
  type McpHttpClientOptions,
  type McpToolDescriptor,
} from './mcp-http.ts'

export {
  jsonSchemaToToolParameters,
  resolveToolArguments,
  type ToolParameterSpec,
} from './schema-convert.ts'

export {
  parseSkillMarkdown,
  type ParsedSkillMarkdown,
} from './skill.ts'

export {
  applyVariablesToMcp,
  defaultVariables,
  installPackFromCatalog,
  listCatalogIds,
  loadCatalogPack,
  loadInstalledPack,
  readAgentState,
  uninstallPackFiles,
  writeAgentState,
} from './install.ts'

export {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  discoverMcpOAuth,
  exchangeAuthorizationCode,
  oauthResourceUrl,
  parseResourceMetadataUrl,
  probeMcpWwwAuthenticate,
  refreshAccessToken,
  registerOAuthClient,
  wellKnownProtectedResourceUrl,
  type McpOAuthDiscovery,
  type OAuthTokenSet,
  type PkcePair,
  type RegisteredOAuthClient,
} from './oauth.ts'
