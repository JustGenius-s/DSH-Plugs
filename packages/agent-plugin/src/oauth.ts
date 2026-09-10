import { createHash, randomBytes } from 'node:crypto'

export interface ProtectedResourceMetadata {
  resource: string
  authorizationServers: string[]
  scopesSupported: string[]
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  codeChallengeMethodsSupported: string[]
}

export interface RegisteredOAuthClient {
  clientId: string
  clientSecret?: string
}

export interface OAuthTokenSet {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  tokenType: string
}

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

export interface McpOAuthDiscovery {
  resource: string
  scopes: string[]
  authorizationServer: AuthorizationServerMetadata
}

/** Canonical MCP resource URL: drop unresolved ${VAR} query params. */
export function oauthResourceUrl(mcpUrl: string): string {
  const cleaned = mcpUrl.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')
  try {
    const url = new URL(cleaned)
    for (const [key, value] of [...url.searchParams.entries()]) {
      if (value.trim() === '') url.searchParams.delete(key)
    }
    const query = url.searchParams.toString()
    return query === '' ? `${url.origin}${url.pathname}` : `${url.origin}${url.pathname}?${query}`
  } catch {
    return cleaned.split('?')[0] ?? cleaned
  }
}

/**
 * RFC 9728 well-known insertion:
 * https://host/mcp → https://host/.well-known/oauth-protected-resource/mcp
 */
export function wellKnownProtectedResourceUrl(resourceUrl: string): string {
  const url = new URL(oauthResourceUrl(resourceUrl))
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = `/.well-known/oauth-protected-resource${path}`
  url.search = ''
  return url.toString()
}

export function wellKnownAuthorizationServerUrl(issuer: string): string {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path === '' || path === '/'
    ? '/.well-known/oauth-authorization-server'
    : `/.well-known/oauth-authorization-server${path}`
  url.search = ''
  return url.toString()
}

/** Parse `resource_metadata="..."` from a WWW-Authenticate Bearer challenge. */
export function parseResourceMetadataUrl(wwwAuthenticate: string | null | undefined): string | null {
  if (!wwwAuthenticate) return null
  const match = /resource_metadata=(?:"([^"]+)"|([^\s,]+))/i.exec(wwwAuthenticate)
  const value = match?.[1] ?? match?.[2]
  return value && value.trim() !== '' ? value.trim() : null
}

export function createPkcePair(entropy: () => Uint8Array = defaultEntropy): PkcePair {
  const verifier = base64Url(entropy())
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

export function createOAuthState(entropy: () => Uint8Array = defaultEntropy): string {
  return base64Url(entropy())
}

export function buildAuthorizationUrl(options: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  state: string
  pkce: PkcePair
  resource: string
  scopes?: string[]
}): string {
  const url = new URL(options.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.pkce.challenge)
  url.searchParams.set('code_challenge_method', options.pkce.method)
  url.searchParams.set('resource', options.resource)
  if (options.scopes && options.scopes.length > 0) {
    url.searchParams.set('scope', options.scopes.join(' '))
  }
  return url.toString()
}

export function parseProtectedResourceMetadata(raw: unknown): ProtectedResourceMetadata {
  if (!isRecord(raw)) throw new Error('protected resource metadata must be an object')
  const resource = asString(raw.resource)
  if (resource === '') throw new Error('protected resource metadata is missing resource')
  const servers = Array.isArray(raw.authorization_servers)
    ? raw.authorization_servers.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
  if (servers.length === 0) {
    throw new Error('protected resource metadata is missing authorization_servers')
  }
  const scopes = Array.isArray(raw.scopes_supported)
    ? raw.scopes_supported.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
  return { resource, authorizationServers: servers, scopesSupported: scopes }
}

export function parseAuthorizationServerMetadata(raw: unknown): AuthorizationServerMetadata {
  if (!isRecord(raw)) throw new Error('authorization server metadata must be an object')
  const issuer = asString(raw.issuer)
  const authorizationEndpoint = asString(raw.authorization_endpoint)
  const tokenEndpoint = asString(raw.token_endpoint)
  if (issuer === '' || authorizationEndpoint === '' || tokenEndpoint === '') {
    throw new Error('authorization server metadata is missing issuer/authorization_endpoint/token_endpoint')
  }
  const methods = Array.isArray(raw.code_challenge_methods_supported)
    ? raw.code_challenge_methods_supported.filter((item): item is string => typeof item === 'string')
    : []
  if (methods.length > 0 && !methods.includes('S256')) {
    throw new Error('authorization server does not support PKCE S256')
  }
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: asString(raw.registration_endpoint) || undefined,
    codeChallengeMethodsSupported: methods.length > 0 ? methods : ['S256'],
  }
}

export function parseRegisteredClient(raw: unknown): RegisteredOAuthClient {
  if (!isRecord(raw)) throw new Error('client registration response must be an object')
  const clientId = asString(raw.client_id)
  if (clientId === '') throw new Error('client registration response is missing client_id')
  const clientSecret = asString(raw.client_secret)
  return { clientId, clientSecret: clientSecret === '' ? undefined : clientSecret }
}

export function parseTokenResponse(raw: unknown): OAuthTokenSet {
  if (!isRecord(raw)) throw new Error('token response must be an object')
  if (typeof raw.error === 'string' && raw.error !== '') {
    const description = asString(raw.error_description)
    throw new Error(description !== '' ? `${raw.error}: ${description}` : raw.error)
  }
  const accessToken = asString(raw.access_token)
  if (accessToken === '') throw new Error('token response is missing access_token')
  const refreshToken = asString(raw.refresh_token)
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : undefined
  return {
    accessToken,
    refreshToken: refreshToken === '' ? undefined : refreshToken,
    expiresIn,
    tokenType: asString(raw.token_type) || 'Bearer',
  }
}

export async function fetchJson(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    fetchImpl?: typeof fetch
  } = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
  })
  const text = await response.text()
  let parsed: unknown = {}
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      throw new Error(`OAuth ${url} returned non-JSON (${response.status})`)
    }
  }
  if (!response.ok) {
    if (isRecord(parsed) && typeof parsed.error === 'string') {
      const description = asString(parsed.error_description)
      throw new Error(description !== '' ? `${parsed.error}: ${description}` : parsed.error)
    }
    throw new Error(`OAuth ${url} failed (${response.status}): ${text.slice(0, 240)}`)
  }
  return parsed
}

export async function probeMcpWwwAuthenticate(
  mcpUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(oauthResourceUrl(mcpUrl), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    return response.headers.get('www-authenticate')
  } catch {
    return null
  }
}

export async function discoverMcpOAuth(
  mcpUrl: string,
  options: { fetchImpl?: typeof fetch; wwwAuthenticate?: string | null } = {},
): Promise<McpOAuthDiscovery> {
  const resourceHint = oauthResourceUrl(mcpUrl)
  const header = options.wwwAuthenticate
    ?? await probeMcpWwwAuthenticate(resourceHint, options.fetchImpl ?? fetch)
  const metadataUrl = parseResourceMetadataUrl(header)
    ?? wellKnownProtectedResourceUrl(resourceHint)
  const prm = parseProtectedResourceMetadata(await fetchJson(metadataUrl, { fetchImpl: options.fetchImpl }))
  const issuer = prm.authorizationServers[0]
  if (!issuer) throw new Error('no authorization server advertised')
  const as = parseAuthorizationServerMetadata(
    await fetchJson(wellKnownAuthorizationServerUrl(issuer), { fetchImpl: options.fetchImpl }),
  )
  return {
    resource: prm.resource || resourceHint,
    scopes: prm.scopesSupported,
    authorizationServer: as,
  }
}

export async function registerOAuthClient(options: {
  registrationEndpoint: string
  redirectUri: string
  clientName: string
  fetchImpl?: typeof fetch
}): Promise<RegisteredOAuthClient> {
  return parseRegisteredClient(await fetchJson(options.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: options.clientName,
      redirect_uris: [options.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
    fetchImpl: options.fetchImpl,
  }))
}

export async function exchangeAuthorizationCode(options: {
  tokenEndpoint: string
  code: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  codeVerifier: string
  resource: string
  fetchImpl?: typeof fetch
}): Promise<OAuthTokenSet> {
  return parseTokenResponse(await postToken(options.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    code_verifier: options.codeVerifier,
    resource: options.resource,
    ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
  }, options.fetchImpl))
}

export async function refreshAccessToken(options: {
  tokenEndpoint: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  resource: string
  fetchImpl?: typeof fetch
}): Promise<OAuthTokenSet> {
  return parseTokenResponse(await postToken(options.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
    client_id: options.clientId,
    resource: options.resource,
    ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
  }, options.fetchImpl))
}

async function postToken(
  tokenEndpoint: string,
  fields: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  return fetchJson(tokenEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
    fetchImpl,
  })
}

function defaultEntropy(): Uint8Array {
  return randomBytes(32)
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
