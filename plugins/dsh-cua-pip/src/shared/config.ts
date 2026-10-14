export const NAMESPACE = 'cua-pip'
export const CONTRIBUTOR = 'dsh-cua-pip'
export const OVERLAY_ID = 'cua-pip'
export const PIP_RUNTIME_VERSION = '2026-09-29-optional-pip-v9'
export const CONTROL_POLICY_VERSION = 'background-first-desktop-fallback-v2'

export const DEFAULTS = {
  /** Target cadence for a preview currently subscribed by a client. */
  fps: 30,
  /** Keep hidden sessions alive without spending the foreground capture budget. */
  backgroundFps: 1,
  /** Longest edge of the native window frame, independent of action coordinates. */
  maxDimension: 1024,
  /** Idle limit for unretained callers; session-owned previews are retained. */
  idleTtlMs: 45_000,
  /** Maximum simultaneous captures; retained sessions share the scheduler. */
  maxWatchers: 3,
} as const
