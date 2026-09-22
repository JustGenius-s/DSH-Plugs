export const STATUS_PATH = '/dsh-computer-tools/status'
export const PREVIEW_PATH = '/dsh-computer-tools/preview'
export const APPLY_PATH = '/dsh-computer-tools/apply'
export const INSTALL_PATH = '/dsh-computer-tools/install'
export const OPEN_PRIVACY_PATH = '/dsh-computer-tools/open-privacy'
/** Restart the Cua Driver daemon so it picks up grants made after it started. */
export const RESTART_DRIVER_PATH = '/dsh-computer-tools/restart-driver'

export const TARGET_RELEASE = '0.1.6-alpha.1'

export const PACKAGES = {
  browserUse: '@deepseek-ai/dsh-browser-use',
  playwright: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
  chromeDevtools: '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
  stagehand: '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
  computerUse: '@deepseek-ai/dsh-computer-use',
  cuaNative: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  cuaMcp: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp',
} as const

export const IDS = {
  browserUse: 'browser-use',
  playwright: 'browser-use-playwright',
  chromeDevtools: 'browser-use-chrome-devtools',
  stagehand: 'browser-use-stagehand',
  computerUse: 'computer-use',
  cuaNative: 'computer-use-cua-native',
  cuaMcp: 'computer-use-cua-mcp',
} as const

export const MANAGED_IDS = new Set<string>([
  IDS.browserUse,
  IDS.playwright,
  IDS.computerUse,
  IDS.cuaNative,
  IDS.cuaMcp,
])

export const BROWSER_PROVIDER_PACKAGES = new Set<string>([
  PACKAGES.playwright,
  PACKAGES.chromeDevtools,
  PACKAGES.stagehand,
])

export const COMPUTER_PROVIDER_PACKAGES = new Set<string>([
  PACKAGES.cuaNative,
  PACKAGES.cuaMcp,
])

export const ALL_OFFICIAL_PACKAGES = new Set<string>([
  PACKAGES.browserUse,
  PACKAGES.playwright,
  PACKAGES.chromeDevtools,
  PACKAGES.stagehand,
  PACKAGES.computerUse,
  PACKAGES.cuaNative,
  PACKAGES.cuaMcp,
])

/** The packages a card may install; anything else is rejected by the host. */
export const CARD_PACKAGES = {
  browser: [
    PACKAGES.browserUse,
    PACKAGES.playwright,
    PACKAGES.chromeDevtools,
    PACKAGES.stagehand,
  ],
  computer: [
    PACKAGES.computerUse,
    PACKAGES.cuaNative,
    PACKAGES.cuaMcp,
  ],
} as const satisfies Record<string, readonly string[]>

export type CapabilityCard = keyof typeof CARD_PACKAGES

export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export type CapabilityPhase =
  | 'off'
  | 'missing-deps'
  | 'configured'
  | 'pending-restart'
  | 'active'
  | 'failed'
  | 'unknown'

export type BrowserProvider = 'playwright-mcp'
export type ComputerProvider = 'cua-native' | 'cua-mcp'

export type BrowserDraft =
  | { enabled: false }
  | {
    enabled: true
    provider: BrowserProvider
    mode: 'launch' | 'attach'
    headless: boolean
    executablePath: string
    endpoint: string
  }

export type ComputerDraft =
  | { enabled: false }
  | { enabled: true; provider: 'cua-native' }
  | { enabled: true; provider: 'cua-mcp'; command: string; args: readonly string[] }

export interface DesiredState {
  browser: BrowserDraft
  computer: ComputerDraft
}

export interface PatchEntry {
  id: string
  name: string
  config: Record<string, unknown>
}

export interface UnmanagedEntry {
  id: string
  name: string
  capability: 'browser' | 'computer'
}

export interface Diagnostic {
  id: string
  level: 'info' | 'warn' | 'error'
  detail: string
}

/** TCC permission state as reported by the driver under its own identity. */
export type PermissionState = 'granted' | 'denied' | 'unknown'

export interface DriverView {
  /** Null when the driver CLI could not be probed at all. */
  permissions: {
    accessibility: PermissionState
    screenRecording: PermissionState
    directCapture: string | null
    bundleId: string | null
  } | null
  running: boolean
  pid: number | null
  /** Probe failure text, surfaced as a diagnostic line. */
  error: string | null
  /** The actual registered MCP call path, distinct from daemon/TCC liveness. */
  toolchain?: ToolchainHealth
}

export interface ToolchainHealth {
  state: 'ready' | 'failed' | 'unavailable'
  tool: string | null
  checkedAt: number
  error: string | null
}

export interface CapabilityView {
  phase: CapabilityPhase
  current: BrowserDraft | ComputerDraft
  missingPackages: string[]
  fiberPhase: FiberPhase
  version: string | null
}

export interface StatusPayload {
  modifiedAt: number | null
  needsRestart: boolean
  runtimeVersion: string | null
  browser: CapabilityView
  computer: CapabilityView
  current: DesiredState
  installCommand: string | null
  /** Resolved dsh entry for copied commands; a Desktop host has no PATH shim. */
  dshBin: string
  diagnostics: Diagnostic[]
  /** Computer Use's external driver: permissions and daemon freshness. */
  driver: DriverView
  managedIds: string[]
  unmanaged: UnmanagedEntry[]
  installedPackages: string[]
  defaults: {
    chromePath: string
    cuaCommand: string
  }
}

export interface MutateRequest {
  desired: DesiredState
  expectedModifiedAt: number | null
  takeover?: boolean
}

export type ApplyFailureCode = 'missing-packages' | 'takeover-required' | 'invalid' | 'profile-changed' | 'io'

export interface InstallResult {
  ok: boolean
  /** Packages that were already present, so only the rest were added. */
  installed: string[]
  /** Packages this run actually added to the profile. */
  added: string[]
  /** Human-facing failure text when `ok` is false. */
  message?: string
  needsRestart?: boolean
}

export type ApplyResult =
  | {
    ok: true
    needsRestart?: boolean
    installCommand?: string
    missing?: string[]
    unmanaged?: UnmanagedEntry[]
    status?: StatusPayload
    previewPatch?: string
  }
  | {
    ok: false
    code: ApplyFailureCode
    message?: string
    installCommand?: string
    missing?: string[]
    unmanaged?: UnmanagedEntry[]
  }

export const EMPTY_DESIRED: DesiredState = {
  browser: { enabled: false },
  computer: { enabled: false },
}

export const MANAGED_MARKER = '# dsh-computer-tools managed'
