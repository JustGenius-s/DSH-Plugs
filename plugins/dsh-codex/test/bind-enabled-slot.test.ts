import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { bindEnabledSlot } from '../src/client/bind-enabled-slot'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../src/shared/config'

describe('bindEnabledSlot', () => {
  it('runs the transition callback after registration state has settled', () => {
    let value: Partial<DshCodexConfig> = { customFilesEnabled: false }
    let listener = (): void => {}
    const events: string[] = []
    const scope = {
      getSnapshot: () => ({ value }),
      subscribe: (next: () => void) => {
        listener = next
        return () => { listener = () => {} }
      },
    } as unknown as SettingsScope<DshCodexConfig>

    const dispose = bindEnabledSlot(
      scope,
      config => config.customFilesEnabled,
      () => {
        events.push('register')
        return () => { events.push('unregister') }
      },
      enabled => { events.push(`changed:${enabled}`) },
    )

    value = { ...DEFAULT_CONFIG, customFilesEnabled: true }
    listener()
    value = { ...DEFAULT_CONFIG, customFilesEnabled: false }
    listener()
    dispose()

    expect(events).toEqual([
      'changed:false',
      'register',
      'changed:true',
      'unregister',
      'changed:false',
    ])
  })
})
