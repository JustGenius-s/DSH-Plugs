import { describe, expect, it, vi } from 'vitest'
import { parseTerminalShell } from '../src/shared/config'
import { resolveTerminalShell, terminalShellKind, terminalWorkingDirectory } from '../src/host/terminal/shell'
import { powerShellArguments, powerShellCommand } from '../src/host/terminal/powershell'
import { signalSubprocessTerminal } from '../src/host/adapters/subprocess-terminal'

function resolver(available: Record<string, string>) {
  return { resolveExecutable: vi.fn(async (command: string) => {
    if (available[command]) return available[command]
    throw new Error(`missing: ${command}`)
  }) }
}

describe('Windows terminal selection', () => {
  it('uses ConPTY input for Ctrl+C while keeping POSIX foreground signalling', async () => {
    const handle = { write: vi.fn(async (_input: string) => {}), signalForeground: vi.fn(async (_signal: string) => 1) }
    await signalSubprocessTerminal(handle, 'SIGINT', 'win32')
    expect(handle.write).toHaveBeenCalledWith('\x03')
    expect(handle.signalForeground).not.toHaveBeenCalled()
    await signalSubprocessTerminal(handle, 'SIGINT', 'linux')
    expect(handle.signalForeground).toHaveBeenCalledWith('SIGINT')
  })
  it('prefers PowerShell 7 even when SHELL points at Bash', async () => {
    const subprocess = resolver({ 'pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' })
    expect(await resolveTerminalShell(subprocess, 'auto', { platform: 'win32', env: { SHELL: '/bin/bash' } })).toContain('pwsh.exe')
    expect(subprocess.resolveExecutable).toHaveBeenCalledTimes(1)
  })

  it('finds native shells in standard folders when PATH is incomplete', async () => {
    const native = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const subprocess = resolver({ [native]: native })
    expect(await resolveTerminalShell(subprocess, 'auto', { platform: 'win32', env: { systemroot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' } })).toBe(native)
    expect(subprocess.resolveExecutable.mock.calls.flat()).not.toContain('bash')
  })

  it('resolves a custom Git installation before the system WSL launcher', async () => {
    const bash = 'D:\\Dev Tools\\Git\\bin\\bash.exe'
    const subprocess = resolver({ 'git.exe': 'D:\\Dev Tools\\Git\\cmd\\git.exe', [bash]: bash, 'bash.exe': 'C:\\Windows\\System32\\bash.exe' })
    expect(await resolveTerminalShell(subprocess, 'bash', { platform: 'win32', env: {} })).toBe(bash)
  })

  it('refuses WSL bash.exe and preserves explicit shell selection', async () => {
    const subprocess = resolver({ 'bash.exe': 'C:\\Windows\\System32\\bash.exe', 'pwsh.exe': 'pwsh.exe' })
    await expect(resolveTerminalShell(subprocess, 'bash', { platform: 'win32', env: {} })).rejects.toThrow('WSL launcher')
    expect(subprocess.resolveExecutable).not.toHaveBeenCalledWith('pwsh.exe')
  })

  it('keeps POSIX login shell selection and Bash fallback', async () => {
    const subprocess = resolver({ bash: '/bin/bash' })
    expect(await resolveTerminalShell(subprocess, 'auto', { platform: 'linux', env: { SHELL: '/missing/zsh' } })).toBe('/bin/bash')
  })

  it('recognizes executable suffixes and converts only MSYS drive paths', () => {
    expect(terminalShellKind('C:\\Tools\\pwsh.EXE')).toBe('powershell')
    expect(terminalShellKind('C:\\Git\\bin\\bash.exe')).toBe('bash')
    expect(terminalWorkingDirectory('/e/项目/My App', 'win32')).toBe('E:\\项目\\My App')
    expect(terminalWorkingDirectory('/cygdrive/c/Users/test', 'win32')).toBe('C:\\Users\\test')
    expect(terminalWorkingDirectory('C:/Users/test', 'win32')).toBe('C:\\Users\\test')
    expect(terminalWorkingDirectory('/etc/project', 'linux')).toBe('/etc/project')
    expect(parseTerminalShell('powershell')).toBe('powershell')
    expect(parseTerminalShell('pwsh.exe')).toBeUndefined()
  })

  it('carries Unicode, quotes and multiline commands without shell interpolation', () => {
    const command = "$name = '中文';\nWrite-Output \"$name `\"quoted`\"\""
    const bytes = powerShellCommand(command)
    const payload = /^\. __dsh_run '([A-Za-z0-9+/=]+)'\r$/.exec(bytes)?.[1]
    expect(Buffer.from(payload!, 'base64').toString('utf8')).toBe(command)
    const args = powerShellArguments()
    expect(args).not.toContain('-l')
    expect(args).toContain('-NoExit')
    expect(args).not.toContain('-NoProfile')
    expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toContain('function global:prompt')
  })
})
