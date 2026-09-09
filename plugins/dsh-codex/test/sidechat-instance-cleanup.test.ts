/**
 * Switching the side-chat panel off must release the side chats it owns.
 *
 * The tab disappearing is not the same as the side chat going away: the host
 * keeps a live agent per side chat, and an agent nobody can reach still holds
 * its session open and keeps billing context alive. The unmount path cannot
 * cover this because a retained pane the user is not looking at never
 * re-renders, so the release has to be driven from the settings change itself.
 *
 * These drive the real function against a fake store and a recording close
 * call — no React, no component graph.
 */

import { describe, expect, it } from 'vitest'
import { closeAllSideChatInstances, SIDE_CHAT_PANEL_ID } from '../src/client/features/side-chat/instance-cleanup'
import type { SidePanelsStore } from '../src/client/features/side-panels/service'

/** A store double carrying only what the cleanup reads. */
function storeWith(
  instances: { panelId: string; state?: Record<string, string | undefined> }[],
  retained: { sessionId: string; instances: { panelId: string; state?: Record<string, string | undefined> }[] }[] = [],
): SidePanelsStore {
  // A structural double, not a full store: the cleanup reads exactly one
  // method. Cast through `unknown` because the real store carries ~20 methods
  // this test has no business implementing.
  return {
    getSnapshot: () => ({
      open: true,
      width: 360,
      currentSessionId: 'session-current',
      instances: instances as never,
      activeKey: null,
      retainedSessions: retained as never,
    }),
  } as unknown as SidePanelsStore
}

const sideChatTab = (sideSessionId: string) => ({
  panelId: SIDE_CHAT_PANEL_ID,
  state: { sideSessionId },
})

describe('closeAllSideChatInstances', () => {
  it('closes every side chat the current session owns', async () => {
    const closed: string[] = []
    const ids = closeAllSideChatInstances(
      storeWith([sideChatTab('side-1'), sideChatTab('side-2')]),
      async (id) => { closed.push(id); return undefined },
    )
    expect(ids).toEqual(['side-1', 'side-2'])
    await Promise.resolve()
    expect(closed).toEqual(['side-1', 'side-2'])
  })

  it('reaches retained sessions too, not just the visible one', async () => {
    // The regression this guards: reading only `instances` would abandon the
    // side chats of every session the user is not currently looking at, which
    // is exactly where a switched-off feature leaks agents.
    const closed: string[] = []
    const ids = closeAllSideChatInstances(
      storeWith(
        [sideChatTab('side-current')],
        [{ sessionId: 'session-other', instances: [sideChatTab('side-other')] }],
      ),
      async (id) => { closed.push(id); return undefined },
    )
    expect(ids).toEqual(['side-current', 'side-other'])
    await Promise.resolve()
    expect(closed).toContain('side-other')
  })

  it('leaves other panels alone', () => {
    const ids = closeAllSideChatInstances(
      storeWith([
        { panelId: 'terminal', state: { sideSessionId: 'not-a-side-chat' } },
        sideChatTab('side-1'),
      ]),
      async () => undefined,
    )
    expect(ids).toEqual(['side-1'])
  })

  it('skips a tab that has not forked yet', () => {
    // A tab mounting right as the switch flips has no side session to release.
    const ids = closeAllSideChatInstances(
      storeWith([
        { panelId: SIDE_CHAT_PANEL_ID },
        { panelId: SIDE_CHAT_PANEL_ID, state: {} },
        { panelId: SIDE_CHAT_PANEL_ID, state: { sideSessionId: '' } },
      ]),
      async () => undefined,
    )
    expect(ids).toEqual([])
  })

  it('closes a shared id once, so a repeat cannot double-close', () => {
    const ids = closeAllSideChatInstances(
      storeWith(
        [sideChatTab('side-1'), sideChatTab('side-1')],
        [{ sessionId: 'session-other', instances: [sideChatTab('side-1')] }],
      ),
      async () => undefined,
    )
    expect(ids).toEqual(['side-1'])
  })

  it('keeps releasing the rest when one close fails', async () => {
    // One unreachable side chat must not strand the others.
    const closed: string[] = []
    const ids = closeAllSideChatInstances(
      storeWith([sideChatTab('side-1'), sideChatTab('side-2')]),
      async (id) => {
        if (id === 'side-1') throw new Error('host unreachable')
        closed.push(id)
        return undefined
      },
    )
    expect(ids).toEqual(['side-1', 'side-2'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(closed).toEqual(['side-2'])
  })

  it('is a no-op when no side chat is open', () => {
    expect(closeAllSideChatInstances(storeWith([]), async () => undefined)).toEqual([])
  })
})
