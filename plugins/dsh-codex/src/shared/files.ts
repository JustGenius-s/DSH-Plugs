/** Same-origin routes for the files panel's host-side actions. */
export const CODEX_FILES_INFO_PATH = '/dsh-codex/files/info'
export const CODEX_FILES_REVEAL_PATH = '/dsh-codex/files/reveal'

/**
 * Host platform buckets the reveal action can name. `unknown` covers anything
 * without a probed file-manager opener, so the panel hides the row instead of
 * promising a gesture it cannot perform.
 */
export type CodexHostPlatform = 'darwin' | 'win32' | 'linux' | 'unknown'

export interface CodexFilesInfoOk {
  ok: true
  platform: CodexHostPlatform
  /** Whether this host has a file-manager opener for the reveal action. */
  revealSupported: boolean
}

export interface CodexFilesRevealRequest {
  cwd: string
  path: string
  kind: 'file' | 'dir'
}

export interface CodexFilesRevealOk {
  ok: true
}

export interface CodexFilesErr {
  ok: false
  code: 'no-cwd' | 'bad-request' | 'unsupported' | 'reveal'
  message: string
}

export type CodexFilesInfoResponse = CodexFilesInfoOk | CodexFilesErr
export type CodexFilesRevealResponse = CodexFilesRevealOk | CodexFilesErr
