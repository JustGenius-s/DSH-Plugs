// The DSH-Desktop preload surface, as this plugin uses it.
//
// The shell is an EXECUTOR: it detects nothing now (detection lives in this
// plugin's Host half, see src/updater.ts). What remains here is what only a
// packaged desktop app can do — report its own version, run `pnpm add` for the
// runtime, open the download page, relaunch — plus the two native UI families
// (seats, notify) that are inherently shell-owned.
//
// Absent in a plain browser; every call site checks `bridge() === undefined`.

export type DesktopUpdateKind = 'app' | 'dsh'

export type DesktopSeatName = 'applicationMenu' | 'tray'

export interface DesktopMenuItemSpec {
  id?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  label?: string
  accelerator?: string
  enabled?: boolean
  visible?: boolean
  checked?: boolean
  submenu?: DesktopMenuItemSpec[]
}

export interface DesktopContribution {
  seat: DesktopSeatName
  contributor: string
  menu?: 'app' | 'plugins'
  order?: number
  tooltip?: string
  items: DesktopMenuItemSpec[]
}

export interface DesktopSeatAction {
  seat: DesktopSeatName
  contributor: string
  id: string
}

export interface DesktopSeatInfo {
  name: DesktopSeatName
  declared: true
  description: string
}

export interface DesktopNotifySpec {
  contributor: string
  id: string
  title: string
  body: string
  silent?: boolean
}

export interface DesktopNotifyAction {
  contributor: string
  id: string
}

export interface DesktopNotifyResult {
  shown: boolean
}

export interface DshDesktop {
  updates: {
    /** The shell's packaged version; '' when unknown. */
    appVersion(): Promise<string>
    /** Open the App release download page (GitHub Releases). */
    downloadApp(): Promise<void>
    /** Install a DSH runtime version in place; resolves when pnpm finishes. */
    updateDsh(version: string): Promise<void>
    /** Restart the app. */
    relaunch(): void
  }
  seats: {
    list(): Promise<DesktopSeatInfo[]>
    contribute(contribution: DesktopContribution): Promise<void>
    revoke(seat: DesktopSeatName, contributor: string): Promise<void>
    onAction(listener: (action: DesktopSeatAction) => void): () => void
  }
  notify: {
    show(spec: DesktopNotifySpec): Promise<DesktopNotifyResult>
    close(contributor: string, id?: string): Promise<void>
    onAction(listener: (action: DesktopNotifyAction) => void): () => void
  }
}

export function bridge(): DshDesktop | undefined {
  return (window as unknown as { dshDesktop?: DshDesktop }).dshDesktop
}
