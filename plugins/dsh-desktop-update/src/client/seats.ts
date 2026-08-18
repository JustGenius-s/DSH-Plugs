// Native desktop seats + system notifications through window.dshDesktop
// (owned by DSH-Desktop). No-op in a plain browser. Fiber dispose revokes
// seats and closes outstanding notifications.

import { bridge, type DesktopMenuItemSpec, type DesktopUpdateState } from './bridge'

const CONTRIBUTOR = 'desktop-update'
const NOTIFY_ID = 'update-ready'

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

let lastNotifyKey = ''

function syncNotify(state: DesktopUpdateState | null): void {
  const notify = bridge()?.notify
  if (notify === undefined) return
  const t = labels()
  const lines: string[] = []
  if (state?.app) lines.push(t.downloadTo(state.app.latest))
  if (state?.dsh) lines.push(t.updateDshTo(state.dsh.latest))
  const key = lines.join('\n')
  if (key === lastNotifyKey) return
  lastNotifyKey = key
  if (key === '') {
    void notify.close(CONTRIBUTOR, NOTIFY_ID)
    return
  }
  void notify.show({
    contributor: CONTRIBUTOR,
    id: NOTIFY_ID,
    title: t.tooltipUpdate,
    body: key,
  }).catch((err) => {
    console.warn('[desktop-update] notify.show failed', err)
  })
}

/** Register native seats + update notifications; return a disposer for ctx.effect. */
export function installDesktopSeats(): () => void {
  const b = bridge()
  if (b?.seats === undefined || b.updates === undefined) {
    console.warn('[desktop-update] window.dshDesktop.seats/updates missing; native menu not installed')
    return () => {}
  }

  let alive = true
  const unsubSeat = b.seats.onAction((action) => {
    if (!alive || action.contributor !== CONTRIBUTOR) return
    if (action.id === 'check-now') void b.updates.checkNow()
    else if (action.id === 'download-app') void b.updates.downloadApp()
    else if (action.id === 'update-dsh') void b.updates.updateDsh()
    else if (action.id === 'relaunch') b.updates.relaunch()
  })
  const unsubNotify = b.notify?.onAction((action) => {
    if (!alive || action.contributor !== CONTRIBUTOR) return
    if (action.id === NOTIFY_ID) void b.updates.checkNow()
  }) ?? (() => {})
  const apply = (state: DesktopUpdateState | null) => {
    void push(state)
    syncNotify(state)
  }
  const unsubState = b.updates.onState((state) => {
    if (alive) apply(state)
  })
  void b.updates.getState().then((state) => {
    if (alive) apply(state)
  }).catch(() => {
    if (alive) apply(null)
  })
  void push(null)

  return () => {
    alive = false
    unsubSeat()
    unsubNotify()
    unsubState()
    lastNotifyKey = ''
    void b.seats?.revoke('applicationMenu', CONTRIBUTOR)
    void b.seats?.revoke('tray', CONTRIBUTOR)
    void b.notify?.close(CONTRIBUTOR)
  }
}
