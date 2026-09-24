// Native seat actions must carry the data the seats were rendered with.
//
// The menu/tray items are built from a DesktopUpdateState snapshot: the
// "update DSH runtime" item is only enabled when that snapshot has a pending
// dsh update, and the "download app" item names a concrete release. Their
// actions must therefore use the version / URL they advertised. Routing an
// empty argument instead lets a stale snapshot install some other version than
// the label promised (and silently no-ops in update-store, which drops empty
// versions), or opens the generic releases page instead of the named release.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_STATE, type DesktopUpdateState } from '../src/shared'

type Listener = (action: { contributor: string; id: string }) => void

/** Install the real seats against a stub window.dshDesktop bridge. */
async function mount(state: DesktopUpdateState, contributor = 'desktop-update') {
  let seatListener: Listener | undefined
  const shell = {
    updates: {
      appVersion: async () => '1.2.3',
      downloadApp: vi.fn(async () => {}),
      updateDsh: vi.fn(async () => {}),
      relaunch: vi.fn(),
    },
    seats: {
      list: async () => [],
      contribute: async () => {},
      revoke: async () => {},
      onAction: (listener: Listener) => {
        seatListener = listener
        return () => { seatListener = undefined }
      },
    },
    notify: {
      show: async () => ({ shown: true }),
      close: async () => {},
      onAction: () => () => {},
    },
  }
  ;(globalThis as unknown as { window: unknown }).window = { dshDesktop: shell }

  const { installDesktopSeats } = await import('../src/client/seats')
  const handlers = {
    checkNow: vi.fn(),
    downloadApp: vi.fn(),
    updateDsh: vi.fn(),
    relaunch: vi.fn(),
  }
  const dispose = installDesktopSeats(
    (apply) => {
      apply(state)
      return () => {}
    },
    handlers,
  )
  await Promise.resolve()
  return {
    handlers,
    emitSeat: (id: string) => seatListener?.({ contributor, id }),
    dispose,
  }
}

function stateWithUpdates(): DesktopUpdateState {
  return {
    ...EMPTY_STATE,
    app: {
      current: '1.2.3',
      latest: '1.3.0',
      url: 'https://github.com/JustGenius-s/DSH-Desktop/releases/tag/v1.3.0',
    },
    dsh: { current: '0.1.0', latest: '0.2.0' },
  }
}

describe('installDesktopSeats', () => {
  beforeEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).window
  })

  it('routes update-dsh with the advertised version', async () => {
    const h = await mount(stateWithUpdates())
    h.emitSeat('update-dsh')
    expect(h.handlers.updateDsh).toHaveBeenCalledWith('0.2.0')
    h.dispose()
  })

  it('routes download-app with the advertised release url', async () => {
    const h = await mount(stateWithUpdates())
    h.emitSeat('download-app')
    expect(h.handlers.downloadApp).toHaveBeenCalledWith(
      'https://github.com/JustGenius-s/DSH-Desktop/releases/tag/v1.3.0',
    )
    h.dispose()
  })

  it('routes check-now and relaunch', async () => {
    const h = await mount(stateWithUpdates())
    h.emitSeat('check-now')
    h.emitSeat('relaunch')
    expect(h.handlers.checkNow).toHaveBeenCalled()
    expect(h.handlers.relaunch).toHaveBeenCalled()
    h.dispose()
  })

  it('ignores actions from other contributors', async () => {
    const h = await mount(stateWithUpdates(), 'someone-else')
    h.emitSeat('update-dsh')
    h.emitSeat('download-app')
    expect(h.handlers.updateDsh).not.toHaveBeenCalled()
    expect(h.handlers.downloadApp).not.toHaveBeenCalled()
    h.dispose()
  })
})
