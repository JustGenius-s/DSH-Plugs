// Update badge component: up to two round icon buttons beside the sidebar
// Settings seat — deep blue for App updates, blue-violet for DSH runtime
// updates. Hidden unless DSH-Desktop's preload bridge reports an update;
// click opens a popover with per-product rows, per-product auto-check gates,
// and actions. Styling rides DSH theme alias tokens so it blends with the
// shell.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ensureBadgeStyles } from './styles'

// Inject the badge stylesheet once at module materialization (the same
// <style data-plugin> contract DSH's own client bundles use).
ensureBadgeStyles()

interface DesktopUpdateInfo {
  current: string
  latest: string
  url?: string
}

interface DesktopUpdateState {
  app: DesktopUpdateInfo | null
  dsh: DesktopUpdateInfo | null
  checking: boolean
  config: { checkApp: boolean; checkDsh: boolean }
  versions: { app: string; dsh: string | null }
}

interface DshDesktopBridge {
  getUpdateState(): Promise<DesktopUpdateState>
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
  downloadAppUpdate(): Promise<void>
  updateDsh(): Promise<void>
  checkNow(): Promise<DesktopUpdateState>
  skipVersion(kind: 'app' | 'dsh'): Promise<void>
  setGate(kind: 'app' | 'dsh', enabled: boolean): Promise<DesktopUpdateState>
  relaunch(): void
}

function bridge(): DshDesktopBridge | undefined {
  return (window as unknown as { dshDesktop?: DshDesktopBridge }).dshDesktop
}

type Phase = 'idle' | 'updating' | 'done' | 'failed'

function ArrowUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5v-8m0 0L4.7 7.8M8 4.5l3.3 3.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 无更新态的问号图标：白色圆圈描边 + 问号（继承 currentColor）。 */
function QuestionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.6 6.2c0-1 .8-1.7 1.7-1.7.9 0 1.6.7 1.6 1.6 0 1.2-.9 1.5-1.5 2-.3.3-.5.6-.5 1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8.2" cy="10.9" r="0.85" fill="currentColor" />
    </svg>
  )
}

/** Slot props arrive as ({ wide, t }); badges are icon-only in both modes. */
export function UpdateBadge(props: { wide?: boolean; t: (key: string) => string }) {
  const { t } = props
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // 弹层用 fixed 定位（portal 后相对定位的参照系不可靠），位置在打开时按
  // 徽章的屏幕坐标快照计算。
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null)
  // 本次会话内已点「跳过」的产品：行保留（版本照显示），仅隐藏动作行。
  const [skipped, setSkipped] = useState<{ app: boolean; dsh: boolean }>({ app: false, dsh: false })

  // sidebar.footer.action 渲染在设置行上方的独立区域（footArea 为纵向 flex），
  // 为了让徽章出现在设置按钮「最右边」，把内容 portal 进设置行（settingsArea
  // 内的触发按钮）尾部；侧栏折叠/展开会重渲该行，anchor 随之失效并重新定位。
  useEffect(() => {
    const find = (): HTMLElement | null => {
      const area = document.querySelector<HTMLElement>('[class*="settingsArea"]')
      return area?.querySelector<HTMLElement>('button') ?? null
    }
    const timer = window.setInterval(() => {
      const el = find()
      setAnchor((prev) => {
        // 元素被重渲替换（prev 脱离文档）或首次出现时更新；同一元素不重设。
        if (el === prev) return prev
        if (el !== null) el.classList.add('dsh-desktop-update-row-host')
        return el
      })
    }, 500)
    const first = find()
    if (first !== null) {
      first.classList.add('dsh-desktop-update-row-host')
      setAnchor(first)
    }
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const b = bridge()
    if (b === undefined) return
    let alive = true
    void b.getUpdateState().then((s) => { if (alive) setState(s) }).catch(() => {})
    const off = b.onUpdateState((s) => { if (alive) setState(s) })
    return () => { alive = false; off() }
  }, [])

  // Close the popover on outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openPanel = useCallback((e: { currentTarget: EventTarget | null }) => {
    const next = !open
    if (next) {
      const el = e.currentTarget
      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect()
        setPanelPos({ left: Math.round(rect.left), bottom: Math.round(window.innerHeight - rect.top + 8) })
      }
    }
    setOpen(next)
    // Re-check on open so a stale badge self-heals.
    const b = bridge()
    if (b !== undefined) void b.checkNow().then((s) => setState(s)).catch(() => {})
  }, [open])

  const doUpdateDsh = useCallback(async () => {
    const b = bridge()
    if (b === undefined) return
    setPhase('updating')
    try {
      await b.updateDsh()
      setPhase('done')
    } catch {
      setPhase('failed')
    }
  }, [])

  const skip = useCallback(async (kind: 'app' | 'dsh') => {
    const b = bridge()
    if (b === undefined) return
    await b.skipVersion(kind).catch(() => {})
    // 桥会把该行状态置 null（跳过记录持久化）；本地再标记一次，让行以
    // 「无动作」形态继续展示版本号，而不是整行消失。
    setSkipped((s) => ({ ...s, [kind]: true }))
    setState((s) => (s === null ? s : { ...s, [kind]: null }))
  }, [])

  const setGate = useCallback(async (kind: 'app' | 'dsh', enabled: boolean) => {
    const b = bridge()
    if (b === undefined) return
    try {
      const next = await b.setGate(kind, enabled)
      setState(next)
    } catch {
      // 写入失败保持现状；下一次状态推送会校正。
    }
  }, [])

  // Outside the desktop shell, state not yet loaded, or settings row not yet
  // located: render nothing.
  if (bridge() === undefined || state === null || anchor === null) return null
  const hasApp = state.app !== null
  const hasDsh = state.dsh !== null
  // 单徽章：任一产品有更新 → 彩色箭头；无更新/检查全关 → 主题色问号，
  // 点击仍开弹层（展示版本号与更新配置）。
  const accent = hasApp || hasDsh || phase === 'done'

  return createPortal(
    <span ref={rootRef} className="dsh-desktop-update">
      <button
        type="button"
        className={'dsh-desktop-update-badge' + (accent ? ' dsh-desktop-update-badge-accent' : ' dsh-desktop-update-badge-quiet')}
        title={accent ? t('badge.title') : t('badge.quiet.title')}
        aria-label={accent ? t('badge.title') : t('badge.quiet.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPanel}
      >
        {accent ? <ArrowUpIcon /> : <QuestionIcon />}
        <span className="dsh-desktop-update-badge-label">{t('badge.label')}</span>
      </button>

      {open && (
        <span
          className="dsh-desktop-update-panel"
          role="dialog"
          aria-label={t('panel.title')}
          style={panelPos === null ? undefined : { left: panelPos.left, bottom: panelPos.bottom }}
        >

          {state.versions.app !== '' && (
            <span className={'dsh-desktop-update-row' + (hasApp && !skipped.app ? ' dsh-desktop-update-row-has-actions' : '')}>
              <span className="dsh-desktop-update-name dsh-desktop-update-name-app">
                <input
                  type="checkbox"
                  checked={state.config.checkApp}
                  onChange={(e) => void setGate('app', e.target.checked)}
                  aria-label={t('gate.app')}
                />
                {t('panel.app')}
              </span>
              <span className="dsh-desktop-update-version">{state.versions.app}</span>
              {hasApp && !skipped.app && state.app !== null && (
              <span className="dsh-desktop-update-actions">
                <button type="button" className="dsh-desktop-update-link" onClick={() => void skip('app')}>
                  {t('action.skip')}
                </button>
                <button type="button" className="dsh-desktop-update-primary" onClick={() => void bridge()?.downloadAppUpdate()}>
                  {t('action.update.to')} {state.app.latest}
                </button>
              </span>
              )}
            </span>
          )}

          {state.versions.dsh !== null && (
            <span className={'dsh-desktop-update-row' + (hasDsh && !skipped.dsh ? ' dsh-desktop-update-row-has-actions' : '')}>
              <span className="dsh-desktop-update-name dsh-desktop-update-name-dsh">
                <input
                  type="checkbox"
                  checked={state.config.checkDsh}
                  onChange={(e) => void setGate('dsh', e.target.checked)}
                  aria-label={t('gate.dsh')}
                />
                {t('panel.dsh')}
              </span>
              <span className="dsh-desktop-update-version">{state.versions.dsh}</span>
              {hasDsh && !skipped.dsh && state.dsh !== null && (
              <span className="dsh-desktop-update-actions">
                {phase !== 'done' && (
                  <button type="button" className="dsh-desktop-update-link" onClick={() => void skip('dsh')}>
                    {t('action.skip')}
                  </button>
                )}
                {phase === 'done' ? (
                  <button type="button" className="dsh-desktop-update-primary" onClick={() => bridge()?.relaunch()}>
                    {t('action.restart')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dsh-desktop-update-primary"
                    disabled={phase === 'updating'}
                    onClick={() => void doUpdateDsh()}
                  >
                    {phase === 'updating' ? t('action.updating') : t('action.update.to') + ' ' + state.dsh.latest}
                  </button>
                )}
              </span>
              )}
              {phase === 'failed' && <span className="dsh-desktop-update-note">{t('state.failed')}</span>}
              {phase === 'done' && <span className="dsh-desktop-update-note">{t('state.done')}</span>}
            </span>
          )}
        </span>
      )}
    </span>,
    anchor,
  )
}
