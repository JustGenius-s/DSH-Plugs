// Read-only probes of the local Cua Driver, plus the one corrective action the
// settings page needs: restarting the daemon.
//
// Why restart matters: a TCC grant does not retroactively apply to a process
// that is already running. If the daemon started before the user ticked the
// boxes it keeps reporting the pre-grant answer, which reads as "I granted it
// but it still fails". Only the driver's own CLI answers under the driver's
// bundle identity (com.trycua.driver); a check made from our process would
// report DSH's grants instead, so that CLI is the only authority used here.

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { CUA_DRIVER_APP } from './diagnose.ts'

const execFile = promisify(execFileCallback)

export type PermissionState = 'granted' | 'denied' | 'unknown'

export interface CuaPermissions {
  accessibility: PermissionState
  screenRecording: PermissionState
  /** Direct ScreenCaptureKit probe; 'not_checked' is the read-only default. */
  directCapture: string | null
  /** Bundle that holds the grants (com.trycua.driver). */
  bundleId: string | null
  /** PID of the daemon whose identity answered. */
  pid: number | null
}

export interface CuaDriverInfo {
  /** Null when the CLI could not be probed at all. */
  permissions: CuaPermissions | null
  running: boolean
  pid: number | null
  /** Probe failure text, surfaced to the user as a diagnostic. */
  error: string | null
}

export interface RestartOutcome {
  ok: boolean
  error: string | null
}

const PROBE_TIMEOUT_MS = 8000
/** The daemon needs a moment to release the socket before `open` takes over. */
const RESTART_SETTLE_MS = 1200

/**
 * Probe the Cua Driver's status and permissions. Never throws: a broken or
 * missing CLI yields `error` set with nulls, so the page still renders.
 */
export async function probeCuaDriver(input: {
  command: string
  run?: (file: string, args: readonly string[]) => Promise<string>
}): Promise<CuaDriverInfo> {
  const run = input.run ?? defaultRun

  let statusText: string
  try {
    statusText = await run(input.command, ['status'])
  } catch (error) {
    // `status` exits non-zero when no daemon is running, which is not an error
    // we should report as a probe failure — try permissions before giving up.
    const permissions = await readPermissions(input.command, run)
    if (permissions !== null) {
      return { permissions, running: false, pid: null, error: null }
    }
    return { permissions: null, running: false, pid: null, error: messageOf(error) }
  }

  const permissions = await readPermissions(input.command, run)
  const pid = parseDaemonPid(statusText)
  return {
    permissions,
    running: pid !== null,
    pid,
    error: permissions === null ? 'Cua Driver 返回了无法解析的权限状态' : null,
  }
}

async function readPermissions(
  command: string,
  run: (file: string, args: readonly string[]) => Promise<string>,
): Promise<CuaPermissions | null> {
  try {
    return parsePermissions(await run(command, ['permissions', 'status', '--json']))
  } catch {
    return null
  }
}

/**
 * Restart the daemon through LaunchServices. `open -a CuaDriver --args serve`
 * is the documented path: it keeps the daemon's TCC identity attached to
 * CuaDriver.app, which running the binary from a shell would not.
 */
export async function restartCuaDriver(input: {
  command: string
  run?: (file: string, args: readonly string[]) => Promise<string>
  wait?: (ms: number) => Promise<void>
}): Promise<RestartOutcome> {
  const run = input.run ?? defaultRun
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))

  try {
    // A not-running daemon makes `stop` fail; that is the state we want anyway.
    await run(input.command, ['stop']).catch(() => '')
    await wait(RESTART_SETTLE_MS)
    await run('open', ['-n', '-g', '-a', CUA_DRIVER_APP, '--args', 'serve'])
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Parse `permissions status --json`. Exported for tests. */
export function parsePermissions(raw: string): CuaPermissions | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const source = record.source !== null && typeof record.source === 'object'
    ? record.source as Record<string, unknown>
    : null
  return {
    accessibility: triState(record.accessibility),
    screenRecording: triState(record.screen_recording),
    directCapture: typeof record.direct_capture_status === 'string' ? record.direct_capture_status : null,
    bundleId: typeof source?.bundle_id === 'string' ? source.bundle_id : null,
    pid: typeof source?.pid === 'number' ? source.pid : null,
  }
}

function triState(value: unknown): PermissionState {
  if (value === true) return 'granted'
  if (value === false) return 'denied'
  return 'unknown'
}

/** Parse the daemon PID out of `cua-driver status`. Exported for tests. */
export function parseDaemonPid(raw: string): number | null {
  if (!/daemon is running/i.test(raw)) return null
  const match = /^\s*pid:\s*(\d+)\s*$/m.exec(raw)
  if (match === null) return null
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

async function defaultRun(file: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile(file, [...args], { timeout: PROBE_TIMEOUT_MS })
  return stdout
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
