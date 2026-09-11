/** MCP tool registration name: mcp__<server>__<tool> (official client style). */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverId)}__${sanitizeSegment(toolName)}`
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** Credential ref for an agent pack secret. */
export function agentCredentialKey(pluginId: string, secret: string): string {
  const id = pluginId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const name = secret.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return `DSH_AGENT_${id}_${name}`
}
