// Revive records for the Codex terminal.
//
// The host kills every PTY when the app quits (its session table is
// in-process memory), so nothing about a terminal survives — except the one
// thing this module persists: the foreground command that was still running,
// keyed by the official tab identity (`${sessionId}:${tab.id}`). The next app
// launch replays exactly that command in its recorded directory; scrollback
// and finished commands are deliberately NOT restored.
//
// Deletion follows explicit user outcomes only: the command completed, the
// shell exited, a full-screen program took over (vim/less/htop never revive),
// or the tab was closed while the page stays alive. Once page unload begins
// every mutation becomes a no-op, so quitting the app — even through a path
// that aborts tab signals or disposes the feature — leaves the record intact
// for the next launch. A crash runs no JS at all, which trivially keeps it.

import type { TerminalShell } from '../../../shared/config'

/** One still-running foreground command bound to an official tab identity. */
export interface RunningCommandRecord {
  command: string
  /** Empty means the login shell's default directory. */
  cwd: string
  shell: TerminalShell
  startedAt: number
}

export interface RunningCommandInput {
  command: string
  cwd: string
  shell: TerminalShell
  startedAt?: number
}

/** Minimal key/value backend so tests can substitute an in-memory map. */
export interface RunningCommandStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const RUNNING_COMMAND_STORAGE_KEY = 'dsh-codex.terminal.running-commands'
export const MAX_RUNNING_COMMAND_RECORDS = 40

const TERMINAL_SHELLS: readonly TerminalShell[] = ['auto', 'bash', 'zsh']

let pageUnloading = false
let unloadGuardInstalled = false

/** Mark the page as unloading: from here on, records may not be deleted. */
export function notePageUnloading(): void {
  pageUnloading = true
}

/** Test hook — production never returns to a "page alive" state. */
export function resetPageUnloadingForTest(): void {
  pageUnloading = false
}

function installUnloadGuard(): void {
  if (unloadGuardInstalled || typeof window === 'undefined') return
  unloadGuardInstalled = true
  // Capture phase, registered at module load: the flag must be set before any
  // tab-signal abort or feature disposal that a quit might trigger later.
  window.addEventListener('beforeunload', notePageUnloading, { capture: true })
  window.addEventListener('pagehide', notePageUnloading, { capture: true })
}

installUnloadGuard()

/**
 * True when this page load is a reload. The host keeps a detached PTY alive
 * under a grace timer, so after a reload the recorded command is still
 * running in the orphaned session and must not be replayed as a duplicate.
 */
export function isPageReload(): boolean {
  try {
    if (typeof performance === 'undefined') return false
    const entries = performance.getEntriesByType('navigation')
    const navigation = entries[0] as PerformanceNavigationTiming | undefined
    return navigation?.type === 'reload'
  } catch {
    return false
  }
}

/** Only a real foreground command is revivable — never blanks or `clear`. */
export function isRevivableCommand(command: string): boolean {
  const trimmed = command.trim()
  return trimmed !== '' && trimmed !== 'clear'
}

const memoryFallback = new Map<string, string>()

function defaultStorage(): RunningCommandStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Sandboxed frame without storage access: fall through to memory.
  }
  return {
    getItem: key => memoryFallback.get(key) ?? null,
    setItem: (key, value) => {
      memoryFallback.set(key, value)
    },
  }
}

// Shape-checked rather than trusted: this is user-writable localStorage, and
// a malformed entry must degrade to "nothing to revive" instead of replaying
// garbage into a shell.
function parseRecord(value: unknown): RunningCommandRecord | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.command !== 'string' || !isRevivableCommand(candidate.command)) return null
  const shell = TERMINAL_SHELLS.includes(candidate.shell as TerminalShell)
    ? (candidate.shell as TerminalShell)
    : 'auto'
  return {
    command: candidate.command,
    cwd: typeof candidate.cwd === 'string' ? candidate.cwd : '',
    shell,
    startedAt: typeof candidate.startedAt === 'number' ? candidate.startedAt : 0,
  }
}

function parseAll(raw: string | null): Record<string, RunningCommandRecord> {
  if (raw === null) return {}
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value === null || typeof value !== 'object' || value.version !== 1) return {}
    const commands = value.commands
    if (commands === null || typeof commands !== 'object') return {}
    const out: Record<string, RunningCommandRecord> = {}
    for (const [key, entry] of Object.entries(commands as Record<string, unknown>)) {
      if (key === '') continue
      const record = parseRecord(entry)
      if (record !== null) out[key] = record
    }
    return out
  } catch {
    return {}
  }
}

function loadAll(storage: RunningCommandStorage): Record<string, RunningCommandRecord> {
  try {
    return parseAll(storage.getItem(RUNNING_COMMAND_STORAGE_KEY))
  } catch {
    // Private mode / disabled storage: no revive, but the session stays usable.
    return {}
  }
}

function commitAll(
  commands: Record<string, RunningCommandRecord>,
  storage: RunningCommandStorage,
): void {
  // Evict the oldest beyond the cap: a tab whose identity never comes back
  // leaks its entry, and localStorage must not grow without bound.
  const kept = Object.entries(commands)
    .sort((a, b) => b[1].startedAt - a[1].startedAt)
    .slice(0, MAX_RUNNING_COMMAND_RECORDS)
  try {
    storage.setItem(
      RUNNING_COMMAND_STORAGE_KEY,
      JSON.stringify({ version: 1, commands: Object.fromEntries(kept) }),
    )
  } catch {
    // Storage unavailable: the terminal keeps working for this session.
  }
}

/** Every recorded command, keyed by official tab identity. */
export function listRunningCommands(
  storage: RunningCommandStorage = defaultStorage(),
): Array<[string, RunningCommandRecord]> {
  return Object.entries(loadAll(storage))
}

/** The record for one official tab identity, or null when nothing revives. */
export function readRunningCommand(
  terminalId: string,
  storage: RunningCommandStorage = defaultStorage(),
): RunningCommandRecord | null {
  return loadAll(storage)[terminalId] ?? null
}

/**
 * Persist a foreground command the moment it starts. Non-revivable input
 * (blank, `clear`) is dropped; during page unload this is a no-op.
 */
export function rememberRunningCommand(
  terminalId: string,
  input: RunningCommandInput,
  storage: RunningCommandStorage = defaultStorage(),
): void {
  if (pageUnloading || !isRevivableCommand(input.command)) return
  const commands = loadAll(storage)
  commands[terminalId] = {
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    startedAt: input.startedAt ?? Date.now(),
  }
  commitAll(commands, storage)
}

/**
 * Delete a record on an explicit user outcome (command finished, shell
 * exited, full-screen program took over, tab closed). A no-op once page
 * unload has begun, so an app quit always leaves the record for next launch.
 */
export function forgetRunningCommand(
  terminalId: string,
  storage: RunningCommandStorage = defaultStorage(),
): void {
  if (pageUnloading) return
  const commands = loadAll(storage)
  if (!(terminalId in commands)) return
  delete commands[terminalId]
  commitAll(commands, storage)
}
