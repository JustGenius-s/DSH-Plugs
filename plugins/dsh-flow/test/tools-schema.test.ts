import { expect, test } from 'vitest'

import { defineTool } from '@just-genius/dsh-plugin-runtime/host'

/**
 * Tool parameter schemas must compile under the real value-schema DSL.
 *
 * This is a boot-safety test, not a behaviour test. `defineTool()` throws when
 * an author schema uses an unsupported key, and this plugin builds its tools
 * inside `apply()` — so an unsupported schema crashes the whole DSH profile at
 * startup rather than failing one call. Shipping the wrong shape took the GUI
 * down once (an `items` object declaring `required`), which is why the schemas
 * are asserted here instead of only being exercised at runtime.
 *
 * The DSL compiles an array's `items` with `allowRequired: false`, so `required`
 * is illegal inside any object that is itself an array item. Requiredness is
 * described in prose and enforced in the argument parsers.
 */

const NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Required. Stable unique id.' },
    title: { type: 'string', description: 'Required. One-line label.' },
    prompt: { type: 'string', description: 'Required. The brief.' },
    deps: { type: 'array', items: { type: 'string' }, description: 'Ids that must settle first.' },
    parentId: { type: 'string', description: 'Optional parent.' },
    persona: { type: 'string', description: 'Optional persona.' },
    confirm: { type: 'boolean', description: 'Optional human gate.' },
  },
}

/** Compile one parameter map exactly as `defineTool` would at boot. */
function compile(parameters: Record<string, unknown>) {
  return defineTool({
    name: 'schema.compile.check',
    description: 'Compiles a candidate parameter schema.',
    // Invalid maps are part of the suite: they must fail at runtime, not at tsc.
    parameters: parameters as never,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'ok',
  })
}

test('flow.plan parameters compile', () => {
  expect(() => compile({
    title: { type: 'string' },
    nodes: { type: 'array', items: NODE_SCHEMA },
    concurrency: { type: 'integer' },
  })).not.toThrow()
})

test('flow.patch parameters compile', () => {
  expect(() => compile({
    ops: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['retry', 'skip', 'cancel', 'add', 'remove'] },
          nodeId: { type: 'string' },
          node: { type: 'json' },
        },
      },
    },
  })).not.toThrow()
})

test('flow.expand parameters compile', () => {
  expect(() => compile({
    parentId: { type: 'string' },
    nodes: { type: 'array', items: NODE_SCHEMA },
  })).not.toThrow()
})

test('flow.confirm parameters compile', () => {
  expect(() => compile({
    question: { type: 'string' },
    nodeId: { type: 'string' },
  })).not.toThrow()
})

test('flow.status parameters compile', () => {
  expect(() => compile({
    nodeId: { type: 'string', description: 'Optional focus.' },
  })).not.toThrow()
})

test('flow.report parameters compile', () => {
  expect(() => compile({
    note: { type: 'string', description: 'Required. One line of progress.' },
  })).not.toThrow()
})

test('parameterless tools compile', () => {
  expect(() => compile({})).not.toThrow()
})

test('a required block inside array items is rejected by the DSL', () => {
  // Documents the constraint rather than asserting our own preference: this is
  // exactly the shape that crashed profile boot.
  expect(() => compile({
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' } },
        required: { id: true },
      },
    },
  })).toThrow(/required is not supported by the value schema DSL/)
})

test('an object missing additionalProperties is rejected by the DSL', () => {
  expect(() => compile({
    node: { type: 'object', properties: { id: { type: 'string' } } },
  })).toThrow(/additionalProperties/)
})
