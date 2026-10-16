import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetRunningCommand,
  isRevivableCommand,
  MAX_RUNNING_COMMAND_RECORDS,
  notePageUnloading,
  readRunningCommand,
  rememberRunningCommand,
  resetPageUnloadingForTest,
  RUNNING_COMMAND_STORAGE_KEY,
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

afterEach(() => resetPageUnloadingForTest())

describe('isRevivableCommand', () => {
  it('rejects blank commands and a bare clear', () => {
    expect(isRevivableCommand('')).toBe(false)
    expect(isRevivableCommand('   ')).toBe(false)
    expect(isRevivableCommand('clear')).toBe(false)
    expect(isRevivableCommand('  clear  ')).toBe(false)
  })

  it('keeps real commands, including a compound containing clear', () => {
    expect(isRevivableCommand('pnpm dev')).toBe(true)
    expect(isRevivableCommand('clear; ls')).toBe(true)
  })
})

describe('running-command store', () => {
  it('round-trips a record for one official tab identity', () => {
    const storage = createStorage()
    rememberRunningCommand(
      'session-1:tab-1',
      { command: 'pnpm dev', cwd: '/repo', shell: 'zsh' },
      storage,
    )
    expect(readRunningCommand('session-1:tab-1', storage)).toEqual({
      command: 'pnpm dev',
      cwd: '/repo',
      shell: 'zsh',
      startedAt: expect.any(Number),
    })
    expect(readRunningCommand('session-1:tab-2', storage)).toBeNull()
  })

  it('never stores blank or clear commands', () => {
    const storage = createStorage()
    rememberRunningCommand('tab-1', { command: '   ', cwd: '', shell: 'auto' }, storage)
    rememberRunningCommand('tab-1', { command: 'clear', cwd: '', shell: 'auto' }, storage)
    expect(readRunningCommand('tab-1', storage)).toBeNull()
  })

  it('forgets only the named tab', () => {
    const storage = createStorage()
    rememberRunningCommand('tab-1', { command: 'one', cwd: '', shell: 'auto' }, storage)
    rememberRunningCommand('tab-2', { command: 'two', cwd: '', shell: 'auto' }, storage)
    forgetRunningCommand('tab-1', storage)
    expect(readRunningCommand('tab-1', storage)).toBeNull()
    expect(readRunningCommand('tab-2', storage)?.command).toBe('two')
  })

  it('drops malformed payloads instead of replaying them', () => {
    const storage = createStorage()
    storage.setItem(RUNNING_COMMAND_STORAGE_KEY, 'not json')
    expect(readRunningCommand('tab-1', storage)).toBeNull()
    storage.setItem(RUNNING_COMMAND_STORAGE_KEY, JSON.stringify({ version: 99, commands: {} }))
    expect(readRunningCommand('tab-1', storage)).toBeNull()
  })

  it('keeps well-formed entries when siblings are malformed', () => {
    const storage = createStorage()
    storage.setItem(
      RUNNING_COMMAND_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        commands: {
          good: { command: 'pnpm dev', cwd: '/repo', shell: 'bash', startedAt: 1 },
          blank: { command: '   ', cwd: '', shell: 'auto', startedAt: 2 },
          cleared: { command: 'clear', cwd: '', shell: 'auto', startedAt: 3 },
          wrongShape: 42,
          wrongShell: { command: 'ls', cwd: '', shell: 'fish', startedAt: 4 },
        },
      }),
    )
    expect(readRunningCommand('good', storage)?.shell).toBe('bash')
    expect(readRunningCommand('blank', storage)).toBeNull()
    expect(readRunningCommand('cleared', storage)).toBeNull()
    expect(readRunningCommand('wrongShape', storage)).toBeNull()
    // Unknown shell names degrade to 'auto' rather than dropping the command.
    expect(readRunningCommand('wrongShell', storage)?.shell).toBe('auto')
  })

  it('evicts the oldest records beyond the cap', () => {
    const storage = createStorage()
    for (let index = 0; index < MAX_RUNNING_COMMAND_RECORDS + 5; index += 1) {
      rememberRunningCommand(
        `tab-${index}`,
        { command: `cmd-${index}`, cwd: '', shell: 'auto', startedAt: index },
        storage,
      )
    }
    expect(readRunningCommand('tab-0', storage)).toBeNull()
    expect(readRunningCommand('tab-4', storage)).toBeNull()
    expect(readRunningCommand('tab-5', storage)?.command).toBe('cmd-5')
  })

  it('keeps every record once page unload has begun', () => {
    const storage = createStorage()
    rememberRunningCommand('tab-1', { command: 'pnpm dev', cwd: '/repo', shell: 'auto' }, storage)
    notePageUnloading()
    forgetRunningCommand('tab-1', storage)
    expect(readRunningCommand('tab-1', storage)?.command).toBe('pnpm dev')
    rememberRunningCommand('tab-2', { command: 'late', cwd: '', shell: 'auto' }, storage)
    expect(readRunningCommand('tab-2', storage)).toBeNull()
  })
})
