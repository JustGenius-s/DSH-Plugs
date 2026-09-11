import { describe, expect, it } from 'vitest'
import { jsonSchemaToToolParameters, resolveToolArguments } from '../src/schema-convert.ts'
import { parseMcpResponseBody } from '../src/mcp-http.ts'
import { parseSkillMarkdown } from '../src/skill.ts'

describe('jsonSchemaToToolParameters', () => {
  it('maps simple object schemas', () => {
    const params = jsonSchemaToToolParameters({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Table name' },
        limit: { type: 'integer' },
      },
    })
    expect(params.name).toMatchObject({ type: 'string', required: true })
    expect(params.limit).toMatchObject({ type: 'integer' })
  })

  it('falls back for unsupported schemas', () => {
    const params = jsonSchemaToToolParameters({
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    })
    expect(params.arguments_json).toBeDefined()
  })
})

describe('resolveToolArguments', () => {
  it('parses arguments_json fallback', () => {
    expect(resolveToolArguments({ arguments_json: '{"a":1}' })).toEqual({ a: 1 })
  })
})

describe('parseMcpResponseBody', () => {
  it('parses plain JSON', () => {
    expect(parseMcpResponseBody('{"result":1}')).toEqual({ result: 1 })
  })

  it('parses SSE data lines', () => {
    const body = ['event: message', 'data: {"result":{"ok":true}}', ''].join('\n')
    expect(parseMcpResponseBody(body)).toEqual({ result: { ok: true } })
  })
})

describe('parseSkillMarkdown', () => {
  it('reads frontmatter', () => {
    const parsed = parseSkillMarkdown(
      [
        '---',
        'name: supabase',
        'description: Use for Supabase work',
        '---',
        '',
        '# Body',
      ].join('\n'),
      'fallback',
    )
    expect(parsed.name).toBe('supabase')
    expect(parsed.description).toContain('Supabase')
    expect(parsed.body).toContain('# Body')
  })
})
