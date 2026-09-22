import type { CapabilityPhase, CapabilityView, DesiredState, Diagnostic, FiberPhase } from './shared.ts'
import { IDS, PACKAGES } from './shared.ts'
import { missingPackages } from './catalog.ts'

export interface LoaderRow {
  localId: string
  moduleName: string
  disabled: boolean
  fiberPhase: FiberPhase
}

export interface StatusInput {
  desired: DesiredState
  dependencies: Readonly<Record<string, string>>
  loader: readonly LoaderRow[]
  versions: Readonly<Record<string, string | null>>
  lastAppliedAt: number | null
  hostStartedAt: number
  pathExists: (path: string) => boolean
  runtimeVersion: string | null
}

export function deriveCapability(
  kind: 'browser' | 'computer',
  input: StatusInput,
): CapabilityView {
  const current = kind === 'browser' ? input.desired.browser : input.desired.computer
  const missing = missingPackages(
    kind === 'browser'
      ? { browser: input.desired.browser, computer: { enabled: false } }
      : { browser: { enabled: false }, computer: input.desired.computer },
    input.dependencies,
  )
  const ids = kind === 'browser' ? [IDS.browserUse, IDS.playwright] : [IDS.computerUse, IDS.cuaNative, IDS.cuaMcp]
  const row = pickLoader(input.loader, ids, kind)
  const version = kind === 'browser'
    ? input.versions[PACKAGES.playwright] ?? input.versions[PACKAGES.browserUse] ?? null
    : input.versions[PACKAGES.cuaNative] ?? input.versions[PACKAGES.cuaMcp] ?? input.versions[PACKAGES.computerUse] ?? null
  return {
    phase: phaseOf(current.enabled, missing, row, input.lastAppliedAt, input.hostStartedAt),
    current,
    missingPackages: missing,
    fiberPhase: row?.fiberPhase ?? null,
    version,
  }
}

export function collectDiagnostics(input: StatusInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (input.runtimeVersion !== null && !input.runtimeVersion.includes('0.1.6')) {
    diagnostics.push({
      id: 'runtime-version',
      level: 'warn',
      detail: input.runtimeVersion,
    })
  }
  if (input.desired.browser.enabled && input.desired.browser.mode === 'launch') {
    const path = input.desired.browser.executablePath.trim()
    if (path !== '' && !input.pathExists(path)) {
      diagnostics.push({ id: 'browser-executable', level: 'error', detail: path })
    }
  }
  if (input.desired.computer.enabled && input.desired.computer.provider === 'cua-mcp') {
    const command = input.desired.computer.command.trim()
    if (command.startsWith('/') && !input.pathExists(command)) {
      diagnostics.push({ id: 'mcp-command', level: 'error', detail: command })
    }
  }
  const browserProviders = input.loader.filter((row) =>
    row.localId === IDS.playwright
    || row.localId === IDS.chromeDevtools
    || row.localId === IDS.stagehand
    || row.moduleName.includes('browser-use-')
  )
  if (browserProviders.length > 1) {
    diagnostics.push({
      id: 'browser-duplicate',
      level: 'error',
      detail: browserProviders.map((row) => row.localId).join(', '),
    })
  }
  const computerProviders = input.loader.filter((row) =>
    row.localId === IDS.cuaNative || row.localId === IDS.cuaMcp || row.moduleName.includes('computer-use-cua')
  )
  if (computerProviders.length > 1) {
    diagnostics.push({
      id: 'computer-duplicate',
      level: 'error',
      detail: computerProviders.map((row) => row.localId).join(', '),
    })
  }
  return diagnostics
}

export function needsRestartFlag(lastAppliedAt: number | null, hostStartedAt: number, views: readonly CapabilityView[]): boolean {
  if (lastAppliedAt !== null && lastAppliedAt > hostStartedAt) return true
  return views.some((view) => view.phase === 'pending-restart')
}

function phaseOf(
  enabled: boolean,
  missing: readonly string[],
  row: LoaderRow | undefined,
  lastAppliedAt: number | null,
  hostStartedAt: number,
): CapabilityPhase {
  if (!enabled) return 'off'
  if (missing.length > 0) return 'missing-deps'
  if (row?.fiberPhase === 'failed') return 'failed'
  if (row?.fiberPhase === 'active' && row.disabled !== true) return 'active'
  if (lastAppliedAt !== null && lastAppliedAt > hostStartedAt) return 'pending-restart'
  if (row === undefined) return 'pending-restart'
  if (row.fiberPhase === 'pending' || row.fiberPhase === 'loading') return 'unknown'
  return 'configured'
}

function pickLoader(rows: readonly LoaderRow[], ids: readonly string[], kind: 'browser' | 'computer'): LoaderRow | undefined {
  const byId = rows.find((row) => ids.includes(row.localId) && !row.localId.endsWith('use'))
    ?? rows.find((row) => ids.includes(row.localId))
  if (byId) return byId
  const needle = kind === 'browser' ? 'browser-use' : 'computer-use'
  return rows.find((row) => row.moduleName.includes(needle))
}
