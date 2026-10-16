import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalSessionToken } from '../src/client/features/terminal/connection-controller'
import { createTerminalLifetimeRegistry } from '../src/client/features/terminal/lifetime'
import {
  notePageUnloading,
  readRunningCommand,
  rememberRunningCommand,
  resetPageUnloadingForTest,
} from '../src/client/features/terminal/running-command'

describe('terminalSessionToken', () => {
  it('is stable for one runtime and official tab identity', () => {
    const first = terminalSessionToken('session-1:tab-1', 'runtime-1')
    const second = terminalSessionToken('session-1:tab-1', 'runtime-1')
    expect(first).toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it('separates tab occurrences and browser runtimes', () => {
    expect(terminalSessionToken('session-1:tab-1', 'runtime-1')).not.toBe(
      terminalSessionToken('session-1:tab-2', 'runtime-1'),
    )
    expect(terminalSessionToken('session-1:tab-1', 'runtime-1')).not.toBe(
      terminalSessionToken('session-1:tab-1', 'runtime-2'),
    )
  })
})

describe('createTerminalLifetimeRegistry', () => {
  it('terminates exactly once when the official tab signal aborts', async () => {
    const terminate = vi.fn(async () => {})
    const registry = createTerminalLifetimeRegistry(terminate)
    const controller = new AbortController()

    registry.watch(controller.signal, 'terminal-1')
    registry.watch(controller.signal, 'terminal-1')
    controller.abort()
    registry.watch(controller.signal, 'terminal-1')
    await Promise.resolve()

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledWith('terminal-1')
  })

  it('terminates remaining sessions when the feature is disposed', async () => {
    const terminate = vi.fn(async () => {})
    const registry = createTerminalLifetimeRegistry(terminate)
    const first = new AbortController()
    const second = new AbortController()

    registry.watch(first.signal, 'terminal-1')
    registry.watch(second.signal, 'terminal-2')
    registry.dispose()
    first.abort()
    second.abort()
    await Promise.resolve()

    expect(terminate).toHaveBeenCalledTimes(2)
    expect(terminate).toHaveBeenCalledWith('terminal-1')
    expect(terminate).toHaveBeenCalledWith('terminal-2')
  })

  it('handles a signal that was already aborted', async () => {
    const terminate = vi.fn(async () => {})
    const registry = createTerminalLifetimeRegistry(terminate)
    const controller = new AbortController()
    controller.abort()

    registry.watch(controller.signal, 'terminal-1')
    await Promise.resolve()

    expect(terminate).toHaveBeenCalledOnce()
  })
})

describe('revive record cleanup', () => {
  afterEach(() => resetPageUnloadingForTest())

  it('drops the recorded command when the tab signal aborts', async () => {
    rememberRunningCommand('terminal-1', { command: 'pnpm dev', cwd: '/repo', shell: 'auto' })
    const registry = createTerminalLifetimeRegistry(vi.fn(async () => {}))
    const controller = new AbortController()

    registry.watch(controller.signal, 'terminal-1')
    controller.abort()
    await Promise.resolve()

    expect(readRunningCommand('terminal-1')).toBeNull()
  })

  it('drops the record when the feature is disposed while the page lives', () => {
    rememberRunningCommand('terminal-1', { command: 'pnpm dev', cwd: '/repo', shell: 'auto' })
    const registry = createTerminalLifetimeRegistry(vi.fn(async () => {}))
    const controller = new AbortController()

    registry.watch(controller.signal, 'terminal-1')
    registry.dispose()

    expect(readRunningCommand('terminal-1')).toBeNull()
  })

  it('keeps the record once page unload has begun (app quit)', async () => {
    rememberRunningCommand('terminal-1', { command: 'pnpm dev', cwd: '/repo', shell: 'auto' })
    const terminate = vi.fn(async () => {})
    const registry = createTerminalLifetimeRegistry(terminate)
    const controller = new AbortController()
    registry.watch(controller.signal, 'terminal-1')

    notePageUnloading()
    controller.abort()
    await Promise.resolve()

    // The PTY is still terminated; only the localStorage record survives, so
    // the next app launch replays the command in a fresh shell.
    expect(terminate).toHaveBeenCalledOnce()
    expect(readRunningCommand('terminal-1')?.command).toBe('pnpm dev')
  })

  it('keeps the record when the feature is disposed during page unload', () => {
    rememberRunningCommand('terminal-1', { command: 'pnpm dev', cwd: '/repo', shell: 'auto' })
    const terminate = vi.fn(async () => {})
    const registry = createTerminalLifetimeRegistry(terminate)
    const controller = new AbortController()
    registry.watch(controller.signal, 'terminal-1')

    notePageUnloading()
    registry.dispose()

    expect(terminate).toHaveBeenCalledOnce()
    expect(readRunningCommand('terminal-1')?.command).toBe('pnpm dev')
  })
})
