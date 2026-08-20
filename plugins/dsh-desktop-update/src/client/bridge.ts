// Shared DSH-Desktop preload surface. Absent in a plain browser.
// Mirrors DSH-Desktop `src/api.ts`: updates / seats / notify. No Electron types.

export interface DesktopUpdateInfo {
  current: string
  latest: string
  url?: string
}

/** DSH 运行时更新渠道：npm dist-tag（latest/next）或按精确版本（custom）。 */
export type DshChannel = 'latest' | 'next' | 'custom'

export interface DesktopUpdateConfig {
  checkApp: boolean
  checkDsh: boolean
  dshChannel?: DshChannel
  dshVersion?: string
}

export interface DesktopUpdateState {
  app: DesktopUpdateInfo | null
  dsh: DesktopUpdateInfo | null
  checking: boolean
  config: DesktopUpdateConfig
  versions: { app: string; dsh: string | null }
}

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
    getState(): Promise<DesktopUpdateState>
    onState(listener: (state: DesktopUpdateState) => void): () => void
    checkNow(): Promise<DesktopUpdateState>
    downloadApp(): Promise<void>
    updateDsh(): Promise<void>
    setDshChannel(channel: DshChannel, version?: string): Promise<DesktopUpdateState>
    skipVersion(kind: DesktopUpdateKind): Promise<void>
    setGate(kind: DesktopUpdateKind, enabled: boolean): Promise<DesktopUpdateState>
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
