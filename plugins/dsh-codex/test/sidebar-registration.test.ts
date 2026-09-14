import { describe, expect, it, vi } from 'vitest'
import type {
  ClientContext,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import {
  registerSidebarTab,
  SIDEBAR_TAB_SLOT,
  SIDEBAR_TAB_TITLE_SLOT,
} from '../src/client/sidebar-right'
import {
  SIDE_CHAT_TAB_ID,
  SIDE_CHAT_TAB_KIND,
  sideChatTabDefinition,
} from '../src/client/features/side-chat/definition'

describe('registerSidebarTab', () => {
  it('owns the official definition and keyed body/title slots as one lifecycle', () => {
    const events: string[] = []
    const registrations: Array<{ name: string; key: string; locale?: string }> = []
    const definition: SidebarRightTabDefinition = {
      id: '@test/files',
      kind: 'test-files',
      title: () => 'Files',
    }
    const registerDefinition = vi.fn(() => {
      events.push('definition:register')
      return () => { events.push('definition:dispose') }
    })
    const slots = {
      inject(name: string, attach: () => () => void) {
        events.push(`inject:${name}`)
        const dispose = attach()
        return () => {
          events.push(`inject:${name}:dispose`)
          dispose()
        }
      },
      register(options: { name: string; key: string; locale?: string }) {
        registrations.push(options)
        events.push(`slot:${options.name}:register`)
        return () => { events.push(`slot:${options.name}:dispose`) }
      },
    }
    const ctx = {
      sidebarRightTabs: { register: registerDefinition },
      slots,
    } as unknown as ClientContext

    const dispose = registerSidebarTab(
      ctx,
      definition,
      () => null,
      { locale: 'settings.codex', title: () => 'Files' },
    )

    expect(registerDefinition).toHaveBeenCalledWith(definition)
    expect(registrations).toEqual([
      { name: SIDEBAR_TAB_SLOT, key: definition.id, locale: 'settings.codex' },
      { name: SIDEBAR_TAB_TITLE_SLOT, key: definition.id, locale: 'settings.codex' },
    ])

    dispose()
    expect(events.slice(-5)).toEqual([
      `inject:${SIDEBAR_TAB_TITLE_SLOT}:dispose`,
      `slot:${SIDEBAR_TAB_TITLE_SLOT}:dispose`,
      `inject:${SIDEBAR_TAB_SLOT}:dispose`,
      `slot:${SIDEBAR_TAB_SLOT}:dispose`,
      'definition:dispose',
    ])
  })

  it('does not claim the optional title slot when none is provided', () => {
    const injected: string[] = []
    const ctx = {
      sidebarRightTabs: { register: () => () => {} },
      slots: {
        inject(name: string, attach: () => () => void) {
          injected.push(name)
          const dispose = attach()
          return () => dispose()
        },
        register: () => () => {},
      },
    } as unknown as ClientContext

    const dispose = registerSidebarTab(ctx, {
      id: '@test/plain',
      kind: 'plain',
      title: () => 'Plain',
    }, () => null)

    expect(injected).toEqual([SIDEBAR_TAB_SLOT])
    dispose()
  })
})

describe('Side Chat ownership', () => {
  it('contributes a first-class extension tab to the official Sidebar', () => {
    const definition = sideChatTabDefinition(key => key)

    expect(definition.id).toBe(SIDE_CHAT_TAB_ID)
    expect(definition.kind).toBe(SIDE_CHAT_TAB_KIND)
    expect(definition.priority).toBe('extension')
    expect(definition.guide).toHaveLength(1)
  })
})
