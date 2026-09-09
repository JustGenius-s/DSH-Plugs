/**
 * The side-chat model picker must never become a dead end.
 *
 * A disabled trigger cannot be opened, so any explanation placed inside the
 * menu is unreachable — which is exactly how "cannot pick a model" was once
 * reported: the control sat there inert while the reason (every provider
 * failing vs. none configured vs. the namespace not being mounted) stayed
 * invisible without a console.
 *
 * These tests pin that contract against the pure state module: the picker
 * resolves a notice for every directory state instead of disabling itself.
 */

import { describe, expect, it } from 'vitest'
import {
  modelLookupErrorMessage,
  modelMenuNotice,
  modelTriggerLabel,
  type ModelDirectoryState,
} from '../src/client/features/side-chat/model-picker'

const loading: ModelDirectoryState = { status: 'loading' }

const ready = (groups: { id: string; models: { id: string }[] }[]): ModelDirectoryState =>
  ({ status: 'ready', value: { groups } })

describe('modelMenuNotice', () => {
  it('reports the loading state', () => {
    expect(modelMenuNotice(loading)).toEqual({ text: '正在加载模型目录…' })
  })

  it('reports a failed lookup with its cause', () => {
    const state: ModelDirectoryState = { status: 'error', message: 'boom' }
    expect(modelMenuNotice(state)).toEqual({ text: 'boom' })
  })

  it('falls back to a generic message when the error is empty', () => {
    const state: ModelDirectoryState = { status: 'error', message: '' }
    expect(modelMenuNotice(state).text).toBe('模型目录加载失败')
  })

  it('stays silent when models are listed', () => {
    expect(modelMenuNotice(ready([{ id: 'p', models: [{ id: 'm' }] }])).text).toBeUndefined()
  })

  it('explains an empty provider list', () => {
    const state: ModelDirectoryState = {
      status: 'ready',
      value: { groups: [], failures: [] },
    }
    expect(modelMenuNotice(state).text).toBe('没有可用的模型目录')
  })

  it('plumbs provider failures through to the picker', () => {
    const state: ModelDirectoryState = {
      status: 'ready',
      value: {
        groups: [],
        failures: [
          { id: 'openai', name: 'OpenAI', message: 'no api key' },
          { id: 'local' },
        ],
      },
    }
    expect(modelMenuNotice(state).details).toEqual([
      'OpenAI: no api key',
      'local: provider 失败',
    ])
  })
})

describe('modelTriggerLabel', () => {
  it('keeps a stable short form while loading', () => {
    expect(modelTriggerLabel(loading, undefined)).toBe('模型…')
  })

  it('shows the selection once one exists, even while loading', () => {
    expect(modelTriggerLabel(loading, 'deepseek-chat')).toBe('deepseek-chat')
  })

  it('prompts for a choice when the directory arrived empty', () => {
    expect(modelTriggerLabel(ready([]), undefined)).toBe('选择模型')
  })
})

describe('modelLookupErrorMessage', () => {
  it('names the unmounted remote.session namespace on a carrier TypeError', () => {
    const message = modelLookupErrorMessage(new TypeError('Failed to fetch'))
    expect(message).toContain('remote.session 未挂载')
    expect(message).toContain('dsh-api-remotes')
  })

  it('passes an ordinary error message through', () => {
    expect(modelLookupErrorMessage(new Error('503'))).toBe('503')
  })

  it('does not crash on a non-error cause', () => {
    expect(modelLookupErrorMessage(undefined)).toBe('model lookup failed')
    expect(modelLookupErrorMessage('nope')).toBe('model lookup failed')
  })
})
