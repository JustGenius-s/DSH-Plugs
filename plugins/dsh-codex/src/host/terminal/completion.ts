import { readdir, stat } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import type { TerminalCompletionCandidate } from '../../shared/terminal-protocol'
import { specOptions } from './specs'
import { environmentValue, type TerminalShellKind } from './shell'

const COMMAND_CACHE_TTL_MS = 30_000
const MAX_CANDIDATES = 100
const SHELL_BUILTINS = [
  'alias', 'bg', 'bindkey', 'break', 'builtin', 'cd', 'command', 'compgen',
  'continue', 'dirs', 'disown', 'echo', 'eval', 'exec', 'exit', 'export',
  'false', 'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill',
  'popd', 'printf', 'pushd', 'pwd', 'read', 'readonly', 'return', 'set',
  'shift', 'source', 'suspend', 'test', 'times', 'trap', 'true', 'type',
  'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait', 'whence', 'where',
  'which',
]
/** PowerShell is case-insensitive and hyphenated; POSIX builtins do not apply. */
const POWERSHELL_BUILTINS = [
  'Get-ChildItem', 'Get-Location', 'Set-Location', 'Get-Content', 'Set-Content',
  'Get-Command', 'Get-Help', 'Get-History', 'Get-Process', 'Stop-Process',
  'Write-Output', 'Write-Host', 'Select-Object', 'Select-String', 'Where-Object',
  'ForEach-Object', 'Test-Path', 'New-Item', 'Copy-Item', 'Move-Item', 'Remove-Item',
  'Get-Item', 'Get-Date', 'Clear-Host', 'Resolve-Path', 'Start-Sleep',
  'cd', 'dir', 'ls', 'pwd', 'cat', 'type', 'echo', 'cls', 'clear', 'exit', 'help',
]

interface CompletionOption {
  value: string
  label: string
  kind: TerminalCompletionCandidate['kind']
  description?: string
}

export interface TerminalCompletionResult {
  start: number
  end: number
  replacement: string
  candidates: TerminalCompletionCandidate[]
}

interface TokenRange {
  start: number
  end: number
  raw: string
  quote: "'" | '"' | null
}

const commandCache = new Map<string, { expiresAt: number; names: string[] }>()

export async function completeTerminalInput(
  input: string,
  cursor: number,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  shell: TerminalShellKind = 'bash',
): Promise<TerminalCompletionResult> {
  const safeCursor = Math.max(0, Math.min(input.length, Math.floor(cursor)))
  const token = tokenAt(input, safeCursor, shell)
  const query = decodeToken(token.raw, shell)
  const commandPosition = isCommandPosition(input, token.start)
  const pathLike = query.includes('/') || query.startsWith('.') || query.startsWith('~')
    || (shell === 'powershell' && (query.includes('\\') || /^[a-z]:/i.test(query)))
  let options: CompletionOption[]
  if (query.startsWith('$')) {
    options = envOptions(query, env, shell)
  } else if (commandPosition && !pathLike) {
    options = await commandOptions(query, env, shell)
  } else {
    const commandTokens = decodeTokens(input, token.start, shell)
    const fromSpec = specOptions(commandTokens, query)
    if (fromSpec.length > 0) {
      options = fromSpec
    } else {
      // PowerShell has no HOME; USERPROFILE is the user's profile directory.
      const home = process.platform === 'win32' && shell === 'powershell'
        ? environmentValue(env, 'USERPROFILE') ?? environmentValue(env, 'HOME')
        : environmentValue(env, 'HOME') ?? environmentValue(env, 'USERPROFILE')
      options = await pathOptions(query, cwd, home, shell)
    }
  }

  if (options.length === 0) {
    return { start: token.start, end: token.end, replacement: token.raw, candidates: [] }
  }

  const limited = options.slice(0, MAX_CANDIDATES)
  const common = commonPrefix(limited.map((option) => option.value))
  const candidates = limited.map((option) => ({
    label: option.label,
    replacement: encodeToken(option.value, token.quote, option.kind !== 'directory', option.kind, shell),
    kind: option.kind,
    description: option.description,
  }))
  const replacement = options.length === 1
    ? candidates[0].replacement
    : encodeToken(common, token.quote, false, limited[0]?.kind, shell)

  return { start: token.start, end: token.end, replacement, candidates }
}

function tokenAt(input: string, cursor: number, shell: TerminalShellKind): TokenRange {
  let start = 0
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = 0; index < cursor; index += 1) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === (shell === 'powershell' ? '`' : '\\') && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (isTokenBreak(char)) start = index + 1
  }

  let end = cursor
  let endQuote = quote
  escaped = false
  while (end < input.length) {
    const char = input[end]
    if (escaped) {
      escaped = false
      end += 1
      continue
    }
    if (char === (shell === 'powershell' ? '`' : '\\') && endQuote !== "'") {
      escaped = true
      end += 1
      continue
    }
    if (endQuote !== null) {
      if (char === endQuote) endQuote = null
      end += 1
      continue
    }
    if (char === "'" || char === '"') {
      endQuote = char
      end += 1
      continue
    }
    if (isTokenBreak(char)) break
    end += 1
  }

  const raw = input.slice(start, cursor)
  const opening = raw.startsWith("'") ? "'" : raw.startsWith('"') ? '"' : null
  return { start, end, raw, quote: opening }
}

function isTokenBreak(char: string): boolean {
  return /\s/.test(char) || ';|&()<>'.includes(char)
}

function isCommandPosition(input: string, tokenStart: number): boolean {
  const before = input.slice(0, tokenStart).trimEnd()
  return before.length === 0 || ';|&(\n'.includes(before.at(-1) ?? '')
}

function decodeTokens(input: string, end: number, shell: TerminalShellKind): string[] {
  const tokens: string[] = []
  let start = -1
  let quote: "'" | '"' | null = null
  let escaped = false
  const flush = (index: number) => {
    if (start !== -1 && index > start) tokens.push(decodeToken(input.slice(start, index), shell))
    start = -1
  }
  for (let index = 0; index < end; index += 1) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === (shell === 'powershell' ? '`' : '\\') && quote !== "'") {
      escaped = true
      if (start === -1) start = index
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      if (start === -1) start = index
      continue
    }
    if (isTokenBreak(char)) {
      flush(index)
      continue
    }
    if (start === -1) start = index
  }
  flush(end)
  return tokens
}

function decodeToken(raw: string, shell: TerminalShellKind): string {
  let output = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (escaped) {
      output += char
      escaped = false
      continue
    }
    if (char === (shell === 'powershell' ? '`' : '\\') && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== null) {
      // PowerShell escapes a single quote inside a single-quoted string by
      // doubling it; POSIX cannot escape it at all.
      if (shell === 'powershell' && quote === "'" && char === "'" && raw[index + 1] === "'") {
        output += "'"
        index++
        continue
      }
      if (char === quote) quote = null
      else output += char
      continue
    }
    if (char === "'" || char === '"') quote = char
    else output += char
  }
  if (escaped) output += shell === 'powershell' ? '`' : '\\'
  return output
}

function envOptions(prefix: string, env: NodeJS.ProcessEnv, shell: TerminalShellKind): CompletionOption[] {
  if (shell === 'powershell') {
    return [...Object.keys(env).map(name => '$env:' + name), '$HOME', '$PWD', '$true', '$false', '$null']
      .filter(name => name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map(value => ({ value, label: value, kind: 'variable' }))
  }
  const needle = prefix.startsWith('$') ? prefix.slice(1) : prefix
  return Object.keys(env)
    .filter((name) => name.startsWith(needle))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_CANDIDATES)
    .map((name) => ({ value: '$' + name, label: '$' + name, kind: 'variable' }))
}

async function commandOptions(
  prefix: string,
  env: NodeJS.ProcessEnv,
  shell: TerminalShellKind,
): Promise<CompletionOption[]> {
  const names = await commandNames(env, shell)
  return names
    .filter((name) => shell === 'powershell'
      ? name.toLowerCase().startsWith(prefix.toLowerCase())
      : name.startsWith(prefix))
    .map((name) => ({ value: name, label: name, kind: 'command' }))
}

async function commandNames(env: NodeJS.ProcessEnv, shell: TerminalShellKind): Promise<string[]> {
  const pathValue = environmentValue(env, 'PATH') ?? ''
  const extensions = (environmentValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')
  const cacheKey = JSON.stringify([pathValue, extensions, shell])
  const cached = commandCache.get(cacheKey)
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.names

  const directories = [...new Set(pathValue.split(delimiter).filter((entry) => entry.length > 0))]
  const batches = await Promise.all(directories.map(async (directory) => {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      // Windows lists executables by file name; strip PATHEXT so completions
      // read like the typed command instead of `git.exe`.
      return entries.filter((entry) => !entry.isDirectory())
        .filter(entry => process.platform !== 'win32'
          || extensions.some(ext => entry.name.toLowerCase().endsWith(ext))
          || (shell === 'powershell' && entry.name.toLowerCase().endsWith('.ps1')))
        .map(entry => process.platform === 'win32' ? entry.name.replace(/\.(exe|com|cmd|bat)$/i, '') : entry.name)
    } catch {
      return []
    }
  }))
  const builtins = shell === 'powershell' ? POWERSHELL_BUILTINS : SHELL_BUILTINS
  const names = [...new Set([...builtins, ...batches.flat()])].sort((a, b) => a.localeCompare(b))
  commandCache.set(cacheKey, { expiresAt: Date.now() + COMMAND_CACHE_TTL_MS, names })
  return names
}

async function pathOptions(
  query: string,
  cwd: string,
  home: string | undefined,
  shell: TerminalShellKind,
): Promise<CompletionOption[]> {
  if (query === '~' && home !== undefined) {
    return [{ value: '~/', label: '~/', kind: 'directory' }]
  }

  const windows = shell === 'powershell' && process.platform === 'win32'
  const slash = Math.max(query.lastIndexOf('/'), windows ? query.lastIndexOf('\\') : -1)
  const directoryPrefix = slash === -1 ? '' : query.slice(0, slash + 1)
  const namePrefix = slash === -1 ? query : query.slice(slash + 1)
  let lookupDirectory: string
  if (directoryPrefix === '~/' || (windows && directoryPrefix === '~\\')) {
    if (home === undefined) return []
    lookupDirectory = home
  } else if (directoryPrefix.startsWith('~/') || (windows && directoryPrefix.startsWith('~\\'))) {
    if (home === undefined) return []
    lookupDirectory = resolve(home, directoryPrefix.slice(2))
  } else {
    lookupDirectory = resolve(cwd, directoryPrefix || '.')
  }

  try {
    const entries = await readdir(lookupDirectory, { withFileTypes: true })
    const visible = entries.filter((entry) => {
      if (!(windows
        ? entry.name.toLowerCase().startsWith(namePrefix.toLowerCase())
        : entry.name.startsWith(namePrefix))) return false
      return namePrefix.startsWith('.') || !entry.name.startsWith('.')
    })
    const options = await Promise.all(visible.map(async (entry): Promise<CompletionOption> => {
      let isDirectory = entry.isDirectory()
      if (!isDirectory && entry.isSymbolicLink()) {
        isDirectory = await stat(join(lookupDirectory, entry.name))
          .then((value) => value.isDirectory())
          .catch(() => false)
      }
      const separator = windows && query.includes('\\') ? '\\' : '/'
      const value = directoryPrefix + entry.name + (isDirectory ? separator : '')
      return { value, label: value, kind: isDirectory ? 'directory' : 'file' }
    }))
    return options.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  } catch {
    return []
  }
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    let length = 0
    while (length < prefix.length && length < value.length && prefix[length] === value[length]) length += 1
    prefix = prefix.slice(0, length)
    if (prefix.length === 0) break
  }
  return prefix
}

function encodeToken(
  value: string,
  quote: "'" | '"' | null,
  finalize: boolean,
  kind?: TerminalCompletionCandidate['kind'],
  shell: TerminalShellKind = 'bash',
): string {
  if (shell === 'powershell') {
    // A variable never needs quoting. Otherwise reuse the quote the user is
    // already inside, and fall back to single quotes because PowerShell treats
    // backslash as a literal path separator, not an escape.
    if (kind === 'variable') return value + (finalize ? ' ' : '')
    if (quote === '"') return '"' + value.replace(/[`"$]/g, '`$&') + (finalize ? '" ' : '')
    if (quote === "'" || /[\s'"`$&|;()<>*?\[\]{}]/.test(value)) {
      return "'" + value.replaceAll("'", "''") + (finalize ? "' " : '')
    }
    return value + (finalize ? ' ' : '')
  }
  if (quote === "'") {
    const escaped = value.replaceAll("'", "'\\''")
    return "'" + escaped + (finalize ? "' " : '')
  }
  if (quote === '"') {
    const escaped = value.replace(/[\\"$`]/g, '\\$&')
    return '"' + escaped + (finalize ? '" ' : '')
  }
  const pattern = kind === 'variable'
    ? /[\s\\"'`!&|;()<>*?\[\]{}]/g
    : /[\s\\"'`$!&|;()<>*?\[\]{}]/g
  const escaped = value.replace(pattern, '\\$&')
  return escaped + (finalize ? ' ' : '')
}
