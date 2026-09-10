import type {
  AgentAuthKind,
  AgentMcpConfig,
  AgentPluginManifest,
  AgentVariableSpec,
} from './types.ts'

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManifestValidationError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function parseAuth(value: unknown): AgentAuthKind {
  if (value === 'oauth' || value === 'headers' || value === 'none') return value
  throw new ManifestValidationError('auth must be oauth | headers | none')
}

function parseVariable(name: string, value: unknown): AgentVariableSpec {
  if (!isRecord(value)) {
    throw new ManifestValidationError(`variables.${name} must be an object`)
  }
  const type = value.type
  if (type !== 'string' && type !== 'boolean' && type !== 'number') {
    throw new ManifestValidationError(`variables.${name}.type must be string | boolean | number`)
  }
  const spec: AgentVariableSpec = { type }
  if (typeof value.description === 'string') spec.description = value.description
  if (isRecord(value.label)) {
    const en = typeof value.label.en === 'string' ? value.label.en.trim() : ''
    const zh = typeof value.label.zh === 'string' ? value.label.zh.trim() : ''
    if (en !== '' || zh !== '') spec.label = { ...(en !== '' ? { en } : {}), ...(zh !== '' ? { zh } : {}) }
  }
  if (typeof value.required === 'boolean') spec.required = value.required
  if (value.default !== undefined) {
    if (typeof value.default !== type) {
      throw new ManifestValidationError(`variables.${name}.default must be ${type}`)
    }
    spec.default = value.default as string | boolean | number
  }
  return spec
}

/** Validate and normalize a raw plugin.json document. */
export function parseManifest(raw: unknown): AgentPluginManifest {
  if (!isRecord(raw)) throw new ManifestValidationError('plugin.json must be an object')

  const manifest: AgentPluginManifest = {
    name: asString(raw.name, 'name'),
    version: asString(raw.version, 'version'),
    description: asString(raw.description, 'description'),
    auth: parseAuth(raw.auth),
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name)) {
    throw new ManifestValidationError('name must be kebab-case ([a-z0-9-]+)')
  }

  if (isRecord(raw.displayName)) {
    manifest.displayName = {
      en: typeof raw.displayName.en === 'string' ? raw.displayName.en : undefined,
      zh: typeof raw.displayName.zh === 'string' ? raw.displayName.zh : undefined,
    }
  }

  if (Array.isArray(raw.keywords)) {
    manifest.keywords = raw.keywords.filter((item): item is string => typeof item === 'string')
  }

  if (typeof raw.logo === 'string') manifest.logo = raw.logo
  if (typeof raw.comingSoon === 'boolean') manifest.comingSoon = raw.comingSoon

  if (Array.isArray(raw.headerSecrets)) {
    manifest.headerSecrets = raw.headerSecrets.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
  }

  if (raw.variables !== undefined) {
    if (!isRecord(raw.variables)) {
      throw new ManifestValidationError('variables must be an object')
    }
    const variables: Record<string, AgentVariableSpec> = {}
    for (const [key, value] of Object.entries(raw.variables)) {
      variables[key] = parseVariable(key, value)
    }
    manifest.variables = variables
  }

  if (manifest.auth === 'headers' && (manifest.headerSecrets?.length ?? 0) === 0) {
    throw new ManifestValidationError('auth=headers requires headerSecrets')
  }

  return manifest
}

/** Validate mcp.json: every entry must be an HTTP server with a url. */
export function parseMcpConfig(raw: unknown): AgentMcpConfig {
  if (!isRecord(raw)) throw new ManifestValidationError('mcp.json must be an object')
  const config: AgentMcpConfig = {}
  for (const [serverId, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverId)) {
      throw new ManifestValidationError(`mcp server id "${serverId}" is invalid`)
    }
    if (!isRecord(value)) {
      throw new ManifestValidationError(`mcp.${serverId} must be an object`)
    }
    if (value.type !== 'http') {
      throw new ManifestValidationError(`mcp.${serverId}.type must be "http"`)
    }
    const url = asString(value.url, `mcp.${serverId}.url`)
    const headers: Record<string, string> = {}
    if (value.headers !== undefined) {
      if (!isRecord(value.headers)) {
        throw new ManifestValidationError(`mcp.${serverId}.headers must be an object`)
      }
      for (const [header, headerValue] of Object.entries(value.headers)) {
        if (typeof headerValue !== 'string') {
          throw new ManifestValidationError(`mcp.${serverId}.headers.${header} must be a string`)
        }
        headers[header] = headerValue
      }
    }
    config[serverId] = { type: 'http', url, headers }
  }
  if (Object.keys(config).length === 0) {
    throw new ManifestValidationError('mcp.json must declare at least one server')
  }
  return config
}
