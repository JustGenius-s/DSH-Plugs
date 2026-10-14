/**
 * The per-browser state behind the plugin's additive surfaces.
 *
 * Workspace pins here are the plugin's own (DSH has no workspace pin); session
 * pins deliberately are NOT, because they belong to DSH's registry and
 * duplicating them is how the two would drift apart.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

/** Minimal localStorage so the module's load path can run outside a browser. */
function installStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
  }
  return map
}

let store
beforeEach(() => { store = installStorage() })
afterEach(() => { delete globalThis.localStorage })

const load = async () => {
  const mod = await import(`../src/client/features.ts?t=${Math.random()}`)
  return mod
}

test('the store starts empty and unfolded', async () => {
  const f = await load()
  const state = f.getPluginState()
  assert.deepEqual(state.workspacePins, [])
  assert.equal(state.pinsCollapsed, false)
})

test('a project pin is remembered newest-first and survives a reload', async () => {
  const f = await load()
  f.setWorkspacePin('a', true)
  f.setWorkspacePin('b', true)
  assert.deepEqual(f.getPluginState().workspacePins, ['b', 'a'])

  const reloaded = await load()
  assert.deepEqual(reloaded.getPluginState().workspacePins, ['b', 'a'])
})

test('unpinning removes only that project', async () => {
  const f = await load()
  f.setWorkspacePin('a', true)
  f.setWorkspacePin('b', true)
  f.setWorkspacePin('a', false)
  assert.deepEqual(f.getPluginState().workspacePins, ['b'])
})

test('the folded state is remembered per browser', async () => {
  const f = await load()
  f.setPinsCollapsed(true)
  const reloaded = await load()
  assert.equal(reloaded.getPluginState().pinsCollapsed, true)
  reloaded.setPinsCollapsed(false)
  const again = await load()
  assert.equal(again.getPluginState().pinsCollapsed, false)
})

test('adopting host pins does not write back a redundant copy', async () => {
  // The panel mirrors the Host's project pins; an unchanged adopt must be a
  // no-op, or every load would rewrite storage and re-render subscribers.
  const f = await load()
  f.setWorkspacePin('a', true)
  let emissions = 0
  const off = f.subscribePluginState(() => { emissions += 1 })
  f.adoptWorkspacePins(['a'])
  assert.equal(emissions, 0)
  f.adoptWorkspacePins(['a', 'b'])
  assert.equal(emissions, 1)
  off()
})

test('corrupt storage falls back to defaults instead of throwing', async () => {
  installStorage({ 'dsh-workspace-plus:v3': '{not json' })
  const f = await load()
  assert.deepEqual(f.getPluginState().workspacePins, [])
  assert.equal(f.getPluginState().pinsCollapsed, false)
})

test('all additive rows default to on', async () => {
  const f = await load()
  for (const key of f.FEATURE_KEYS) {
    assert.equal(f.isEnabled(key), true, `${key} should default on`)
  }
})

test('a switch can turn an addition off and the choice persists', async () => {
  const f = await load()
  f.setFeature('sessionExport', false)
  assert.equal(f.isEnabled('sessionExport'), false)
  const reloaded = await load()
  assert.equal(reloaded.isEnabled('sessionExport'), false)
  assert.equal(reloaded.isEnabled('sessionCopyReference'), true)
})

test('the removed unread mark leaves no state behind', async () => {
  // The feature was dropped, so both its state field and its writers are gone.
  // Persisted data from an older build must not resurrect the field either.
  // Seed storage the way an older build left it, then load.
  installStorage({
    'dsh-workspace-plus:v3': JSON.stringify({
      workspacePins: ['w'], unreadSessions: ['s1'], features: {},
    }),
  })
  const f = await load()
  const state = f.getPluginState()
  assert.equal('unreadSessions' in state, false)
  assert.equal(typeof f.setUnreadSessions, 'undefined')
  assert.equal(typeof f.toggleId, 'undefined')
  assert.deepEqual(state.workspacePins, ['w'], 'unrelated state still loads')
})

test('a folded project is remembered independently of the others', async () => {
  const f = await load()
  f.setProjectCollapsed('w1', true)
  f.setProjectCollapsed('w2', true)
  assert.deepEqual(f.getPluginState().collapsedProjects.slice().sort(), ['w1', 'w2'])

  const reloaded = await load()
  assert.deepEqual(reloaded.getPluginState().collapsedProjects.slice().sort(), ['w1', 'w2'])

  reloaded.setProjectCollapsed('w1', false)
  assert.deepEqual(reloaded.getPluginState().collapsedProjects, ['w2'])
})

test('folding a project twice does not duplicate its id', async () => {
  // A duplicated id would survive a reload and compare unequal on every write.
  const f = await load()
  f.setProjectCollapsed('w1', true)
  f.setProjectCollapsed('w1', true)
  assert.deepEqual(f.getPluginState().collapsedProjects, ['w1'])
})

test('folding a project leaves the other state alone', async () => {
  const f = await load()
  f.setWorkspacePin('w1', true)
  f.setPinsCollapsed(true)
  f.setProjectCollapsed('w1', true)
  const state = f.getPluginState()
  assert.deepEqual(state.workspacePins, ['w1'])
  assert.equal(state.pinsCollapsed, true)
  assert.deepEqual(state.collapsedProjects, ['w1'])
})

test('every feature key has a Settings label in both locales', async () => {
  // The Settings flyout renders one row per key in SURFACE_KEYS / WORKSPACE_KEYS /
  // SESSION_KEYS and looks its label up in the locale dictionary. A key with no
  // label renders BLANK rather than failing, so a rename that misses the
  // dictionary is invisible until someone opens Settings.
  const { en, zh } = await import('../src/client/locales.ts')
  const features = await load()
  const groups = [features.FEATURE_KEYS, features.WORKSPACE_KEYS, features.SESSION_KEYS, features.SURFACE_KEYS]
  for (const group of groups) {
    for (const key of group) {
      // Settings labels are derived from the key name by the same convention
      // MenuSettingsItem uses; assert BOTH locales carry it.
      const label = `settings.${key}`
      assert.ok(en[label], `en is missing ${label}`)
      assert.ok(zh[label], `zh is missing ${label}`)
    }
  }
})

test('the two locales declare exactly the same keys', async () => {
  // A key present in one language and not the other falls back to the raw key.
  const { en, zh } = await import('../src/client/locales.ts')
  const onlyEn = Object.keys(en).filter((k) => !(k in zh))
  const onlyZh = Object.keys(zh).filter((k) => !(k in en))
  assert.deepEqual(onlyEn, [], 'keys missing from zh')
  assert.deepEqual(onlyZh, [], 'keys missing from en')
})
