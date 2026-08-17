import { readdir, stat } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import type { TerminalCompletionCandidate } from '../../shared/terminal-protocol'

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

interface CompletionOption {
  value: string
  label: string
  kind: TerminalCompletionCandidate['kind']
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
): Promise<TerminalCompletionResult> {
  const safeCursor = Math.max(0, Math.min(input.length, Math.floor(cursor)))
  const token = tokenAt(input, safeCursor)
  const query = decodeToken(token.raw)
  const commandPosition = isCommandPosition(input, token.start)
  const pathMode = !commandPosition || query.includes('/') || query.startsWith('.') || query.startsWith('~')
  const options = pathMode
    ? await pathOptions(query, cwd, env.HOME)
    : await commandOptions(query, env.PATH)

  if (options.length === 0) {
    return { start: token.start, end: token.end, replacement: token.raw, candidates: [] }
  }

  const limited = options.slice(0, MAX_CANDIDATES)
  const common = commonPrefix(limited.map((option) => option.value))
  const candidates = limited.map((option) => ({
    label: option.label,
    replacement: encodeToken(option.value, token.quote, option.kind !== 'directory'),
    kind: option.kind,
  }))
  const replacement = options.length === 1
    ? candidates[0].replacement
    : encodeToken(common, token.quote, false)

  return { start: token.start, end: token.end, replacement, candidates }
}

function tokenAt(input: string, cursor: number): TokenRange {
  let start = 0
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = 0; index < cursor; index += 1) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
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
    if (char === '\\' && endQuote !== "'") {
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

function decodeToken(raw: string): string {
  let output = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const char of raw) {
    if (escaped) {
      output += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      else output += char
      continue
    }
    if (char === "'" || char === '"') quote = char
    else output += char
  }
  if (escaped) output += '\\'
  return output
}

async function commandOptions(prefix: string, pathValue: string | undefined): Promise<CompletionOption[]> {
  const names = await commandNames(pathValue)
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ value: name, label: name, kind: 'command' }))
}

async function commandNames(pathValue: string | undefined): Promise<string[]> {
  const cacheKey = pathValue ?? ''
  const cached = commandCache.get(cacheKey)
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.names

  const directories = [...new Set(cacheKey.split(delimiter).filter((entry) => entry.length > 0))]
  const batches = await Promise.all(directories.map(async (directory) => {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
  }))
  const names = [...new Set([...SHELL_BUILTINS, ...batches.flat()])].sort((a, b) => a.localeCompare(b))
  commandCache.set(cacheKey, { expiresAt: Date.now() + COMMAND_CACHE_TTL_MS, names })
  return names
}

async function pathOptions(query: string, cwd: string, home: string | undefined): Promise<CompletionOption[]> {
  if (query === '~' && home !== undefined) {
    return [{ value: '~/', label: '~/', kind: 'directory' }]
  }

  const slash = query.lastIndexOf('/')
  const directoryPrefix = slash === -1 ? '' : query.slice(0, slash + 1)
  const namePrefix = slash === -1 ? query : query.slice(slash + 1)
  let lookupDirectory: string
  if (directoryPrefix === '~/') {
    if (home === undefined) return []
    lookupDirectory = home
  } else if (directoryPrefix.startsWith('~/')) {
    if (home === undefined) return []
    lookupDirectory = resolve(home, directoryPrefix.slice(2))
  } else {
    lookupDirectory = resolve(cwd, directoryPrefix || '.')
  }

  try {
    const entries = await readdir(lookupDirectory, { withFileTypes: true })
    const visible = entries.filter((entry) => {
      if (!entry.name.startsWith(namePrefix)) return false
      return namePrefix.startsWith('.') || !entry.name.startsWith('.')
    })
    const options = await Promise.all(visible.map(async (entry): Promise<CompletionOption> => {
      let isDirectory = entry.isDirectory()
      if (!isDirectory && entry.isSymbolicLink()) {
        isDirectory = await stat(join(lookupDirectory, entry.name))
          .then((value) => value.isDirectory())
          .catch(() => false)
      }
      const value = directoryPrefix + entry.name + (isDirectory ? '/' : '')
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

function encodeToken(value: string, quote: "'" | '"' | null, finalize: boolean): string {
  if (quote === "'") {
    const escaped = value.replaceAll("'", "'\\''")
    return "'" + escaped + (finalize ? "' " : '')
  }
  if (quote === '"') {
    const escaped = value.replace(/[\\"$`]/g, '\\$&')
    return '"' + escaped + (finalize ? '" ' : '')
  }
  const escaped = value.replace(/[\s\\"'`$!&|;()<>*?\[\]{}]/g, '\\$&')
  return escaped + (finalize ? ' ' : '')
}
