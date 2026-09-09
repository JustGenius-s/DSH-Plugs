import { describe, expect, it, vi } from 'vitest'
import { createEnabledResourceGate } from '../src/host/enabled-resource'

describe('createEnabledResourceGate', () => {
  it('registers and unregisters one resource as the setting changes', () => {
    const disposeResource = vi.fn()
    const create = vi.fn(() => disposeResource)
    const gate = createEnabledResourceGate(create)

    gate.setEnabled(false)
    gate.setEnabled(true)
    gate.setEnabled(true)
    gate.setEnabled(false)

    expect(create).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledOnce()
  })

  it('disposes an active resource and ignores later setting changes', () => {
    const disposeResource = vi.fn()
    const create = vi.fn(() => disposeResource)
    const gate = createEnabledResourceGate(create)

    gate.setEnabled(true)
    gate.dispose()
    gate.dispose()
    gate.setEnabled(true)

    expect(create).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledOnce()
  })
})
