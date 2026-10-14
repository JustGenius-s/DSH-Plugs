import { describe, expect, it, vi } from 'vitest'
import type {
  ClientContext,
  SettingsScope,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import { closeSidebarTabsByKind } from '../src/client/sidebar-right'
import {
  createOfficialTerminalShutdownFeature,
  OFFICIAL_TERMINAL_KIND,
  OFFICIAL_TERMINAL_SHUTDOWN_TAB_ID,
  officialTerminalShutdownDefinition,
} from '../src/client/features/terminal/official-shutdown'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../src/shared/config'

interface OpenTab {
  sessionId: string
  tabId: string
  kind: string
}

/**
 * Mock of the untyped controller internals behind ctx.sidebarRight: an
 * inventory that drops closed tabs, and a closeIn that removes them.
 */
function createInternals(initial: OpenTab[] = []) {
  const open = [...initial]
  let listener = (): void => {}
  return {
    open,
    notify: () => listener(),
    closeIn: vi.fn((sessionId: string, tabId: string) => {
      const index = open.findIndex(tab => tab.sessionId === sessionId && tab.tabId === tabId)
      if (index !== -1) open.splice(index, 1)
    }),
    openTabs: {
      getSnapshot: () => [...open],
      subscribe: (next: () => void) => {
        listener = next
        return () => { listener = () => {} }
      },
    },
  }
}

function createScope(value: Partial<DshCodexConfig>) {
  let current = value
  let listener = (): void => {}
  return {
    set(next: Partial<DshCodexConfig>) {
      current = next
      listener()
    },
    scope: {
      getSnapshot: () => ({ value: current }),
      subscribe: (next: () => void) => {
        listener = next
        return () => { listener = () => {} }
      },
      set: () => Promise.resolve(),
    } as unknown as SettingsScope<DshCodexConfig>,
  }
}

function createCtx(internals: ReturnType<typeof createInternals>) {
  const definitions: SidebarRightTabDefinition[] = []
  const events: string[] = []
  const ctx = {
    sidebarRight: internals,
    sidebarRightTabs: {
      register: (definition: SidebarRightTabDefinition) => {
        definitions.push(definition)
        events.push(`definition:register:${definition.id}`)
        return () => { events.push(`definition:dispose:${definition.id}`) }
      },
    },
    slots: {
      inject(name: string, attach: () => () => void) {
        const dispose = attach()
        return () => dispose()
      },
      register: () => () => {},
    },
  } as unknown as ClientContext
  return { ctx, definitions, events }
}

describe('officialTerminalShutdownDefinition', () => {
  it('shadows the built-in terminal kind without claiming or advertising anything', () => {
    const definition = officialTerminalShutdownDefinition(key => key)

    expect(definition.id).toBe(OFFICIAL_TERMINAL_SHUTDOWN_TAB_ID)
    expect(definition.kind).toBe(OFFICIAL_TERMINAL_KIND)
    expect(OFFICIAL_TERMINAL_KIND).toBe('terminal')
    expect(definition.priority).toBe('extension')
    expect(definition.patterns).toBeUndefined()
    expect(definition.guide).toEqual([])
    expect(definition.title('sidebar://terminal')).toBe('view.warpTerminal')
  })
})

describe('closeSidebarTabsByKind', () => {
  it('closes only tabs of the requested kind and sweeps late arrivals until disposed', () => {
    const internals = createInternals([
      { sessionId: 's1', tabId: 't1', kind: 'terminal' },
      { sessionId: 's1', tabId: 't2', kind: 'files' },
    ])
    const ctx = { sidebarRight: internals } as unknown as ClientContext

    const dispose = closeSidebarTabsByKind(ctx, 'terminal')

    expect(internals.closeIn).toHaveBeenCalledTimes(1)
    expect(internals.closeIn).toHaveBeenCalledWith('s1', 't1')
    expect(internals.open).toEqual([{ sessionId: 's1', tabId: 't2', kind: 'files' }])

    // A recovered PTY tab appears after the initial sweep.
    internals.open.push({ sessionId: 's2', tabId: 't3', kind: 'terminal' })
    internals.notify()
    expect(internals.closeIn).toHaveBeenCalledWith('s2', 't3')
    expect(internals.open).toEqual([{ sessionId: 's1', tabId: 't2', kind: 'files' }])

    internals.closeIn.mockClear()
    dispose()
    internals.open.push({ sessionId: 's2', tabId: 't4', kind: 'terminal' })
    internals.notify()
    expect(internals.closeIn).not.toHaveBeenCalled()
  })
})

describe('createOfficialTerminalShutdownFeature', () => {
  it('stays inert while the setting is off', () => {
    const internals = createInternals([{ sessionId: 's1', tabId: 't1', kind: 'terminal' }])
    const { ctx, events } = createCtx(internals)
    const { scope } = createScope({ officialTerminalDisabled: false })

    const dispose = createOfficialTerminalShutdownFeature(ctx, scope, key => key).activate()

    expect(events).toEqual([])
    expect(internals.closeIn).not.toHaveBeenCalled()
    dispose()
  })

  it('shadows the built-in terminal and sweeps its tabs while on, then restores', () => {
    const internals = createInternals([{ sessionId: 's1', tabId: 't1', kind: 'terminal' }])
    const { ctx, definitions, events } = createCtx(internals)
    const controller = createScope({ officialTerminalDisabled: false })

    const dispose = createOfficialTerminalShutdownFeature(ctx, controller.scope, key => key).activate()
    controller.set({ ...DEFAULT_CONFIG, officialTerminalDisabled: true })

    expect(definitions.map(definition => definition.kind)).toEqual(['terminal'])
    expect(internals.closeIn).toHaveBeenCalledWith('s1', 't1')
    expect(internals.open).toEqual([])

    controller.set({ ...DEFAULT_CONFIG, officialTerminalDisabled: false })
    expect(events).toContain(`definition:dispose:${OFFICIAL_TERMINAL_SHUTDOWN_TAB_ID}`)
    dispose()
  })
})
