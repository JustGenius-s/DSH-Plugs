/**
 * Session model-directory access.
 *
 * `dsh-api-remotes` mounts its Remote namespaces asynchronously, so a caller
 * that reads once on mount can run before `remote.session` exists. With no
 * retry, a model picker stays disabled for the rest of the session — which is
 * exactly how this failed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readSessionModelCatalog,
  readSessionModelCatalogWhenReady,
} from '../src/client.ts'

/**
 * Build a fake client context whose `remote.session` appears after `delayMs`.
 *
 * modelRemoteOf resolves the namespace **by name** (`ctx.get('remote.session')`)
 * — not via `ctx.remote.session`, which is an injected Cordis property that
 * throws `cannot get property "remote.session" without inject` when the
 * plugin's inject list omits it.
 */
function contextWithLateSession({ delayMs = 0, catalog } = {}) {
  const group = { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }
  const resolved = catalog ?? {
    default: { provider: 'openai', model: 'gpt-4o' },
    groups: [group],
  }
  const namespace = {
    modelCatalog: async () => ({ ok: true, value: resolved }),
    selectModel: async () => ({ ok: true, value: { selected: resolved.default } }),
  }
  let mounted = delayMs === 0 ? namespace : undefined
  if (delayMs > 0) setTimeout(() => { mounted = namespace }, delayMs)
  return {
    get(name) {
      // Only the namespace service itself is looked up.
      return name === 'remote.session' ? mounted : undefined
    },
  }
}

/**
 * A context where `remote.session` is not injected: resolving it by name
 * returns undefined (ctx.get does not throw), unlike the property access.
 */
function contextWithoutRemoteSession() {
  return { get: () => undefined }
}

/** A context whose `remote` service is not injected: reading it throws. */
function contextWithoutRemote() {
  return {
    get remote() {
      throw new Error('cannot get property "remote" without inject')
    },
    get(name) {
      if (name === 'remote') throw new Error('cannot get property "remote" without inject')
      return undefined
    },
  }
}

test('reads the catalog when the namespace is already mounted', async () => {
  const catalog = await readSessionModelCatalogWhenReady(contextWithLateSession())
  assert.equal(catalog?.current?.provider, 'openai')
  assert.equal(catalog?.groups.length, 1)
  assert.equal(catalog?.groups[0].models[0].id, 'gpt-4o')
})

test('waits for a namespace that mounts late', async () => {
  // The regression: a single read on mount missed this and never retried.
  const ctx = contextWithLateSession({ delayMs: 200 })
  assert.equal(await readSessionModelCatalog(ctx), undefined)
  const catalog = await readSessionModelCatalogWhenReady(ctx, { intervalMs: 40 })
  assert.equal(catalog?.groups.length, 1)
})

test('survives a context whose remote service is not injected', async () => {
  // Reading an uninjected service throws in cordis; a picker must degrade,
  // not crash the composer.
  const ctx = contextWithoutRemote()
  // The service read throws; every helper must degrade instead.
  assert.equal(await readSessionModelCatalog(ctx), undefined)
  assert.equal(
    await readSessionModelCatalogWhenReady(ctx, { timeoutMs: 60, intervalMs: 20 }),
    undefined,
  )
})

test('gives up instead of polling forever', async () => {
  // The service exists but carries no session namespace.
  const ctx = contextWithoutRemoteSession()
  const started = Date.now()
  const catalog = await readSessionModelCatalogWhenReady(ctx, {
    timeoutMs: 200,
    intervalMs: 40,
  })
  assert.equal(catalog, undefined)
  assert.ok(Date.now() - started >= 150, 'should have waited out most of the timeout')
})

test('resolves the namespace by name, never through ctx.remote.session', async () => {
  // The regression: `remote.session` is an injected Cordis property, so
  // touching it without the plugin declaring the namespace throws
  // `cannot get property "remote.session" without inject`.
  const seen = []
  const namespace = {
    modelCatalog: async () => ({ ok: true, value: { groups: [] } }),
    selectModel: async () => ({ ok: true, value: {} }),
  }
  const ctx = {
    get(name) {
      seen.push(name)
      return name === 'remote.session' ? namespace : undefined
    },
    // Any property access on remote must not be used for the namespace.
    get remote() {
      throw new Error('cannot get property "remote" without inject')
    },
  }
  const catalog = await readSessionModelCatalog(ctx)
  assert.ok(seen.includes('remote.session'), 'should look the namespace up by name')
  assert.deepEqual(catalog?.groups, [])
})

test('drops provider groups with no models', async () => {
  const ctx = contextWithLateSession({
    catalog: {
      default: { provider: 'openai', model: 'gpt-4o' },
      groups: [
        { id: 'empty', name: 'Empty', models: [] },
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
      ],
    },
  })
  const catalog = await readSessionModelCatalogWhenReady(ctx)
  assert.equal(catalog?.groups.length, 1)
  assert.equal(catalog?.groups[0].id, 'openai')
})

test('keeps provider failures so a picker can explain an empty list', async () => {
  // Every provider failing is a deployment problem. Dropping the reasons is
  // what made it indistinguishable from "no models configured", leaving the
  // control silently disabled.
  const ctx = contextWithLateSession({
    catalog: {
      default: { provider: 'openai', model: 'gpt-4o' },
      groups: [],
      failures: [{ id: 'openai', name: 'OpenAI', message: 'missing api key' }],
    },
  })
  const catalog = await readSessionModelCatalogWhenReady(ctx)
  assert.equal(catalog?.groups.length, 0)
  assert.equal(catalog?.failures.length, 1)
  assert.equal(catalog?.failures[0].message, 'missing api key')
})

test('reports no failures when the directory is simply empty', async () => {
  const ctx = contextWithLateSession({ catalog: { groups: [] } })
  const catalog = await readSessionModelCatalogWhenReady(ctx)
  assert.deepEqual(catalog?.failures, [])
})
