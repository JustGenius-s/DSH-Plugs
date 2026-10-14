import assert from 'node:assert/strict'
import test from 'node:test'
import { changes, CONTEXT_PRESETS, draftFor, formatCapacity, modelRows, offeredEfforts, OUTPUT_PRESETS, parseCapacity, saveChanges, toggleEffort } from '../src/desktop/model-settings.ts'
import type { DesktopRemote, Draft, Namespace } from '../src/desktop/model-settings.ts'
import { installDefaultResolver } from '../src/desktop/default-resolver.ts'

const namespace: Namespace = { ns: 'llm-pi-ai', revision: 7, value: { providers: { demo: {
  apiKeyEnv: 'KEEP_KEY', baseURL: 'https://example.invalid', defaultInput: ['text', 'image'],
  models: [{ id: 'model', input: ['text', 'image'], contextWindow: 256000, reasoningEfforts: { off: null, high: 'gateway-high' }, compat: { supportsStrictTools: false }, futureField: 'keep' }],
} } } }
const defaults: Namespace = { ns: 'dsh-model-custom-ex', revision: 4, value: { defaults: { demo: { model: 'high', sibling: 'low' }, other: { model: 'medium' } } } }
const row = modelRows(namespace, 'demo', [])[0]!
const original = draftFor(row, defaults, 'demo')

test('capacity presets and free typing use decimal K/M and round trip precisely', () => {
  for (const text of [...CONTEXT_PRESETS, ...OUTPUT_PRESETS, '2.3M', '262144']) {
    const count = parseCapacity(text)
    assert.equal(parseCapacity(formatCapacity(count)), count)
  }
  assert.equal(parseCapacity('1M'), 1000000)
  assert.equal(parseCapacity(''), undefined)
  for (const invalid of ['0', '-1', '0.1', 'Infinity', '1e6', '1GB', '9007199254740992']) assert.throws(() => parseCapacity(invalid))
})
test('model rows retain capabilities and unknown fields without mutation', () => {
  const before = structuredClone(namespace)
  assert.deepEqual(row.path, ['providers', 'demo', 'models', '0'])
  assert.deepEqual(row.config.input, ['text', 'image'])
  assert.equal(row.config.futureField, 'keep')
  assert.deepEqual(namespace, before)
})
test('catalog-only models use modelOverrides without freezing the inherited catalog', () => {
  const ns: Namespace = { ns: 'llm-pi-ai', revision: 1, value: { providers: { demo: { modelOverrides: { second: { contextWindow: 128000 } } } } } }
  const rows = modelRows(ns, 'demo', [{ id: 'first' }, { id: 'second' }])
  assert.deepEqual(rows[0]?.path, ['providers', 'demo', 'modelOverrides', 'first'])
  assert.equal(rows[1]?.config.contextWindow, 128000)
})
test('existing model override takes precedence over a declared model', () => {
  const ns = structuredClone(namespace)
  ;(ns.value.providers as any).demo.modelOverrides = { model: { maxTokens: 64000 } }
  const model = modelRows(ns, 'demo', [])[0]!
  assert.deepEqual(model.path, ['providers', 'demo', 'modelOverrides', 'model'])
  assert.equal(model.config.maxTokens, 64000)
  assert.deepEqual(model.config.input, ['text', 'image'])
})
test('capacity edits target only the changed field and preserve identity/vision/compatibility', () => {
  assert.deepEqual(changes(row, original, { ...original, contextWindow: '1M' }, 'demo'), {
    profile: [{ op: 'set', path: [...row.path, 'contextWindow'], value: 1000000 }], defaults: [],
  })
  assert.deepEqual(changes(row, original, original, 'demo'), { profile: [], defaults: [] })
})
test('reasoning toggles preserve custom wire values and use null for off', () => {
  assert.deepEqual(toggleEffort(original.efforts, 'low'), { off: null, high: 'gateway-high', low: 'low' })
  assert.deepEqual(toggleEffort({}, 'off'), { off: null })
  assert.throws(() => toggleEffort({}, 'invalid'))
})
test('disabled, inherited, and explicitly mapped reasoning remain distinct', () => {
  const disabled: Draft = { ...original, mode: 'disabled', defaultEffort: '' }
  assert.equal(changes(row, original, disabled, 'demo').profile[0]?.op, 'set')
  assert.deepEqual(changes(row, original, disabled, 'demo').profile[0], { op: 'set', path: [...row.path, 'reasoningEfforts'], value: false })
  assert.deepEqual(changes(row, original, { ...disabled, mode: 'inherit' }, 'demo').profile[0], { op: 'unset', path: [...row.path, 'reasoningEfforts'] })
  assert.deepEqual(offeredEfforts(row, disabled), [])
})
test('empty reasoning maps and unsupported default levels are refused before writing', () => {
  assert.throws(() => changes(row, original, { ...original, efforts: {} }, 'demo'))
  assert.throws(() => changes(row, original, { ...original, defaultEffort: 'max' }, 'demo'))
  assert.throws(() => changes(row, original, { ...original, efforts: { high: null } }, 'demo'))
})
test('default changes affect one model and preserve other models/providers', () => {
  assert.deepEqual(changes(row, original, { ...original, defaultEffort: 'off' }, 'demo').defaults, [{ op: 'set', path: ['defaults', 'demo', 'model'], value: 'off' }])
  assert.deepEqual(changes(row, original, { ...original, defaultEffort: '' }, 'demo').defaults, [{ op: 'unset', path: ['defaults', 'demo', 'model'] }])
})
test('conflicting model revision blocks the defaults write', async () => {
  const calls: unknown[] = []
  const remote = { settings: { mutate: async (...args: unknown[]) => { calls.push(args); return { ok: false, error: { message: 'conflict' } } } } } as unknown as DesktopRemote
  const result = await saveChanges(remote, namespace, defaults, changes(row, original, { ...original, contextWindow: '1M', defaultEffort: 'off' }, 'demo'))
  assert.equal(result.ok, false)
  assert.equal(calls.length, 1)
  assert.equal((calls[0] as unknown[])[2], 7)
})
test('partial saves retain the successful revision and keep retry scoped to defaults', async () => {
  const calls: unknown[] = []
  const remote = { settings: { mutate: async (ns: string, ops: unknown, revision: number) => {
    calls.push([ns, ops, revision])
    return ns === 'llm-pi-ai' ? { ok: true, value: { ...namespace, revision: 8 } } : { ok: false, error: { message: 'defaults conflict' } }
  } } } as unknown as DesktopRemote
  const next = { ...original, contextWindow: '1M', defaultEffort: 'off' }
  const result = await saveChanges(remote, namespace, defaults, changes(row, original, next, 'demo'))
  assert.equal(result.ok, false)
  assert.equal(result.profileWritten, true)
  assert.equal(result.profile.revision, 8)
  assert.equal((calls[1] as unknown[])[2], 4)
  assert.deepEqual(changes(row, { ...next, defaultEffort: original.defaultEffort }, next, 'demo').profile, [])
})
test('default resolver reads live settings, preserves model recommendations, and restores on unload', async () => {
  const info = { provider: 'demo', id: 'model', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } }
  let stored: Record<string, Record<string, string>> = {}
  const registry = { async resolveModelInfo() { assert.equal(this, registry); return info } }
  const originalMethod = registry.resolveModelInfo
  const dispose = installDefaultResolver(registry, () => stored)
  assert.equal(await registry.resolveModelInfo(), info)
  stored = { demo: { model: 'high' } }
  assert.equal((await registry.resolveModelInfo()).reasoning.defaultEffort, 'high')
  assert.equal(info.reasoning.defaultEffort, 'low')
  stored = { demo: { model: 'unsupported' } }
  assert.equal(await registry.resolveModelInfo(), info)
  dispose()
  assert.equal(registry.resolveModelInfo, originalMethod)
})
