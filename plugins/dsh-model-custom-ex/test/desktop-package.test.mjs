import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('standalone desktop package loads outside the workspace and uses live defaults', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-model-package-'))
  try {
    await cp(new URL('../lib/desktop/', import.meta.url), directory, { recursive: true })
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.name, '@just-genius/dsh-model-custom-ex')
    assert.equal(manifest.dependencies, undefined)
    const patch = await readFile(join(directory, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('- id: ui-settings-models\n  disabled: true'))
    const upstream = JSON.parse(await readFile(join(directory, 'UPSTREAM.json'), 'utf8'))
    assert.equal(upstream.package, '@deepseek-ai/dsh-client-ui-settings-models')
    assert.match(upstream.sha256, /^[a-f0-9]{64}$/)
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
    const host = await import(pathToFileURL(join(directory, 'index.js')).href)
    assert.equal(host.Config.dict.defaults.meta.volatile, true)
    const cleanups = []
    const handlers = new Map()
    let defaults = { demo: { model: 'high' } }
    const info = { provider: 'demo', id: 'model', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } }
    const registry = { async resolveModelInfo() { return info } }
    const original = registry.resolveModelInfo
    const events = []
    host.apply({ llm: registry, fiber: {}, settings: { configure(options) { assert.deepEqual(options, { auto: false }); return () => {} } },
      effect(setup) { cleanups.push(setup()) }, on(name, handler) { handlers.set(name, handler) }, emit(name) { events.push(name) } },
      { defaults: { get() { return defaults } } })
    assert.equal((await registry.resolveModelInfo('demo', 'model')).reasoning.defaultEffort, 'high')
    defaults = {}
    handlers.get('loader/volatile-update')()
    assert.deepEqual(events, ['llm/adapters-updated'])
    assert.equal(await registry.resolveModelInfo('demo', 'model'), info)
    for (const dispose of cleanups.reverse()) dispose()
    assert.equal(registry.resolveModelInfo, original)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
