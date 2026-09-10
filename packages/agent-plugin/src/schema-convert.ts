/**
 * Convert an MCP JSON Schema object into the DSH defineTool parameters DSL.
 * Falls back to a single JSON string argument when the schema is too complex.
 */

export type ToolParameterSpec = Record<string, Record<string, unknown>>

export function jsonSchemaToToolParameters(inputSchema: unknown): ToolParameterSpec {
  if (inputSchema === null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    return fallbackPayload()
  }
  const schema = inputSchema as Record<string, unknown>
  const properties = schema.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return fallbackPayload()
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [],
  )

  const parameters: ToolParameterSpec = {}
  for (const [name, raw] of Object.entries(properties as Record<string, unknown>)) {
    const converted = convertProperty(raw, required.has(name))
    if (converted === null) return fallbackPayload()
    parameters[name] = converted
  }
  return parameters
}

function convertProperty(
  raw: unknown,
  required: boolean,
): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const node = raw as Record<string, unknown>
  const type = node.type

  if (type === 'object') {
    const nested = convertObject(node)
    if (nested === null) return null
    if (required) nested.required = true
    if (typeof node.description === 'string') nested.description = node.description
    return nested
  }

  if (type === 'array') {
    const items = node.items
    const itemSpec = items === undefined
      ? { type: 'string' }
      : convertProperty(items, false)
    if (itemSpec === null) return null
    const result: Record<string, unknown> = {
      type: 'array',
      items: itemSpec,
    }
    if (required) result.required = true
    if (typeof node.description === 'string') result.description = node.description
    return result
  }

  if (
    type === 'string'
    || type === 'number'
    || type === 'integer'
    || type === 'boolean'
  ) {
    const result: Record<string, unknown> = { type }
    if (required) result.required = true
    if (typeof node.description === 'string') result.description = node.description
    return result
  }

  return null
}

function convertObject(node: Record<string, unknown>): Record<string, unknown> | null {
  const properties = node.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return {
      type: 'object',
      additionalProperties: true,
      properties: {},
    }
  }
  const required = new Set(
    Array.isArray(node.required)
      ? node.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  const props: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(properties as Record<string, unknown>)) {
    const converted = convertProperty(raw, required.has(name))
    if (converted === null) return null
    props[name] = converted
  }
  return {
    type: 'object',
    additionalProperties: node.additionalProperties === true,
    properties: props,
  }
}

function fallbackPayload(): ToolParameterSpec {
  return {
    arguments_json: {
      type: 'string',
      required: true,
      description: 'JSON object of tool arguments (stringified).',
    },
  }
}

/** Resolve model args into an MCP arguments object. */
export function resolveToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.arguments_json === 'string') {
    try {
      const parsed = JSON.parse(args.arguments_json) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { arguments_json: args.arguments_json }
    }
  }
  const { arguments_json: _ignored, ...rest } = args
  return rest
}
