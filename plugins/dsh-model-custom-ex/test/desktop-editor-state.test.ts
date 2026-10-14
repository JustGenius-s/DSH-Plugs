import assert from 'node:assert/strict'
import test from 'node:test'
import { createOperations, DefaultEffortDraft, selectedEfforts, toggleModelEffort } from '../src/desktop/editor-state.ts'
import type { DesktopRemote, Namespace } from '../src/desktop/model-settings.ts'

const namespace: Namespace = { ns: 'dsh-model-custom-ex', revision: 4, value: { defaults: { demo: { model: 'high', sibling: 'low' } } } }

test('effort selection preserves model data and existing protocol mappings', () => {
  const model = { id: 'model', input: ['text', 'image'], compat: { supportsStrictMode: false }, reasoningEfforts: { off: null, high: 'gateway-high' } }
  const snapshot = structuredClone(model)
  const next = toggleModelEffort(model, 'low')
  assert.deepEqual(next, { ...model, reasoningEfforts: { off: null, high: 'gateway-high', low: 'low' } })
  assert.deepEqual(model, snapshot)
  assert.deepEqual(selectedEfforts(next), ['off', 'low', 'high'])
  assert.equal(toggleModelEffort({ reasoningEfforts: { high: 'gateway-high' } }, 'high').reasoningEfforts, false)
})

test('inherited efforts are used until a selection is edited', () => {
  const catalog = { id: 'model', reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }
  assert.deepEqual(selectedEfforts({}, catalog), ['off', 'high'])
  assert.deepEqual(selectedEfforts({ reasoningEfforts: false }, catalog), [])
  assert.deepEqual(toggleModelEffort({}, 'low', catalog).reasoningEfforts, { off: null, high: 'high', low: 'low' })
})

test('default edits remain local until Save and can be discarded with the editor', async () => {
  const draft = new DefaultEffortDraft(structuredClone(namespace), 'demo')
  draft.set('model', 'low')
  assert.equal(draft.get('model'), 'low')
  assert.equal(new DefaultEffortDraft(namespace, 'demo').get('model'), 'high')
  draft.set('model', 'high')
  assert.deepEqual(draft.operations(), [])
  await draft.save(async () => { throw new Error('unchanged draft must not write') })
})

test('Save patches only pending defaults with the captured revision and clears on success', async () => {
  const draft = new DefaultEffortDraft(namespace, 'demo')
  draft.set('model', 'low')
  const next: Namespace = { ...namespace, revision: 5, value: { defaults: { demo: { model: 'low', sibling: 'low' } } } }
  const failure = await draft.save(async (ns, ops, revision) => {
    assert.equal(ns, namespace.ns)
    assert.equal(revision, 4)
    assert.deepEqual(ops, [{ op: 'set', path: ['defaults', 'demo', 'model'], value: 'low' }])
    return { ok: true, value: next }
  })
  assert.equal(failure, undefined)
  assert.equal(draft.namespace.revision, 5)
  assert.equal(draft.get('model'), 'low')
  assert.deepEqual(draft.operations(), [])
  draft.set('model', '')
  assert.deepEqual(draft.operations(), [{ op: 'unset', path: ['defaults', 'demo', 'model'] }])
})

test('conflicts and transport errors retain pending defaults for recovery', async () => {
  const draft = new DefaultEffortDraft(namespace, 'demo')
  draft.set('model', 'low')
  assert.match((await draft.save(async () => ({ ok: false, error: { code: 'settings/conflict', message: 'conflict' } })))!, /重新打开/)
  assert.equal(draft.namespace.revision, 4)
  assert.equal(draft.operations().length, 1)
  assert.equal(await draft.save(async () => { throw new Error('offline') }), 'offline')
  assert.equal(draft.operations().length, 1)
})

test('editor operations read the provider catalog and preserve the remote receiver', async () => {
  const settings = {
    async describe() { assert.equal(this, settings); return { ok: true as const, value: { writable: true, namespaces: [namespace] } } },
    async mutate() { assert.equal(this, settings); return { ok: true as const, value: namespace } },
  }
  const remote = { settings, session: { async modelCatalog() { return { ok: true as const, value: { groups: [{ id: 'other', models: [{ id: 'other' }] }, { id: 'demo', models: [{ id: 'model' }] }] } } } } } as unknown as DesktopRemote
  const operations = createOperations(remote).modelCustomEx
  const result = await operations.read('demo')
  assert.deepEqual(result.catalog, [{ id: 'model' }])
  assert.equal(result.defaults.get('model'), 'high')
  await operations.mutate(namespace.ns, [], 4)
})
