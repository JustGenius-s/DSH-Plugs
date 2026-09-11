import { describe, expect, it } from 'vitest'
import { agentCredentialKey, mcpToolName } from '../src/tool-name.ts'

describe('mcpToolName', () => {
  it('uses official mcp__server__tool shape', () => {
    expect(mcpToolName('supabase', 'list_tables')).toBe('mcp__supabase__list_tables')
  })

  it('sanitizes odd characters', () => {
    expect(mcpToolName('my server', 'tool.name')).toBe('mcp__my_server__tool_name')
  })
})

describe('agentCredentialKey', () => {
  it('namespaces secrets by plugin id', () => {
    expect(agentCredentialKey('supabase', 'access_token')).toBe('DSH_AGENT_SUPABASE_ACCESS_TOKEN')
  })
})
