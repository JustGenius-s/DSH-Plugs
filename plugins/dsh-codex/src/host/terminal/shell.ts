import { win32 } from 'node:path'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { TerminalShell } from '../../shared/config'

export type TerminalShellKind = 'powershell' | 'bash' | 'zsh'

export interface ShellEnvironment {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}

export function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name] ?? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

/** Both native Windows and POSIX paths occur in settings and test fixtures. */
export function terminalShellKind(executable: string): TerminalShellKind {
  const name = executable.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase().replace(/\.exe$/, '')
  if (name === 'pwsh' || name === 'powershell') return 'powershell'
  return name === 'zsh' ? 'zsh' : 'bash'
}

function windowsCandidates(shell: TerminalShell, env: NodeJS.ProcessEnv): string[] {
  const roots = [environmentValue(env, 'ProgramW6432'), environmentValue(env, 'ProgramFiles'), environmentValue(env, 'ProgramFiles(x86)')]
    .filter((root): root is string => Boolean(root))
  const system = environmentValue(env, 'SystemRoot') ?? environmentValue(env, 'WINDIR')
  const pwsh = ['pwsh.exe', ...roots.map(root => win32.join(root, 'PowerShell', '7', 'pwsh.exe'))]
  const powershell = ['powershell.exe', ...(system ? [win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')] : [])]
  if (shell === 'auto') return [...pwsh, ...powershell]
  if (shell === 'pwsh') return pwsh
  if (shell === 'powershell') return powershell
  if (shell === 'zsh') return ['zsh.exe']
  const local = environmentValue(env, 'LOCALAPPDATA')
  const gitRoots = [...roots.map(root => win32.join(root, 'Git')), ...(local ? [win32.join(local, 'Programs', 'Git')] : [])]
  return [...gitRoots.flatMap(root => [win32.join(root, 'bin', 'bash.exe'), win32.join(root, 'usr', 'bin', 'bash.exe')]), 'bash.exe']
}

/** Auto on Windows deliberately chooses a native PowerShell, independent of SHELL. */
export async function resolveTerminalShell(
  subprocess: Pick<Context['subprocess'], 'resolveExecutable'>,
  preference: TerminalShell,
  environment: ShellEnvironment = { platform: process.platform, env: process.env },
): Promise<string> {
  const { platform, env } = environment
  const candidates = platform === 'win32'
    ? windowsCandidates(preference, env)
    : preference === 'auto' ? [env.SHELL || (platform === 'darwin' ? 'zsh' : 'bash'), 'bash', 'zsh'] : [preference]
  // Git may be installed outside Program Files while only git.exe is on PATH.
  if (platform === 'win32' && preference === 'bash') {
    try {
      const git = await subprocess.resolveExecutable('git.exe')
      const root = win32.dirname(win32.dirname(git))
      candidates.unshift(win32.join(root, 'bin', 'bash.exe'), win32.join(root, 'usr', 'bin', 'bash.exe'))
    } catch { /* Standard install locations and PATH remain available. */ }
  }
  const failures: string[] = []
  for (const candidate of [...new Set(candidates)]) {
    try {
      const executable = await subprocess.resolveExecutable(candidate)
      if (platform === 'win32' && /[\\/](?:System32|Sysnative)[\\/]bash\.exe$/i.test(executable)) {
        throw new Error('Windows bash.exe is a WSL launcher; select an installed Git Bash instead')
      }
      return executable
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  const label = preference === 'auto' && platform === 'win32' ? 'PowerShell 7 or Windows PowerShell' : preference
  throw new Error(`${label} is unavailable. Select an installed shell in Codex settings. ${failures.at(-1) ?? ''}`)
}

/** Git Bash reports /c/... while the Node host needs C:\\... for files and Git. */
export function terminalWorkingDirectory(cwd: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return cwd
  const drive = /^\/(?:cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(cwd)
  if (drive) return win32.normalize(`${drive[1].toUpperCase()}:/${drive[2] ?? ''}`)
  return /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(cwd) ? win32.normalize(cwd) : cwd
}
