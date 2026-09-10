import { describe, expect, it } from 'vitest'
import { parseManifest, parseMcpConfig, ManifestValidationError } from '../src/validate.ts'

describe('parseManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const manifest = parseManifest({
      name: 'supabase',
      version: '1.0.0',
      description: 'Supabase MCP',
      auth: 'oauth',
    })
    expect(manifest.name).toBe('supabase')
    expect(manifest.auth).toBe('oauth')
  })

  it('rejects non-kebab names', () => {
    expect(() => parseManifest({
      name: 'Supabase',
      version: '1.0.0',
      description: 'x',
      auth: 'none',
    })).toThrow(ManifestValidationError)
  })

  it('keeps localized variable labels', () => {
    const manifest = parseManifest({
      name: 'supabase',
      version: '1.0.0',
      description: 'x',
      auth: 'oauth',
      variables: {
        read_only: {
          type: 'boolean',
          label: { zh: '只读', en: 'Read only' },
          default: true,
        },
      },
    })
    expect(manifest.variables?.read_only?.label).toEqual({ zh: '只读', en: 'Read only' })
  })

  it('requires headerSecrets when auth is headers', () => {
    expect(() => parseManifest({
      name: 'cloudbase',
      version: '1.0.0',
      description: 'x',
      auth: 'headers',
    })).toThrow(/headerSecrets/)
  })
})

describe('parseMcpConfig', () => {
  it('accepts http servers', () => {
    const config = parseMcpConfig({
      supabase: {
        type: 'http',
        url: 'https://mcp.supabase.com/mcp',
        headers: { 'X-Source': 'dsh' },
      },
    })
    expect(config.supabase.url).toContain('supabase')
  })

  it('rejects empty mcp configs', () => {
    expect(() => parseMcpConfig({})).toThrow(/at least one/)
  })
})
