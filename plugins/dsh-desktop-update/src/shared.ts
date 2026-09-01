// Contract shared by both halves of @just-genius/dsh-desktop-update.
//
// The Host half owns update DETECTION (it runs in the dsh web host's Node
// process, where a plain `fetch` reaches GitHub Releases and the npm registry
// without CORS, and where it keeps running with no window open). It publishes
// results on the same-origin routes below; the browser half polls them.
//
// DSH-Desktop (the shell) detects nothing anymore. It is an EXECUTOR: it knows
// its own packaged version, runs `pnpm add` for the runtime, opens the download
// page, and relaunches. The browser half is the only place that can reach both
// sides, so it shuttles the two things neither half can do for itself:
//
//   the shell's version  → POST VERSION_PATH  (detection needs it)
//   an execute outcome   → POST EXEC_PATH     (so progress is shared)
//
// In a plain browser there is no shell: `shell` is false, `versions.app` is
// empty, and the app half of detection plus every execute sit out. Detection of
// the DSH runtime still works.

/** Same-origin routes registered by the Host half. */
export const STATE_PATH = '/dsh-desktop-update/state'
export const CHECK_PATH = '/dsh-desktop-update/check'
export const VERSION_PATH = '/dsh-desktop-update/version'
export const EXEC_PATH = '/dsh-desktop-update/exec'
export const SKIP_PATH = '/dsh-desktop-update/skip'

/** DSH runtime update channel: npm dist-tag, or an exact-version pin. */
export type DshChannel = 'latest' | 'next' | 'alpha' | 'custom'

/** Which of the two updatables an operation targets. */
export type DesktopUpdateKind = 'app' | 'dsh'

/** One available update; `null` on the state means "nothing pending". */
export interface DesktopUpdateInfo {
  current: string
  latest: string
  /** Download entry (GitHub Releases). Present for `app` only. */
  url?: string
}

/** User-togglable gates for the two background checks. */
export interface DesktopUpdateConfig {
  checkApp: boolean
  checkDsh: boolean
  dshChannel?: DshChannel
  dshVersion?: string
}

/**
 * The state the Host half serves and the browser half renders.
 *
 * A read of `STATE_PATH` is a snapshot of the last detection round; the Host
 * refreshes it on its own interval, after `CHECK_PATH`, and whenever the
 * settings namespace changes.
 */
export interface DesktopUpdateState {
  app: DesktopUpdateInfo | null
  dsh: DesktopUpdateInfo | null
  /** A detection round is in flight. */
  checking: boolean
  /** The shell is running `pnpm add @deepseek-ai/dsh@…`. */
  updatingDsh: boolean
  /** Progress/result copy from the last execute; null when idle. */
  updateMessage: string | null
  /** A new runtime is installed and needs a relaunch to take effect. */
  needsRelaunch: boolean
  /** The config the last detection round ran with. */
  config: DesktopUpdateConfig
  /** Installed versions. `app` comes from the shell, `dsh` from the Host. */
  versions: { app: string; dsh: string | null }
  /** Whether a desktop shell is attached (false in a plain browser). */
  shell: boolean
}

/**
 * What the browser half reports after driving an execute through the shell.
 * `start` / `done` / `error` mirror the phases of `pnpm add`, which takes long
 * enough that progress has to survive a page reload.
 */
export type DesktopExecReport =
  | { phase: 'start'; version: string }
  | { phase: 'done'; version: string }
  | { phase: 'error'; message: string }

/** Response envelope shared by every write route. */
export interface DesktopUpdateResult {
  ok: boolean
  state?: DesktopUpdateState
  error?: string
}

/** State served before the first detection round resolves. */
export const EMPTY_STATE: DesktopUpdateState = {
  app: null,
  dsh: null,
  checking: false,
  updatingDsh: false,
  updateMessage: null,
  needsRelaunch: false,
  config: { checkApp: true, checkDsh: true, dshChannel: 'latest', dshVersion: '' },
  versions: { app: '', dsh: null },
  shell: false,
}
