import { describe, expect, it, vi } from 'vitest'
import type { SidebarRightOpenResourceOptions } from '@just-genius/dsh-plugin-runtime/client'
import type { QuickAction } from '../src/shared/config'
import { executeQuickAction } from '../src/client/features/quick-actions/executor'
import {
  TERMINAL_TAB_KIND,
  isTerminalResourceAddress,
  terminalControllerId,
  terminalResourceAddress,
  terminalResourceAddressForTab,
  terminalResourceControllerId,
} from '../src/client/features/terminal/contract'

describe('terminal resource tabs', () => {
  it('converts a guide page into a terminal resource only once', () => {
    const address = terminalResourceAddressForTab(
      'sidebar://dsh-codex-terminal',
      'tab / 1',
    )

    expect(address).toBe('dsh-resource://dsh-codex-terminal/tab%20%2F%201')
    expect(isTerminalResourceAddress(address)).toBe(true)
    expect(terminalResourceAddressForTab(address, 'another-tab')).toBe(address)
    expect(isTerminalResourceAddress('sidebar://dsh-codex-terminal')).toBe(false)
  })

  it('runs a new-target step in the controller owned by the new resource tab', async () => {
    const openResource = vi.fn()
    const run = vi.fn(async () => {})
    const waitFor = vi.fn(async () => ({ run }))
    const action: QuickAction = {
      id: 'action-1',
      name: 'New terminal',
      steps: [{ command: '  pnpm test  ', target: 'new' }],
    }

    await executeQuickAction(
      { openResource },
      { waitFor },
      action,
      {
        sessionId: 'session-1',
        terminalId: terminalControllerId('session-1', 'tab-current'),
        cwd: '/workspace',
      },
    )

    expect(openResource).toHaveBeenCalledOnce()
    const [address, options] = openResource.mock.calls[0]!
    expect(isTerminalResourceAddress(address)).toBe(true)
    expect(options).toEqual({
      kind: TERMINAL_TAB_KIND,
      revealIfOpened: false,
      params: { cwd: '/workspace' },
    })
    // The controller is awaited by the minted resource address, not by any tab
    // id: the new tab id is not readable until navigation is applied.
    expect(waitFor).toHaveBeenCalledWith(terminalResourceControllerId('session-1', address))
    expect(waitFor).not.toHaveBeenCalledWith(terminalControllerId('session-1', 'tab-current'))
    expect(run).toHaveBeenCalledWith('pnpm test')
  })

  it('needs no active-tab lookup to run a new-target step', async () => {
    // Regression: `openResource` applies navigation asynchronously, so
    // `sidebarRight.active()` still reports the previously active tab on the
    // next line. Deriving the controller id from that stale tab aborted the
    // run before the command was ever submitted. The executor now takes only
    // `openResource`, so no post-navigation state can be misread.
    const openResource = vi.fn()
    const run = vi.fn(async () => {})
    const waitFor = vi.fn(async () => ({ run }))

    await executeQuickAction(
      { openResource },
      { waitFor },
      {
        id: 'action-1',
        name: 'New terminal',
        steps: [{ command: 'pwd', target: 'new' }],
      },
      {
        sessionId: 'session-1',
        terminalId: terminalControllerId('session-1', 'tab-current'),
        cwd: '/workspace',
      },
    )

    const [address] = openResource.mock.calls[0]!
    expect(waitFor).toHaveBeenCalledWith(terminalResourceControllerId('session-1', address))
    expect(run).toHaveBeenCalledWith('pwd')
  })

  it('opens one terminal per new-target step and runs each in its own', async () => {
    const openResource = vi.fn()
    const run = vi.fn(async () => {})
    const waitFor = vi.fn(async () => ({ run }))

    await executeQuickAction(
      { openResource },
      { waitFor },
      {
        id: 'action-1',
        name: 'Two new terminals',
        steps: [
          { command: 'pnpm dev', target: 'new' },
          { command: 'npm run dev', target: 'new' },
        ],
      },
      {
        sessionId: 'session-1',
        terminalId: terminalControllerId('session-1', 'tab-current'),
        cwd: '/workspace',
      },
    )

    expect(openResource).toHaveBeenCalledTimes(2)
    const [first] = openResource.mock.calls[0]!
    const [second] = openResource.mock.calls[1]!
    expect(first).not.toBe(second)
    expect(waitFor).toHaveBeenCalledWith(terminalResourceControllerId('session-1', first))
    expect(waitFor).toHaveBeenCalledWith(terminalResourceControllerId('session-1', second))
    expect(waitFor).not.toHaveBeenCalledWith(terminalControllerId('session-1', 'tab-current'))
    expect(run.mock.calls).toEqual([['pnpm dev'], ['npm run dev']])
  })

  it('keeps current-target steps on the current controller', async () => {
    const openResource = vi.fn()
    const run = vi.fn(async () => {})
    const waitFor = vi.fn(async () => ({ run }))

    await executeQuickAction(
      { openResource },
      { waitFor },
      {
        id: 'action-1',
        name: 'Current terminal',
        steps: [{ command: 'pwd', target: 'current' }],
      },
      {
        sessionId: 'session-1',
        terminalId: 'session-1:tab-current',
        cwd: '/workspace',
      },
    )

    expect(openResource).not.toHaveBeenCalled()
    expect(waitFor).toHaveBeenCalledWith('session-1:tab-current')
    expect(run).toHaveBeenCalledWith('pwd')
  })
})
