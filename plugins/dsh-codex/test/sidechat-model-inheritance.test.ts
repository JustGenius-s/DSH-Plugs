import { describe, expect, it, vi } from 'vitest'
import {
  inheritedModelSelection,
  initializeSideChatModel,
} from '../src/host/side-chat/model-selection'

const config = {
  provider: 'cursor',
  model: 'kimi-k3',
  reasoningEffort: 'high',
  maxTokens: 65536,
}

describe('side chat model inheritance', () => {
  it('inherits the parent route and explicit effort without request-only settings', () => {
    expect(inheritedModelSelection({ requestHeader: () => ({ config }) })).toEqual({
      provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'high',
    })
  })

  it('uses a pending model switch instead of a stale request header', () => {
    const requestHeader = vi.fn(() => ({ config }))
    expect(inheritedModelSelection({ requestHeader }, {
      provider: 'other', model: 'new-model',
    })).toEqual({ provider: 'other', model: 'new-model' })
    expect(requestHeader).not.toHaveBeenCalled()
  })

  it('inherits a selection even before the parent has made its first request', () => {
    expect(inheritedModelSelection({}, config)).toEqual({
      provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'high',
    })
  })

  it('does not pin an adapter-default effort as a user selection', () => {
    expect(inheritedModelSelection({
      requestHeader: () => ({ config, adapterDefaults: { reasoningEffort: true } }),
    })).toEqual({ provider: 'cursor', model: 'kimi-k3' })
  })

  it('keeps explicit pending effort even if the previous header used a default', () => {
    expect(inheritedModelSelection({
      requestHeader: () => ({ config, adapterDefaults: { reasoningEffort: true } }),
    }, { ...config, reasoningEffort: 'low' })).toEqual({
      provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'low',
    })
  })

  it('allows a blank or reconstructed parent to use the host default', () => {
    expect(inheritedModelSelection({})).toBeUndefined()
    expect(inheritedModelSelection({ requestHeader: () => undefined })).toBeUndefined()
  })

  it('ignores incomplete selections instead of seeding an invalid route', () => {
    expect(inheritedModelSelection({
      requestHeader: () => ({ config: { model: 'orphan' } }),
    }, { provider: '', model: 'invalid' })).toBeUndefined()
    expect(inheritedModelSelection({ requestHeader: () => ({ config }) }, null))
      .toEqual({ provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'high' })
  })

  it('writes a detached selection event without fabricating parent history', () => {
    const append = vi.fn()
    const selected = { provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'high' }
    initializeSideChatModel({ append }, selected)
    expect(append).toHaveBeenCalledExactlyOnceWith('model/selection', selected)
    expect(append.mock.calls[0]?.[1]).not.toBe(selected)
  })
})
