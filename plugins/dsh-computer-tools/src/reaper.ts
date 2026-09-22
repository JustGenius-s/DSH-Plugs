// Reap browser/MCP processes left behind by an abnormal DSH exit.
//
// Why this exists: the browser provider's lifecycle is session-owned — it closes
// its Chromium when the session's runtime is released. That path cannot run when
// the host is hard-killed (a reinstall or a force-quit), so the Chromium and the
// MCP server survive as orphans and the next boot finds its browser slot taken:
// new sessions then fail or come up without browser tools.
//
// The sweep runs once at host boot, which is exactly the moment a leftover from a
// previous run is unambiguously garbage — nothing from this run can exist yet.
// Matching is deliberately strict so a user's own Chrome can never be reaped:
// the executable must be a Chrome main binary, the profile must be Playwright's
// temp profile, and the parent must be gone.

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const PS_TIMEOUT_MS = 5000
const TERM_TIMEOUT_MS = 5000
const TERM_GRACE_MS = 1500

/** One row of `ps -eo pid=,ppid=,command=`. */
export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

/** What a sweep found and did. */
export interface ReapReport {
  /** Orphans matched by the rules below. */
  found: ReapTarget[]
  /** PIDs that exited after SIGTERM. */
  terminated: number[]
  /** PIDs that needed SIGKILL. */
  killed: number[]
  /** PIDs whose cleanup failed, with the reason. */
  failed: Array<{ pid: number; error: string }>
}

/** One process the sweep considers garbage, with why it matched. */
export interface ReapTarget {
  pid: number
  /** 'browser' for Chromium, 'mcp' for the Playwright MCP server. */
  kind: 'browser' | 'mcp'
  /** Short command excerpt for the diagnostic line. */
  detail: string
}

/**
 * Playwright's per-launch temp profile directory name. This is the marker that
 * separates a Playwright-owned Chromium from the user's own browser: the user's
 * Chrome has no such `--user-data-dir`.
 */
const PLAYWRIGHT_PROFILE = 'playwright_chromiumdev_profile-'

/** The MCP server entry this plugin's provider launches. */
const MCP_ENTRY = 'playwright/mcp/cli.js'

/** A Chromium child process rather than the browser the provider owns. */
const CHROME_CHILD = '--type='

/**
 * Parse `ps -eo pid=,ppid=,command=`. Exported for tests.
 *
 * The command is taken verbatim (it may contain spaces); only the two leading
 * numeric fields are interpreted, and a row without them is skipped rather than
 * guessed at.
 */
export function parsePsOutput(raw: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of raw.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    rows.push({ pid, ppid, command: match[3] ?? '' })
  }
  return rows
}

/**
 * Whether the command names a Chrome-family main binary (not a Helper child).
 *
 * The executable path can contain spaces (`/Applications/Google Chrome.app/…`),
 * so it is matched by suffix rather than by splitting on the first space.
 */
function isChromeMain(command: string): boolean {
  if (command.includes(CHROME_CHILD)) return false
  // The binary is followed by a space and its first flag (or ends the line).
  return /\/(Google Chrome|Chromium|Microsoft Edge)(\s|$)/.test(command)
}

/**
 * Whether a row is a Chromium the browser provider owns. Requires the
 * Playwright profile marker, so the user's own Chrome is never a candidate.
 */
export function isPlaywrightBrowser(row: ProcessRow): boolean {
  return isChromeMain(row.command) && row.command.includes(PLAYWRIGHT_PROFILE)
}

/** Whether a row is a Playwright MCP server process. */
export function isMcpServer(row: ProcessRow): boolean {
  return row.command.includes(MCP_ENTRY)
}

/**
 * Select the processes to reap from one `ps` snapshot.
 *
 * Two rules, both requiring the parent to be gone:
 * - an MCP server whose parent is no longer running (its host died), and
 * - a Playwright Chromium whose parent is no longer running (its MCP died).
 *
 * "Gone" means the parent is launchd (ppid 1 — the process was reparented when
 * its real parent exited) or the parent has no row in the snapshot. Checking
 * ppid 1 explicitly matters: launchd itself is normally present in the table, so
 * a bare membership test would read an orphan as having a live parent.
 *
 * A live parent means the process belongs to a current session and is left
 * alone, so a boot-time sweep cannot kill the session that is starting up.
 *
 * @param rows - the snapshot, expected to cover the whole user session.
 */
export function findOrphans(rows: readonly ProcessRow[]): ReapTarget[] {
  const byPid = new Map<number, ProcessRow>()
  for (const row of rows) byPid.set(row.pid, row)

  const parentGone = (row: ProcessRow): boolean =>
    row.ppid <= 1 || !byPid.has(row.ppid)

  const targets: ReapTarget[] = []
  for (const row of rows) {
    if (isMcpServer(row)) {
      if (!parentGone(row)) continue
      targets.push({ pid: row.pid, kind: 'mcp', detail: 'playwright/mcp' })
      continue
    }
    if (isPlaywrightBrowser(row)) {
      if (!parentGone(row)) continue
      targets.push({ pid: row.pid, kind: 'browser', detail: 'playwright chromium' })
    }
  }
  return targets
}

/** Read the process table. Never throws: an unusable `ps` yields no rows. */
export async function readProcessTable(
  run: () => Promise<string> = defaultRun,
): Promise<ProcessRow[]> {
  try {
    return parsePsOutput(await run())
  } catch {
    return []
  }
}

/**
 * Sweep orphans: match, SIGTERM, wait, then SIGKILL whatever survived.
 *
 * Only PIDs matched by {@link findOrphans} are ever signalled.
 */
export async function reapOrphans(input: {
  rows?: readonly ProcessRow[]
  /** Sends one signal to one pid; returns false when the pid is already gone. */
  signal?: (pid: number, signal: NodeJS.Signals) => boolean
  /** Sleep hook; injectable so tests do not pay the real grace period. */
  wait?: (ms: number) => Promise<void>
  isAlive?: (pid: number) => boolean
} = {}): Promise<ReapReport> {
  const rows = input.rows ?? await readProcessTable()
  const targets = findOrphans(rows)
  const report: ReapReport = { found: targets, terminated: [], killed: [], failed: [] }
  if (targets.length === 0) return report

  const signal = input.signal ?? defaultSignal
  const wait = input.wait ?? defaultWait
  const isAlive = input.isAlive ?? defaultIsAlive

  for (const target of targets) {
    try {
      signal(target.pid, 'SIGTERM')
    } catch (error) {
      report.failed.push({ pid: target.pid, error: messageOf(error) })
    }
  }

  await wait(TERM_GRACE_MS)

  for (const target of targets) {
    if (!isAlive(target.pid)) {
      report.terminated.push(target.pid)
      continue
    }
    try {
      signal(target.pid, 'SIGKILL')
    } catch (error) {
      report.failed.push({ pid: target.pid, error: messageOf(error) })
      continue
    }
    report.killed.push(target.pid)
  }

  return report
}

async function defaultRun(): Promise<string> {
  const { stdout } = await execFile('ps', ['-eo', 'pid=,ppid=,command='], { timeout: PS_TIMEOUT_MS })
  return stdout
}

function defaultSignal(pid: number, signal: NodeJS.Signals): boolean {
  return process.kill(pid, signal)
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function defaultIsAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering anything.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
