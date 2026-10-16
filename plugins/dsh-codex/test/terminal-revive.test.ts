import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTerminalReviver,
  type TerminalReviveHooks,
  type TerminalReviveSession,
} from '../src/client/features/terminal/revive'
import {
  notePageUnloading,
  readRunningCommand,
  rememberRunningCommand,
  resetPageUnloadingForTest,
  type RunningCommandRecord,
  type RunningCommandStorage,
} from '../src/client/features/terminal/running-command'

function createStorage(): RunningCommandStorage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

interface Spawned {
  terminalId: string
  record: RunningCommandRecord
  hooks: TerminalReviveHooks
  session: TerminalReviveSession
  resolveSent(value: boolean): void
}

function createSpawner() {
  const spawned: Spawned[] = []
  const spawn = (
    terminalId: string,
    record: RunningCommandRecord,
    hooks: TerminalReviveHooks,
  ): TerminalReviveSession => {
    let resolveSent!: (value: boolean) => void
    const sent = new Promise<boolean>(resolve => {
      resolveSent = resolve
    })
    const session: TerminalReviveSession = { sent, dispose: vi.fn() }
    spawned.push({ terminalId, record, hooks, session, resolveSent })
    return session
  }
  return { spawned, spawn }
}

afterEach(() => resetPageUnloadingForTest())

describe('createTerminalReviver', () => {
  it('spawns one headless session per recorded command at activation', () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm dev', cwd: '/a', shell: 'zsh' }, storage)
    rememberRunningCommand('s:t-2', { command: 'sleep 300', cwd: '/b', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()

    createTerminalReviver(spawn, storage)

    expect(spawned.map(entry => entry.terminalId).sort()).toEqual(['s:t-1', 's:t-2'])
    expect(spawned[0].record.command).toBe('pnpm dev')
  })

  it('spawns nothing when no commands are recorded', () => {
    const storage = createStorage()
    const { spawned, spawn } = createSpawner()

    const reviver = createTerminalReviver(spawn, storage)

    expect(spawned).toHaveLength(0)
    expect(reviver.claimFor('s:t-1')).toBeUndefined()
  })

  it('settles the claim once the command is sent and hands off idempotently', async () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm dev', cwd: '/a', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)
    const claim = reviver.claimFor('s:t-1')

    spawned[0].resolveSent(true)
    await expect(claim?.settled).resolves.toBe(true)
    expect(spawned[0].session.dispose).not.toHaveBeenCalled()

    claim?.handoff()
    claim?.handoff()
    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
    // The claim survives handoff, so a remounting view never replays twice.
    expect(reviver.claimFor('s:t-1')).toBe(claim)
    // The record stays: the command is still running and must revive again
    // if the app quits before it finishes.
    expect(readRunningCommand('s:t-1', storage)?.command).toBe('pnpm dev')
  })

  it('drops a failed headless session but keeps the record for the view', async () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm dev', cwd: '/a', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)
    const claim = reviver.claimFor('s:t-1')

    spawned[0].resolveSent(false)
    await expect(claim?.settled).resolves.toBe(false)

    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
    expect(reviver.claimFor('s:t-1')).toBeUndefined()
    expect(readRunningCommand('s:t-1', storage)?.command).toBe('pnpm dev')
  })

  it('forgets the record and releases the session when the command finishes', () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm build', cwd: '/a', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)

    spawned[0].hooks.onFinished()

    expect(readRunningCommand('s:t-1', storage)).toBeNull()
    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
    expect(reviver.claimFor('s:t-1')).toBeUndefined()
  })

  it('forgets the record and releases the session when the shell exits', () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm dev', cwd: '/a', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)

    spawned[0].hooks.onExited()

    expect(readRunningCommand('s:t-1', storage)).toBeNull()
    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
  })

  it('dispose stops every session and drops the owned records', () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'one', cwd: '', shell: 'auto' }, storage)
    rememberRunningCommand('s:t-2', { command: 'two', cwd: '', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)

    reviver.dispose()
    reviver.dispose()

    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
    expect(spawned[1].session.dispose).toHaveBeenCalledTimes(1)
    expect(readRunningCommand('s:t-1', storage)).toBeNull()
    expect(readRunningCommand('s:t-2', storage)).toBeNull()
    expect(reviver.claimFor('s:t-1')).toBeUndefined()
  })

  it('keeps the records when disposed during page unload (app quit)', () => {
    const storage = createStorage()
    rememberRunningCommand('s:t-1', { command: 'pnpm dev', cwd: '/a', shell: 'auto' }, storage)
    const { spawned, spawn } = createSpawner()
    const reviver = createTerminalReviver(spawn, storage)

    notePageUnloading()
    reviver.dispose()

    // The headless socket is released, but the record survives for the next
    // launch because forget is a no-op once unload has begun.
    expect(spawned[0].session.dispose).toHaveBeenCalledTimes(1)
    expect(readRunningCommand('s:t-1', storage)?.command).toBe('pnpm dev')
  })
})
