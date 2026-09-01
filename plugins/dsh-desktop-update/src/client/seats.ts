// Native desktop seats + system notifications through window.dshDesktop
// (owned by DSH-Desktop). No-op in a plain browser. Fiber dispose revokes
// seats and closes outstanding notifications.
//
// The state these seats render is passed in rather than pulled from the bridge:
// detection is Host-side now, and the hook that polls it (useUpdateState) is
// the single source of truth for both the card and these seats.

import { bridge, type DesktopMenuItemSpec } from './bridge'
import type { DesktopUpdateState } from '../shared'

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
        updatingDsh: '正在更新 DSH…',
        relaunch: '重启 DSH-Desktop',
        relaunchNow: '立即重启以应用更新',
        tooltip: 'DSH-Desktop',
        tooltipUpdate: 'DSH-Desktop — 有可用更新',
        tooltipUpdating: 'DSH-Desktop — 正在更新运行时',
        tooltipRelaunch: 'DSH-Desktop — 需重启以应用更新',
      }
    : {
        check: 'Check for Updates…',
        download: 'Download App Update…',
        downloadTo: (v: string) => `Download App ${v}…`,
        updateDsh: 'Update DSH Runtime',
        updateDshTo: (v: string) => `Update DSH to ${v}`,
        updatingDsh: 'Updating DSH…',
        relaunch: 'Restart DSH-Desktop',
        relaunchNow: 'Restart Now to Apply Update',
        tooltip: 'DSH-Desktop',
        tooltipUpdate: 'DSH-Desktop — update available',
        tooltipUpdating: 'DSH-Desktop — updating runtime',
        tooltipRelaunch: 'DSH-Desktop — restart required',
      }
}

function menuItems(state: DesktopUpdateState | null): DesktopMenuItemSpec[] {
  const t = labels()
  const hasApp = state?.app !== null && state?.app !== undefined
  const hasDsh = state?.dsh !== null && state?.dsh !== undefined
  const busy = Boolean(state?.updatingDsh)
  const needsRelaunch = Boolean(state?.needsRelaunch)
  return [
    { id: 'check-now', label: t.check, accelerator: 'CmdOrCtrl+Shift+U', enabled: !busy },
    { type: 'separator' },
    {
      id: 'download-app',
      label: hasApp && state?.app ? t.downloadTo(state.app.latest) : t.download,
      enabled: hasApp && !busy,
    },
    {
      id: 'update-dsh',
      label: busy
        ? t.updatingDsh
        : hasDsh && state?.dsh
          ? t.updateDshTo(state.dsh.latest)
          : t.updateDsh,
      enabled: hasDsh && !busy,
    },
    { type: 'separator' },
    {
      id: 'relaunch',
      label: needsRelaunch ? t.relaunchNow : t.relaunch,
    },
  ]
}

async function push(state: DesktopUpdateState | null): Promise<void> {
  const seats = bridge()?.seats
  if (seats === undefined) return
  const t = labels()
  const hasUpdate = Boolean(state?.app || state?.dsh)
  const busy = Boolean(state?.updatingDsh)
  const needsRelaunch = Boolean(state?.needsRelaunch)
  const items = menuItems(state)
  const tooltip = busy
    ? t.tooltipUpdating
    : needsRelaunch
      ? t.tooltipRelaunch
      : hasUpdate
        ? t.tooltipUpdate
        : t.tooltip
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
      tooltip,
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
  // 更新进行中：关掉「有更新」通知，避免和进度抢注意力。
  if (state?.updatingDsh) {
    if (lastNotifyKey !== '') {
      lastNotifyKey = ''
      void notify.close(CONTRIBUTOR, NOTIFY_ID)
    }
    return
  }
  const lines: string[] = []
  if (state?.needsRelaunch) {
    lines.push(t.relaunchNow)
  } else {
    if (state?.app) lines.push(t.downloadTo(state.app.latest))
    if (state?.dsh) lines.push(t.updateDshTo(state.dsh.latest))
  }
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
    title: state?.needsRelaunch ? t.tooltipRelaunch : t.tooltipUpdate,
    body: key,
  }).then((result) => {
    // DSH-Desktop's main process resolves { shown: false } (does not throw) when
    // the OS notification cannot be displayed — permission denied, unsupported,
    // rate-limited, or cap reached. Surface it so a suppressed notification is
    // not mistaken for "no update detected".
    if (result?.shown === false) {
      console.warn('[desktop-update] notify.show suppressed (shown=false)', {
        contributor: CONTRIBUTOR,
        id: NOTIFY_ID,
        body: key,
      })
    }
  }).catch((err) => {
    console.warn('[desktop-update] notify.show failed', err)
  })
}

/** Actions the seats trigger; the caller owns state and the Host connection. */
export interface SeatHandlers {
  /** Re-run detection now. */
  checkNow: () => void
  /** Open the App download page. */
  downloadApp: () => void
  /** Install the given runtime version. */
  updateDsh: (version: string) => void
  /** Restart the desktop app. */
  relaunch: () => void
}

/**
 * Register native seats + update notifications; return a disposer for ctx.effect.
 *
 * Seats are installed even without a shell — the state they render comes from
 * the Host, not from the bridge — but every action no-ops, since each one needs
 * the shell to carry it out.
 */
export function installDesktopSeats(
  watch: (apply: (state: DesktopUpdateState | null) => void) => () => void,
  handlers: SeatHandlers,
): () => void {
  const b = bridge()
  let alive = true

  const unsubSeat = b?.seats?.onAction((action) => {
    if (!alive || action.contributor !== CONTRIBUTOR) return
    if (action.id === 'check-now') handlers.checkNow()
    else if (action.id === 'download-app') handlers.downloadApp()
    else if (action.id === 'update-dsh') handlers.updateDsh('')
    else if (action.id === 'relaunch') handlers.relaunch()
  }) ?? (() => {})

  const unsubNotify = b?.notify?.onAction((action) => {
    if (!alive || action.contributor !== CONTRIBUTOR) return
    if (action.id !== NOTIFY_ID) return
    // 点击通知：重新检测一次（需重启时由卡片/菜单的 relaunch 项处理）。
    handlers.checkNow()
  }) ?? (() => {})

  const apply = (state: DesktopUpdateState | null) => {
    void push(state)
    syncNotify(state)
  }
  const unwatch = watch(apply)
  void push(null)

  return () => {
    alive = false
    unwatch()
    unsubSeat()
    unsubNotify()
    lastNotifyKey = ''
    void b?.seats?.revoke('applicationMenu', CONTRIBUTOR)
    void b?.seats?.revoke('tray', CONTRIBUTOR)
    void b?.notify?.close(CONTRIBUTOR)
  }
}
