import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationUrl,
  createPkcePair,
  discoverMcpOAuth,
  oauthResourceUrl,
  parseAuthorizationServerMetadata,
  parseProtectedResourceMetadata,
  parseRegisteredClient,
  parseResourceMetadataUrl,
  parseTokenResponse,
  wellKnownAuthorizationServerUrl,
  wellKnownProtectedResourceUrl,
} from '../src/oauth.ts'

describe('oauth discovery urls', () => {
  it('strips unresolved query placeholders from the resource URL', () => {
    expect(
      oauthResourceUrl('https://mcp.supabase.com/mcp?project_ref=${project_ref}&read_only=${read_only}'),
    ).toBe('https://mcp.supabase.com/mcp')
  })

  it('keeps resolved query parameters', () => {
    expect(oauthResourceUrl('https://mcp.supabase.com/mcp?read_only=true')).toBe(
      'https://mcp.supabase.com/mcp?read_only=true',
    )
  })

  it('inserts RFC 9728 well-known path', () => {
    expect(wellKnownProtectedResourceUrl('https://mcp.supabase.com/mcp')).toBe(
      'https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp',
    )
  })

  it('builds AS metadata URL from issuer', () => {
    expect(wellKnownAuthorizationServerUrl('https://api.supabase.com')).toBe(
      'https://api.supabase.com/.well-known/oauth-authorization-server',
    )
  })
})

describe('WWW-Authenticate parsing', () => {
  it('reads quoted resource_metadata', () => {
    expect(parseResourceMetadataUrl(
      'Bearer error="invalid_request", resource_metadata="https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp"',
    )).toBe('https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp')
  })

  it('returns null when the header is missing', () => {
    expect(parseResourceMetadataUrl(null)).toBeNull()
  })
})

describe('PKCE and authorize URL', () => {
  it('creates S256 challenge from injected entropy', () => {
    const pair = createPkcePair(() => new Uint8Array(32).fill(7))
    expect(pair.method).toBe('S256')
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.challenge).not.toBe(pair.verifier)
  })

  it('builds an authorization-code URL with resource and PKCE', () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
      clientId: 'client-1',
      redirectUri: 'http://127.0.0.1:18789/dsh-plugin-config/agent/oauth/callback',
      state: 'abc',
      pkce: { verifier: 'v', challenge: 'c', method: 'S256' },
      resource: 'https://mcp.supabase.com/mcp',
      scopes: ['organizations:read', 'projects:read'],
    }))
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('resource')).toBe('https://mcp.supabase.com/mcp')
    expect(url.searchParams.get('scope')).toBe('organizations:read projects:read')
  })
})

describe('metadata parsers', () => {
  it('parses protected resource metadata', () => {
    const parsed = parseProtectedResourceMetadata({
      resource: 'https://mcp.supabase.com/mcp',
      authorization_servers: ['https://api.supabase.com'],
      scopes_supported: ['organizations:read'],
    })
    expect(parsed.authorizationServers).toEqual(['https://api.supabase.com'])
  })

  it('parses authorization server metadata', () => {
    const parsed = parseAuthorizationServerMetadata({
      issuer: 'https://api.supabase.com',
      authorization_endpoint: 'https://api.supabase.com/v1/oauth/authorize',
      token_endpoint: 'https://api.supabase.com/v1/oauth/token',
      registration_endpoint: 'https://api.supabase.com/platform/oauth/apps/register',
      code_challenge_methods_supported: ['S256'],
    })
    expect(parsed.registrationEndpoint).toContain('/register')
  })

  it('parses registration and token responses', () => {
    expect(parseRegisteredClient({ client_id: 'id', client_secret: 'secret' })).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    })
    expect(parseTokenResponse({
      access_token: 'tok',
      refresh_token: 'ref',
      token_type: 'bearer',
      expires_in: 3600,
    }).accessToken).toBe('tok')
  })

  it('discovers MCP OAuth from a 401 WWW-Authenticate header', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://mcp.supabase.com/mcp') {
        return new Response('unauthorized', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer resource_metadata="https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp"',
          },
        })
      }
      if (url.includes('oauth-protected-resource')) {
        return Response.json({
          resource: 'https://mcp.supabase.com/mcp',
          authorization_servers: ['https://api.supabase.com'],
          scopes_supported: ['organizations:read'],
        })
      }
      if (url.includes('oauth-authorization-server')) {
        return Response.json({
          issuer: 'https://api.supabase.com',
          authorization_endpoint: 'https://api.supabase.com/v1/oauth/authorize',
          token_endpoint: 'https://api.supabase.com/v1/oauth/token',
          registration_endpoint: 'https://api.supabase.com/platform/oauth/apps/register',
          code_challenge_methods_supported: ['S256'],
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const discovered = await discoverMcpOAuth('https://mcp.supabase.com/mcp?project_ref=${project_ref}', { fetchImpl })
    expect(discovered.resource).toBe('https://mcp.supabase.com/mcp')
    expect(discovered.authorizationServer.tokenEndpoint).toContain('/oauth/token')
  })

  it('surfaces OAuth error payloads', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant', error_description: 'bad code' }))
      .toThrow('invalid_grant: bad code')
  })
})
