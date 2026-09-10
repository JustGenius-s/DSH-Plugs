import { describe, expect, it } from 'vitest'
import { applyVariablesToMcp } from '../src/install.ts'
import {
  hasUnresolvedPlaceholders,
  substituteDeep,
  substituteVariables,
} from '../src/substitute.ts'

describe('substituteVariables', () => {
  it('replaces known placeholders', () => {
    expect(substituteVariables('env=${ENV_ID}', { ENV_ID: 'prod' })).toBe('env=prod')
  })

  it('leaves unknown placeholders intact', () => {
    expect(substituteVariables('env=${MISSING}', {})).toBe('env=${MISSING}')
  })
})

describe('substituteDeep', () => {
  it('walks nested objects', () => {
    const result = substituteDeep(
      { url: 'https://x?env=${ENV_ID}', headers: { a: '${TOKEN}' } },
      { ENV_ID: 'e1', TOKEN: 't' },
    )
    expect(result).toEqual({ url: 'https://x?env=e1', headers: { a: 't' } })
  })
})

describe('applyVariablesToMcp', () => {
  it('drops unresolved optional query placeholders', () => {
    const mcp = applyVariablesToMcp({
      supabase: {
        type: 'http',
        url: 'https://mcp.supabase.com/mcp?project_ref=${project_ref}&read_only=${read_only}',
      },
    }, { read_only: true })
    expect(mcp.supabase.url).toBe('https://mcp.supabase.com/mcp?read_only=true')
  })
})

describe('hasUnresolvedPlaceholders', () => {
  it('detects leftovers', () => {
    expect(hasUnresolvedPlaceholders('a=${B}')).toBe(true)
    expect(hasUnresolvedPlaceholders('plain')).toBe(false)
  })
})
