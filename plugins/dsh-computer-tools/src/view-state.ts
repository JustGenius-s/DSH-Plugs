import type { ComputerDraft, DesiredState, DriverView, PermissionState } from './shared.ts'

export { draftsEqual } from './catalog.ts'

export type CardKind = 'browser' | 'computer'

/** One permission line in the driver block. */
export interface DriverRow {
  pane: 'accessibility' | 'screen'
  state: PermissionState
  /**
   * True when the row is the affordance that opens System Settings. A granted
   * permission is static text: offering a button there is noise the user has to
   * read past on every visit.
   */
  actionable: boolean
}

/**
 * Project the driver probe into permission rows. Returns an empty list when
 * there is nothing trustworthy to show, so the block can render nothing at all.
 */
export function driverRows(driver: DriverView): DriverRow[] {
  const permissions = driver.permissions
  if (permissions === null) return []
  return [
    {
      pane: 'accessibility',
      state: permissions.accessibility,
      actionable: permissions.accessibility !== 'granted',
    },
    {
      pane: 'screen',
      state: permissions.screenRecording,
      actionable: permissions.screenRecording !== 'granted',
    },
  ]
}

/**
 * Whether a restart can still change the answer. macOS applies a TCC grant to
 * the next process, so an unresolved state after a grant usually means the
 * daemon is older than the grant — exactly when offering a restart helps.
 */
export function driverRestartOffered(driver: DriverView): boolean {
  return driverRows(driver).some((row) => row.actionable)
}

/** Whether the block has anything to say. */
export function driverBlockVisible(driver: DriverView): boolean {
  return driver.permissions !== null || driver.running
}

export function argsFromText(value: string): string[] {
  return value.split(/\s+/).filter((item) => item !== '')
}

export function argsToText(args: readonly string[]): string {
  return args.join(' ')
}

/** Per-card draft comparison; the whole-state draftsEqual stays for snapshots. */
export function partsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function canSave(input: {
  dirty: boolean
  busy: boolean
  validationError: string | null
  missingPackages: readonly string[]
}): boolean {
  if (!input.dirty || input.busy || input.validationError !== null) return false
  if (input.missingPackages.length > 0) return false
  return true
}

export function needsNativeConfirm(draft: ComputerDraft, current: ComputerDraft): boolean {
  if (!draft.enabled || draft.provider !== 'cua-native') return false
  if (!current.enabled) return true
  return current.provider !== 'cua-native'
}

export function defaultBrowserDraft(chromePath: string): DesiredState['browser'] {
  return {
    enabled: true,
    provider: 'playwright-mcp',
    mode: 'launch',
    headless: false,
    executablePath: chromePath,
    endpoint: '',
  }
}

export function defaultComputerDraft(provider: 'cua-native' | 'cua-mcp', command: string): DesiredState['computer'] {
  if (provider === 'cua-mcp') {
    return { enabled: true, provider: 'cua-mcp', command, args: ['mcp'] }
  }
  return { enabled: true, provider: 'cua-native' }
}
