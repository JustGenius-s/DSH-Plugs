// Shared DSH-Desktop preload surface. Absent in a plain browser.

export interface DesktopUpdateInfo {
  current: string
  latest: string
  url?: string
}

export interface DesktopUpdateState {
  app: DesktopUpdateInfo | null
  dsh: DesktopUpdateInfo | null
  checking: boolean
  config: { checkApp: boolean; checkDsh: boolean }
  versions: { app: string; dsh: string | null }
}

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

export interface DshDesktopBridge {
  getUpdateState(): Promise<DesktopUpdateState>
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
  downloadAppUpdate(): Promise<void>
  updateDsh(): Promise<void>
  checkNow(): Promise<DesktopUpdateState>
  skipVersion(kind: 'app' | 'dsh'): Promise<void>
  setGate(kind: 'app' | 'dsh', enabled: boolean): Promise<DesktopUpdateState>
  relaunch(): void
  seats?: {
    list(): Promise<DesktopSeatInfo[]>
    contribute(contribution: DesktopContribution): Promise<void>
    revoke(seat: DesktopSeatName, contributor: string): Promise<void>
    onAction(listener: (action: DesktopSeatAction) => void): () => void
  }
}

export function bridge(): DshDesktopBridge | undefined {
  return (window as unknown as { dshDesktop?: DshDesktopBridge }).dshDesktop
}
