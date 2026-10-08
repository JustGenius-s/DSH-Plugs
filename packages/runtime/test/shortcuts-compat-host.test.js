import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { runInNewContext } from 'node:vm'
import { patchShortcuts } from '../../../scripts/repair-dsh-shortcuts.mjs'

const root = process.env.DSH_RUNTIME_ROOT
const hostTest = root ? test : test.skip

// Exercise the installed service and its persistence API without rendering a component.
function loadService(source, platform, bridge) {
  let Service
  const storage = new Map()
  const document = { documentElement: { dataset: platform ? { platform } : {} } }
  const window = {
    dshDesktop: bridge,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: { load: ({ factory }) => {
      Service = factory(name => {
        if (name === '@deepseek-ai/cordis') return { Service: class {} }
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: value => ({
          getSnapshot: () => value,
          set: next => { value = next },
          subscribe: () => () => {},
        }) }
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
        throw new Error(`Unexpected dependency: ${name}`)
      })
    } },
  }
  runInNewContext(source, { window, document, navigator: { platform: 'MacIntel' }, crypto: globalThis.crypto, console })
  return { create: () => new Service({ effect() {} }), document, storage }
}

hostTest('legacy desktop boots and persists web shortcuts; native desktop keeps its adapter', async () => {
  const host = createRequire(realpathSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json')))
  const path = join(dirname(host.resolve('@deepseek-ai/dsh-client-shortcuts/package.json')), 'lib/client.js')
  let source = readFileSync(path, 'utf8')
  // The backup permits the regression to remain reproducible after applying the repair.
  if (source.includes('// DSH-Desktop legacy shell:')) source = readFileSync(`${path}.before-desktop-compat`, 'utf8')
  assert.throws(() => loadService(source, 'darwin', {}).create(), /Desktop keyboard bridge unavailable/)
  const patched = patchShortcuts(source)
  assert.equal(patchShortcuts(patched), patched)
  for (const platform of ['darwin', undefined]) {
    const loaded = loadService(patched, platform, {})
    const service = loaded.create()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(service.runtime, 'web')
    assert.equal(service.platform, 'macos')
    assert.equal(loaded.document.documentElement.dataset.platform, platform)
    assert.equal(service.config.getSnapshot().status, 'ready')
    service.register({ id: 'test.command', label: () => 'Test', defaults: {}, run() {} })
    await new Promise(resolve => setImmediate(resolve))
    const result = await service.edit({ type: 'set', id: 'test.command', binding: { code: 'KeyK', modifiers: ['primary', 'shift'] } }, service.config.getSnapshot().revision)
    assert.ok(loaded.storage.has('dsh.keybindings.v1'), JSON.stringify(result))
  }
  let nativeReads = 0
  const native = loadService(patched, 'darwin', {
    keyboard: {}, shortcuts: { get: async () => { nativeReads++; return { sequence: -1 } } },
  }).create()
  assert.equal(native.runtime, 'desktop')
  assert.equal(nativeReads, 1)
  assert.throws(() => loadService(patched, 'darwin', { shortcuts: {} }).create(), /Desktop keyboard bridge unavailable/)
})

test('unrecognized bundles are rejected', () => {
  assert.throws(() => patchShortcuts('changed upstream bundle'), /Unrecognized/)
})
