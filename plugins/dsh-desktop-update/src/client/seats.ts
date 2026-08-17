// Native desktop seats: contribute application-menu + tray items through
// window.dshDesktop.seats (owned by DSH-Desktop). No-op in a plain browser.
// Fiber dispose revokes both seats, matching ctx.slots.inject lifetime.

import { bridge, type DesktopMenuItemSpec, type DesktopUpdateState } from './bridge'

const CONTRIBUTOR = 'desktop-update'

function zh(): boolean {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
}

function labels() {
  return zh()
    ? {
        check: '检查更新…',
        download: '下载桌面版更新…',
        downloadTo: (v: string) => `下载桌面版 ${v}…`,
        updateDsh: '更新 DSH 运行时',
        updateDshTo: (v: string) => `更新 DSH 到 ${v}`,
        relaunch: '重启 DSH-Desktop',
        tooltip: 'DSH-Desktop',
        tooltipUpdate: 'DSH-Desktop — 有可用更新',
      }
    : {
        check: 'Check for Updates…',
        download: 'Download App Update…',
        downloadTo: (v: string) => `Download App ${v}…`,
        updateDsh: 'Update DSH Runtime',
        updateDshTo: (v: string) => `Update DSH to ${v}`,
        relaunch: 'Restart DSH-Desktop',
        tooltip: 'DSH-Desktop',
        tooltipUpdate: 'DSH-Desktop — update available',
      }
}

function menuItems(state: DesktopUpdateState | null): DesktopMenuItemSpec[] {
  const t = labels()
  const hasApp = state?.app !== null && state?.app !== undefined
  const hasDsh = state?.dsh !== null && state?.dsh !== undefined
  return [
    { id: 'check-now', label: t.check, accelerator: 'CmdOrCtrl+Shift+U' },
    { type: 'separator' },
    {
      id: 'download-app',
      label: hasApp && state?.app ? t.downloadTo(state.app.latest) : t.download,
      enabled: hasApp,
    },
    {
      id: 'update-dsh',
      label: hasDsh && state?.dsh ? t.updateDshTo(state.dsh.latest) : t.updateDsh,
      enabled: hasDsh,
    },
    { type: 'separator' },
    { id: 'relaunch', label: t.relaunch },
  ]
}

async function push(state: DesktopUpdateState | null): Promise<void> {
  const seats = bridge()?.seats
  if (seats === undefined) return
  const t = labels()
  const hasUpdate = Boolean(state?.app || state?.dsh)
  const items = menuItems(state)
  try {
    await seats.contribute({
      seat: 'applicationMenu',
      contributor: CONTRIBUTOR,
      menu: 'app',
      order: 20,
      items,
    })
    // 顶栏单独开 Plugins 菜单，避免开发态最左还叫 Electron 时找不到项。
    await seats.contribute({
      seat: 'applicationMenu',
      contributor: CONTRIBUTOR,
      menu: 'plugins',
      order: 20,
      items,
    })
    await seats.contribute({
      seat: 'tray',
      contributor: CONTRIBUTOR,
      order: 10,
      tooltip: hasUpdate ? t.tooltipUpdate : t.tooltip,
      items,
    })
  } catch (err) {
    console.warn('[desktop-update] seat contribute failed', err)
  }
}

/** Register native seats; return a disposer for ctx.effect. */
export function installDesktopSeats(): () => void {
  const b = bridge()
  if (b?.seats === undefined) {
    console.warn('[desktop-update] window.dshDesktop.seats missing; native menu not installed')
    return () => {}
  }

  let alive = true
  const unsubAction = b.seats.onAction((action) => {
    if (!alive || action.contributor !== CONTRIBUTOR) return
    if (action.id === 'check-now') void b.checkNow()
    else if (action.id === 'download-app') void b.downloadAppUpdate()
    else if (action.id === 'update-dsh') void b.updateDsh()
    else if (action.id === 'relaunch') b.relaunch()
  })
  const unsubState = b.onUpdateState((state) => {
    if (alive) void push(state)
  })
  void b.getUpdateState().then((state) => {
    if (alive) void push(state)
  }).catch(() => {
    if (alive) void push(null)
  })
  void push(null)

  return () => {
    alive = false
    unsubAction()
    unsubState()
    void b.seats?.revoke('applicationMenu', CONTRIBUTOR)
    void b.seats?.revoke('tray', CONTRIBUTOR)
  }
}
