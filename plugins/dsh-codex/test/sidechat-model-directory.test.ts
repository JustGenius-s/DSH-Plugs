/**
 * The model directory read, after DSH 0.1.2.
 *
 * These pin the diagnosis as much as the behaviour: `connection.api` still
 * exists and the inject entry is still present, so nothing threw when 0.1.2
 * removed `sessions.models` / `sessions.selectModel` — the picker just never
 * received a directory, and its error blamed a missing inject. The service
 * that owns per-session selection now is `ctx.modelDirectories`.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  loadModelDirectory,
  MODEL_DIRECTORY_MISSING_MESSAGE,
  modelDirectoriesOf,
  selectModel,
  type ModelDirectoryFace,
  type ModelDirectoryResolverFace,
} from '../src/client/features/side-chat/model-directory'

const selection = { provider: 'deepseek', model: 'DeepSeek-V4-Pro' }

function resolverFor(directory: ModelDirectoryFace): ModelDirectoryResolverFace {
  return { directoryFor: () => directory }
}

describe('modelDirectoriesOf', () => {
  const service = resolverFor({ load: async () => ({ groups: [] }), select: async () => {} })

  it('reads the service through ctx.get', () => {
    const ctx = { get: (name: string) => (name === 'modelDirectories' ? service : undefined) }
    expect(modelDirectoriesOf(ctx)).toBe(service)
  })

  it('falls back to a direct property when ctx.get is absent', () => {
    expect(modelDirectoriesOf({ modelDirectories: service })).toBe(service)
  })

  it('returns undefined when the service is missing', () => {
    expect(modelDirectoriesOf({ get: () => undefined })).toBeUndefined()
    expect(modelDirectoriesOf({})).toBeUndefined()
  })

  it('survives a proxy that throws on the property (undeclared service)', () => {
    const throwing = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'modelDirectories') throw new Error('cannot get property "modelDirectories" without inject')
        return undefined
      },
    })
    expect(modelDirectoriesOf(throwing)).toBeUndefined()
  })

  it('ignores an object that only pretends to be the service', () => {
    // A service that has not composed yet: no `directoryFor` to call.
    expect(modelDirectoriesOf({ get: () => ({}) })).toBeUndefined()
  })
})

describe('loadModelDirectory', () => {
  it('adapts the directory snapshot to the shape the picker renders', async () => {
    const directory: ModelDirectoryFace = {
      load: async () => ({
        current: selection,
        groups: [{
          id: 'deepseek',
          name: 'DeepSeek',
          models: [{ id: 'DeepSeek-V4-Pro', name: 'V4 Pro' }],
        }],
        failures: [{ id: 'openai', message: 'quota' }],
        status: 'ready',
        error: null,
      }),
      select: async () => {},
    }
    const value = await loadModelDirectory(resolverFor(directory), 'sess-1')
    expect(value.current).toEqual(selection)
    expect(value.groups).toHaveLength(1)
    expect(value.groups[0].models).toHaveLength(1)
    expect(value.failures).toEqual([{ id: 'openai', message: 'quota' }])
  })

  it('keeps per-provider failures so the picker can explain an empty list', async () => {
    // The whole point of not flattening this: "no models" and "provider
    // refused" are different stories, and the old message sent the reader
    // after the wrong one.
    const directory: ModelDirectoryFace = {
      load: async () => ({ current: null, groups: [], failures: [{ id: 'openai', name: 'OpenAI', message: '401' }] }),
      select: async () => {},
    }
    const value = await loadModelDirectory(resolverFor(directory), 'sess-1')
    expect(value.groups).toEqual([])
    expect(value.failures).toEqual([{ id: 'openai', name: 'OpenAI', message: '401' }])
    expect(value.current).toBeUndefined()
  })

  it('resolves the directory for the session it was asked about', async () => {
    const directoryFor = vi.fn(() => ({
      load: async () => ({ groups: [] }),
      select: async () => {},
    }))
    await loadModelDirectory({ directoryFor: directoryFor as never }, 'sess-42')
    expect(directoryFor).toHaveBeenCalledWith('sess-42')
  })

  it('names the service to inject when it is missing', async () => {
    await expect(loadModelDirectory(undefined, 'sess-1')).rejects.toThrow(MODEL_DIRECTORY_MISSING_MESSAGE)
    // The old text blamed connection.api, which 0.1.2 removed — pointing at
    // an inject entry that was already present.
    expect(MODEL_DIRECTORY_MISSING_MESSAGE).not.toContain('connection.api')
    expect(MODEL_DIRECTORY_MISSING_MESSAGE).toContain('dsh-client-ui-model-selection')
  })

  it('propagates a rejected load instead of reporting an empty directory', async () => {
    const directory: ModelDirectoryFace = {
      load: async () => { throw new Error('catalog unavailable') },
      select: async () => {},
    }
    await expect(loadModelDirectory(resolverFor(directory), 'sess-1')).rejects.toThrow('catalog unavailable')
  })
})

describe('selectModel', () => {
  it('submits the whole selection through the session directory', async () => {
    const select = vi.fn(async () => {})
    await selectModel(resolverFor({ load: async () => ({ groups: [] }), select }), 'sess-1', {
      provider: 'deepseek',
      model: 'DeepSeek-V4-Pro',
      reasoningEffort: 'high',
    })
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'DeepSeek-V4-Pro',
      reasoningEffort: 'high',
    })
  })

  it('throws when the service is missing, so the caller reports it', async () => {
    await expect(selectModel(undefined, 'sess-1', selection)).rejects.toThrow(MODEL_DIRECTORY_MISSING_MESSAGE)
  })

  it('surfaces a refused selection', async () => {
    const directory: ModelDirectoryFace = {
      load: async () => ({ groups: [] }),
      select: async () => { throw new Error('model not routable') },
    }
    await expect(selectModel(resolverFor(directory), 'sess-1', selection)).rejects.toThrow('model not routable')
  })
})
