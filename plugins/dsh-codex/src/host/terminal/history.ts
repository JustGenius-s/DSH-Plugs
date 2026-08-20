// Load and parse local shell history so the client can ghost-complete
// previously run commands, matching Warp's history-prefix autosuggestion.

import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'

const MAX_HISTORY = 2000
const ZSH_META = 0x83

/**
 * Read the user's shell history file and return commands oldest-first.
 * Newer commands are at the end so the client can scan from the tail.
 */
export async function loadShellHistory(shell: string): Promise<string[]> {
  const home = homedir()
  const files = historyFileCandidates(shell, home)
  for (const file of files) {
    try {
      const bytes = await readFile(file)
      const parsed = parseHistoryFile(file, bytes)
      if (parsed.length === 0) continue
      return parsed.length > MAX_HISTORY ? parsed.slice(parsed.length - MAX_HISTORY) : parsed
    } catch {
      // Missing or unreadable HISTFILE — try the next candidate.
    }
  }
  return []
}

export function historyFileCandidates(shell: string, home: string): string[] {
  const histfile = process.env.HISTFILE?.trim()
  const name = basename(shell).toLowerCase()
  const defaults = name.includes('zsh')
    ? [join(home, '.zsh_history'), join(home, '.zhistory')]
    : name.includes('fish')
      ? [join(home, '.local/share/fish/fish_history')]
      : name.includes('pwsh') || name.includes('powershell')
        ? [join(home, '.local/share/powershell/PSReadLine/ConsoleHost_history.txt')]
        : [join(home, '.bash_history')]
  if (histfile !== undefined && histfile.length > 0) {
    return [histfile, ...defaults.filter((file) => file !== histfile)]
  }
  if (name.includes('zsh') || name.includes('bash') || name.includes('fish')) return defaults
  return [
    join(home, '.zsh_history'),
    join(home, '.zhistory'),
    join(home, '.bash_history'),
    join(home, '.local/share/fish/fish_history'),
  ]
}

export function parseHistoryFile(file: string, bytes: Buffer): string[] {
  const lower = file.toLowerCase()
  if (lower.includes('zsh') || lower.endsWith('.zhistory')) return parseZshHistory(bytes)
  if (lower.includes('fish')) return parseFishHistory(bytes)
  return parseLineHistory(bytes)
}

function parseZshHistory(bytes: Buffer): string[] {
  const text = zshUnmetafy(bytes)
  const commands: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const commandPart = current.length === 0 ? stripZshExtendedPrefix(line) : line
    current += commandPart
    if (line.endsWith('\\')) {
      current = current.slice(0, -1) + '\n'
      continue
    }
    pushHistoryCommand(commands, current.trimEnd())
    current = ''
  }
  pushHistoryCommand(commands, current.trimEnd())
  return commands
}

function parseFishHistory(bytes: Buffer): string[] {
  const commands: string[] = []
  for (const line of bytes.toString('utf8').split('\n')) {
    const raw = line.startsWith('- cmd: ') ? line.slice(7) : undefined
    if (raw === undefined || raw.length === 0) continue
    pushHistoryCommand(commands, raw.replace(/\\n/g, '\n').replace(/\\"/g, '"'))
  }
  return commands
}

function parseLineHistory(bytes: Buffer): string[] {
  const commands: string[] = []
  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue
    pushHistoryCommand(commands, line)
  }
  return commands
}

function pushHistoryCommand(commands: string[], command: string): void {
  if (command.length === 0) return
  if (isInternalHistoryCommand(command)) return
  if (commands[commands.length - 1] === command) return
  commands.push(command)
}

/** Setup hooks and OSC probes that must not appear as Warp-style history ghosts. */
export function isInternalHistoryCommand(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed.length === 0) return true
  if (trimmed.includes('warp-block-end') || trimmed.includes('warp-node-version')) return true
  if (trimmed.includes('warp-caps')) return true
  if (trimmed.includes('dsh_block_mark')) return true
  if (trimmed === 'stty -echo') return true
  if (trimmed === 'export TERM=xterm-256color') return true
  if (trimmed === 'export COLORTERM=truecolor') return true
  if (trimmed === "export PS1=''" || trimmed === 'export PS1=""') return true
  if (trimmed === "export PS2=''" || trimmed === 'export PS2=""') return true
  if (trimmed === 'setopt HIST_IGNORE_SPACE' || trimmed === 'setopt hist_ignore_space') return true
  if (trimmed.startsWith('HISTCONTROL=') && trimmed.includes('ignorespace')) return true
  return false
}

function stripZshExtendedPrefix(line: string): string {
  if (!line.startsWith(': ')) return line
  const rest = line.slice(2)
  const semi = rest.indexOf(';')
  if (semi === -1) return line
  const prefix = rest.slice(0, semi)
  const colon = prefix.indexOf(':')
  if (colon === -1) return line
  const timestamp = prefix.slice(0, colon)
  const elapsed = prefix.slice(colon + 1)
  if (
    timestamp.length > 0 &&
    /^\d+$/.test(timestamp) &&
    elapsed.length > 0 &&
    /^\d+$/.test(elapsed)
  ) {
    return rest.slice(semi + 1)
  }
  return line
}

function zshUnmetafy(content: Uint8Array): string {
  if (content.length === 0) return ''
  const unmetafied: number[] = []
  let following = content[content.length - 1] ?? 0
  for (let index = content.length - 2; index >= 0; index -= 1) {
    const current = content[index] ?? 0
    if (current === ZSH_META) {
      following ^= 32
    } else {
      unmetafied.push(following)
      following = current
    }
  }
  unmetafied.push(following)
  unmetafied.reverse()
  return Buffer.from(unmetafied).toString('utf8')
}
