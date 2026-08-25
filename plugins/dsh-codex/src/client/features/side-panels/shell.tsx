/**
 * The side-panels shell: a fixed right sidebar rendered from the shell.overlay
 * layer. It reads the `side.panel` slot ledger to build the tab strip and
 * renders the active panel's body through `renderSlot('side.panel', owner,
 * { only: activeId })`. The layout squeeze is one CSS variable on #root.
 *
 * Visuals and interaction mirror the native DSH sidebar column: the same
 * `--dsw-specific-sidebar-fill` surface, `--dsw-alias-border-l1` divider and
 * no drop shadow as AppFrame's left rail. Icons and the tooltip come from
 * `@deepseek-ai/dsh-client-ui-primitives`, and resize follows AppFrame's
 * drag contract — pointer capture, rAF-throttled deltas against the
 * drag-start width, and an 8px hit strip with no visible pill.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronRightOutline14,
  IconCloseFill14, IconCloseOutline16, IconPlusOutline16, Menu, Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  clampPanelLauncherWidth,
  DEFAULT_CONFIG,
  type DshCodexConfig,
} from '../../../shared/config'
import { resolvePanelIcon } from './icons'
import { launcherVisible, type LauncherStore } from './launcher-store'
import { NO_SESSION_PANEL_KEY, type SidePanelInstance, type SidePanelsStore } from './service'
import { ensureSidePanelStyles } from './styles'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { sessionCwd } from '../../host-adapters/sessions'
import { useSidePanelLayout } from './layout-controller'
import type { SidePanelActionsContribution } from './actions'

ensureSidePanelStyles()

/** Breathing room between the conversation header's bottom edge and the launcher card. */
const LAUNCHER_HEADER_GAP = 20

/** Whether a retained pane bucket belongs to the host's current session id. */
function panelSessionMatch(
  retainedSessionId: string,
  currentSessionId: string | undefined,
): boolean {
  if (retainedSessionId === NO_SESSION_PANEL_KEY) return currentSessionId === undefined
  return retainedSessionId === currentSessionId
}

/**
 * Map the internal retain bucket back to a slot owner session id.
 * The no-session bucket uses an empty string internally; panels receive
 * undefined cwd and may omit session-scoped wiring.
 */
function resolvePanelSessionId(retainedSessionId: string): string | undefined {
  return retainedSessionId === NO_SESSION_PANEL_KEY ? undefined : retainedSessionId
}

/** Resolve cwd for a pane; the no-session bucket has no conversation cwd. */
function resolvePanelCwd(
  retainedSessionId: string,
  sessionsById: SessionListState['byId'],
): string | undefined {
  if (retainedSessionId === NO_SESSION_PANEL_KEY) return undefined
  return sessionCwd(sessionsById, retainedSessionId)
}

/**
 * Tab caption: a lone instance keeps the panel label ("终端"); duplicates
 * pick up a 1-based ordinal so two terminals read "终端 1" / "终端 2".
 */
function defaultInstanceCaption(
  instance: SidePanelInstance,
  siblings: readonly SidePanelInstance[],
  label: string,
): string {
  // An explicit caption override wins — the git graph tab reads "Graph".
  const title = instance.state?.title
  if (title !== undefined && title.length > 0) return title
  if (siblings.length < 2) return label
  const ordinal = siblings.findIndex(item => item.key === instance.key) + 1
  return ordinal > 0 ? label + ' ' + String(ordinal) : label
}

function instanceCaption(
  store: SidePanelsStore,
  instance: SidePanelInstance,
  siblings: readonly SidePanelInstance[],
  label: string,
): string {
  return store.descriptor(instance.panelId)?.caption?.(instance, siblings, label)
    ?? defaultInstanceCaption(instance, siblings, label)
}

/** Reactive read face over the slot ledger for `side.panel`. */
export interface PanelEntriesApi {
  list(): readonly PanelTabInfo[]
  subscribe(listener: () => void): () => void
  version(): number
}

export interface PanelTabInfo {
  id: string
  label: string
  order: number
}

interface ShellProps {
  renderSlot: (
    key: 'side.panel',
    owner: {
      sessionId: string
      cwd?: string
      instanceKey?: string
      state?: SidePanelInstance['state']
      visible?: boolean
    },
    opts?: { only?: string },
  ) => unknown
  useSessions: SnapshotSelectorHook<SessionListState>
  store: SidePanelsStore
  launcher: LauncherStore
  entries: PanelEntriesApi
  actions?: SidePanelActionsContribution
  scope?: SettingsScope<DshCodexConfig>
  t: (key: string) => string
}

export function SidePanelsShell(props: ShellProps) {
  const { renderSlot, useSessions, store, launcher, entries, actions, scope, t } = props

  const sessionId = useSessions(state => state.current)
  const sessionsById = useSessions(state => state.byId)
  const sessionIds = useSessions(state => state.ids)

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const tabs = useSyncExternalStore(entries.subscribe, entries.list)
  const scopeSnapshot = useSyncExternalStore(
    scope === undefined ? () => () => {} : listener => scope.subscribe(listener),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
  )
  const launcherWidth = clampPanelLauncherWidth(
    scopeSnapshot?.value?.panelLauncherWidth
      ?? DEFAULT_CONFIG.panelLauncherWidth,
  )
  const launcherSnapshot = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot)
  const launcherShown = launcherVisible(launcherSnapshot)

  // Switch before paint so the header never renders one session's tabs under
  // another session's owner. Retained panes keep their original owner props.
  useLayoutEffect(() => {
    store.setSession(sessionId)
  }, [store, sessionId])

  useEffect(() => {
    if (sessionIds !== undefined) store.pruneSessions(sessionIds)
  }, [store, sessionIds])

  // Instances whose panel is still registered. A plugin can unload while its
  // tab is open (or a restored strip can name a panel that never arrived), and
  // such a tab has nothing to render — drop it from the strip rather than
  // showing a dead tab. The ledger, not the store, is the authority here.
  const panelById = new Map(tabs.map(tab => [tab.id, tab]))
  const currentInstances = snapshot.currentSessionId === sessionId ? snapshot.instances : []
  const live = currentInstances.filter(instance => panelById.has(instance.panelId))

  // Resolve the active instance: the remembered one when still live, else the first.
  const activeKey = live.some(i => i.key === snapshot.activeKey)
    ? snapshot.activeKey
    : live[0]?.key ?? null
  const activeInstance = activeKey === null ? undefined : live.find(i => i.key === activeKey)
  const terminalActive = activeInstance?.panelId === 'terminal'

  const open = snapshot.open && live.length > 0
  const { anchorTop, launcherRef } = useSidePanelLayout(open, snapshot.width, launcher, tabs.length)

  // Resize mirrors AppFrame's DragHandle: pointer capture keeps the gesture on
  // the strip (no window listeners), deltas are rAF-throttled, and the base is
  // the width captured at drag start so a clamped panel never jumps. The
  // body attribute pauses the #root transition and shows the col-resize cursor.

  // Which collapsed-launcher row is showing its existing tabs. Accordion:
  // expanding one panel collapses the other so the floating card stays short.
  const [expandedLauncherId, setExpandedLauncherId] = useState<string | null>(null)

  // New-instance menu open state; closes on any outside pointer press so it
  // behaves like the DSH menus it visually copies.
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    if (!adding) return
    const onDown = (event: PointerEvent): void => {
      const el = event.target
      if (el instanceof Element && el.closest('.dsh-side-panels-add') !== null) return
      setAdding(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('pointerdown', onDown) }
  }, [adding])

  // Tab context menu (VSCode editor-tab style: rename, close, close others,
  // close to the right, close all) and the inline-rename target it opens.
  const [tabMenu, setTabMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)

  const tabMenuItems = useMemo<readonly MenuEntry[]>(() => {
    if (tabMenu === null) return []
    const index = live.findIndex(i => i.key === tabMenu.key)
    return [
      { id: 'rename', label: t('tabs.rename') },
      { type: 'separator', id: 'sep-rename' },
      { id: 'close', label: t('tabs.close') },
      { id: 'close-others', label: t('tabs.closeOthers'), disabled: live.length < 2 },
      {
        id: 'close-right',
        label: t('tabs.closeToRight'),
        disabled: index === -1 || index === live.length - 1,
      },
      { type: 'separator', id: 'sep-close' },
      { id: 'close-all', label: t('tabs.closeAll') },
    ]
  }, [tabMenu, live, t])

  const onTabMenuSelect = useCallback((id: string): void => {
    const menu = tabMenu
    setTabMenu(null)
    if (menu === null) return
    if (id === 'rename') setRenamingKey(menu.key)
    else if (id === 'close') store.closeInstance(menu.key)
    else if (id === 'close-others') store.closeOthers(menu.key)
    else if (id === 'close-right') store.closeToRight(menu.key)
    else if (id === 'close-all') store.closeAll()
  }, [store, tabMenu])

  const commitRename = useCallback((key: string, value: string): void => {
    store.renameInstance(key, value)
    setRenamingKey(null)
  }, [store])

  // Tab drag-reorder, modeled on VSCode's tab drag: a press that moves past
  // a 4px threshold becomes a drag (pointer capture on the tab, so a short
  // press still activates it); an insertion line marks the drop slot and the
  // strip auto-scrolls near its edges; the reorder commits on release.
  const tabDrag = useRef<{
    key: string
    pointerId: number
    startX: number
    active: boolean
  } | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const onTabPointerDown = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    key: string,
  ): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.dsh-side-panels-tab-close') !== null) return
    if (target.closest('.dsh-side-panels-tab-rename') !== null) return
    tabDrag.current = { key, pointerId: event.pointerId, startX: event.clientX, active: false }
  }, [])

  const onTabPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = tabDrag.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < 4) return
      drag.active = true
      event.currentTarget.setPointerCapture(drag.pointerId)
      setDragKey(drag.key)
    }
    const strip = tabsRef.current
    if (strip === null) return
    // Edge auto-scroll so a drag can reach tabs scrolled out of view.
    const stripRect = strip.getBoundingClientRect()
    if (event.clientX < stripRect.left + 24) strip.scrollLeft -= 12
    else if (event.clientX > stripRect.right - 24) strip.scrollLeft += 12
    // The drop slot, counted in the strip WITHOUT the dragged tab: how many
    // of the other tabs' midpoints lie left of the pointer.
    let index = 0
    for (const el of strip.querySelectorAll<HTMLElement>('[data-tab-key]')) {
      if (el.dataset['tabKey'] === drag.key) continue
      const rect = el.getBoundingClientRect()
      if (event.clientX > rect.left + rect.width / 2) index += 1
    }
    setDropIndex(index)
  }, [])

  const onTabPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = tabDrag.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    tabDrag.current = null
    if (drag.active) {
      if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId)
      }
      if (dropIndex !== null) store.moveInstance(drag.key, dropIndex)
    }
    setDragKey(null)
    setDropIndex(null)
  }, [dropIndex, store])

  // Where the insertion line goes: before this tab, or after the last one.
  let dropBeforeKey: string | null = null
  let dropAfterKey: string | null = null
  if (dragKey !== null && dropIndex !== null) {
    const others = live.filter(i => i.key !== dragKey)
    if (others.length > 0) {
      if (dropIndex >= others.length) dropAfterKey = others[others.length - 1]?.key ?? null
      else dropBeforeKey = others[dropIndex]?.key ?? null
    }
  }

  // The tab strip scrolls horizontally when instances overflow (stylesheet:
  // tabs are flex:none inside an overflow-x scrollport). Wheel handling is a
  // reduced port of VSCode's tabs scrollbar (multiEditorTabsControl.ts uses a
  // ScrollableElement with scrollYToX; scrollableElement.ts _onMouseWheel):
  // one dominant axis per event, a vertical-only delta steers the horizontal
  // scroll, and pixel deltas get a 1.25 gain (their ÷40 normalization × 50
  // sensitivity). Critically, EVERY wheel event over the strip goes through
  // this one manual path — letting some events scroll natively and others
  // not (the old deltaX-dominant passthrough) makes the browser kill the
  // trackpad gesture's momentum mid-stream, which read as "scrolls once,
  // then stuck". As in VSCode, an event that would not move the strip
  // (either end) is not consumed, so it can chain to whatever lies beneath.
  //
  // The listener sits on the whole HEADER, not just the strip: the header is
  // 74px tall but the strip only fills its bottom ~29px content box, so wheel
  // events over the top 40px of padding used to fall on dead chrome and the
  // gesture read as hindered. VSCode's tab bar has no such dead zone.
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const header = headerRef.current
    const el = tabsRef.current
    if (header === null || el === null) return
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      // deltaMode: 0 = pixel, 1 = line (Firefox wheel), 2 = page.
      const unit = event.deltaMode === 1 ? 50 / 3 : event.deltaMode === 2 ? el.clientWidth : 1.25
      let deltaX = event.deltaX * unit
      let deltaY = event.deltaY * unit
      // scrollPredominantAxis: keep the dominant axis, drop the other.
      if (Math.abs(deltaY) >= Math.abs(deltaX)) deltaX = 0
      else deltaY = 0
      // scrollYToX: a vertical-only delta steers the horizontal strip.
      if (deltaX === 0) deltaX = deltaY
      if (deltaX === 0) return
      const max = el.scrollWidth - el.clientWidth
      const next = Math.min(max, Math.max(0, el.scrollLeft + deltaX))
      if (next === el.scrollLeft) return
      event.preventDefault()
      el.scrollLeft = next
    }
    header.addEventListener('wheel', onWheel, { passive: false })
    return () => header.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const el = tabsRef.current
    if (el === null || activeKey === null) return
    el.querySelector('[data-tab-key="' + activeKey + '"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, snapshot.width])

  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const base = useRef(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (dragging) document.body.setAttribute('data-dsh-side-panels-dragging', '')
    else document.body.removeAttribute('data-dsh-side-panels-dragging')
    return () => { document.body.removeAttribute('data-dsh-side-panels-dragging') }
  }, [dragging])

  const onDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    base.current = snapshot.width
    setDragging(true)
  }, [snapshot.width])

  const onDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      store.setWidth(base.current + (origin.current - latest.current))
    })
  }, [store])

  const onDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    store.setWidth(base.current + (origin.current - latest.current))
    setDragging(false)
  }, [store])

  const retainedPanes = snapshot.retainedSessions.flatMap((session) =>
    session.instances
      .filter((instance) => panelById.has(instance.panelId))
      .map((instance) => ({ session, instance })),
  )
  // Keep this body as one stable React parent across session/sidebar changes.
  // Moving panes between an open body and a hidden keepalive container would
  // still unmount every terminal even when the child keys are unchanged.
  const renderPanes = (): ReactNode => (
    <div className="dsh-side-panels-body">
      {retainedPanes.map(({ session, instance }) => {
        const visible = open && panelSessionMatch(session.sessionId, sessionId) && instance.key === activeKey
        const ownerSessionId = resolvePanelSessionId(session.sessionId)
        return (
          <div
            key={session.sessionId + ':' + instance.key}
            className="dsh-side-panels-pane"
            hidden={!visible}
          >
            {renderSlot(
              'side.panel',
              {
                sessionId: ownerSessionId ?? NO_SESSION_PANEL_KEY,
                cwd: resolvePanelCwd(session.sessionId, sessionsById),
                instanceKey: instance.key,
                state: instance.state,
                // Hidden retained panes stay mounted but must not hold SSE.
                visible,
              },
              { only: instance.panelId },
            ) as ReactNode}
          </div>
        )
      })}
    </div>
  )

  const launcherCard = tabs.length > 0 ? (
    <div
      ref={node => { launcherRef.current = node }}
      className="dsh-side-panels-launcher"
      style={{
        width: launcherWidth,
        ...(anchorTop === null ? undefined : { top: anchorTop + LAUNCHER_HEADER_GAP }),
      }}
      role="group"
      aria-label={t('aria.open')}
      aria-hidden={open || !launcherShown || undefined}
      data-hidden={open || undefined}
      data-concealed={(!open && !launcherShown) || undefined}
    >
      {/* The visual card is an inner wrapper: the show/hide transform animates
          here, so the OUTER box — the one the occlusion watch measures — never
          moves, and auto-hide cannot oscillate off its own animation. */}
      <div className="dsh-side-panels-launcher-card">
      {tabs.map((tab) => {
        const existing = live.filter(instance => instance.panelId === tab.id)
        const expanded = expandedLauncherId === tab.id && existing.length > 0
        const isTerminal = tab.id === 'terminal'
        return (
          <div key={tab.id} className="dsh-side-panels-launcher-group">
            <div className="dsh-side-panels-launcher-row">
              <button
                type="button"
                className="dsh-side-panels-launcher-item"
                onClick={() => {
                  if (existing.length === 0) {
                    store.open(tab.id)
                    return
                  }
                  const preferred = existing.find(instance => instance.key === snapshot.activeKey)
                    ?? existing[existing.length - 1]
                  if (preferred !== undefined) store.activateInstance(preferred.key)
                }}
              >
                <span className="dsh-side-panels-launcher-icon" aria-hidden>
                  {resolvePanelIcon(store.descriptor(tab.id)?.icon)}
                </span>
                <span className="dsh-side-panels-launcher-label">{tab.label}</span>
              </button>
              {isTerminal && actions?.render('launcher')}
              {existing.length > 0 && (
                <button
                  type="button"
                  className="dsh-side-panels-launcher-expand"
                  aria-expanded={expanded}
                  aria-label={expanded ? t('aria.collapseTabs') : t('aria.expandTabs')}
                  onClick={() => {
                    setExpandedLauncherId(current => current === tab.id ? null : tab.id)
                  }}
                >
                  <IconChevronRightOutline14 size={14} />
                </button>
              )}
            </div>
            {existing.length > 0 && (
              <div
                className="dsh-side-panels-launcher-tabs"
                data-expanded={expanded || undefined}
                role="list"
              >
                <div className="dsh-side-panels-launcher-tabs-inner">
                  {existing.map((instance) => (
                    <button
                      key={instance.key}
                      type="button"
                      role="listitem"
                      className="dsh-side-panels-launcher-tab"
                      tabIndex={expanded ? 0 : -1}
                      onClick={() => store.activateInstance(instance.key)}
                    >
                      {instanceCaption(store, instance, existing, tab.label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  ) : null

  return (
    <>
      {launcherCard}
      <div
        className="dsh-side-panels"
        style={{ width: open ? snapshot.width : 0 }}
        data-collapsed={!open || undefined}
        aria-hidden={!open || undefined}
        role="complementary"
        aria-label={t('aria.sidebar')}
      >
      <div
        className="dsh-side-panels-resize"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('aria.resize')}
      />
      <div className="dsh-side-panels-inner">
      <div className="dsh-side-panels-header" ref={headerRef}>
        <div className="dsh-side-panels-tabs" role="tablist" ref={tabsRef}>
          {live.map((instance) => {
            const info = panelById.get(instance.panelId)
            const isActive = instance.key === activeKey
            const siblings = live.filter(i => i.panelId === instance.panelId)
            const caption = instanceCaption(store, instance, siblings, info?.label ?? instance.panelId)
            return (
              <div
                key={instance.key}
                data-tab-key={instance.key}
                data-dragging={dragKey === instance.key || undefined}
                className={[
                  'dsh-side-panels-tab',
                  isActive ? 'dsh-side-panels-tab-active' : '',
                ].filter(Boolean).join(' ')}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setTabMenu({ key: instance.key, x: event.clientX, y: event.clientY })
                }}
                onPointerDown={(event) => onTabPointerDown(event, instance.key)}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerUp}
                onPointerCancel={onTabPointerUp}
              >
                {dropBeforeKey === instance.key ? (
                  <span className="dsh-side-panels-tab-drop" aria-hidden />
                ) : null}
                {dropAfterKey === instance.key ? (
                  <span className="dsh-side-panels-tab-drop is-after" aria-hidden />
                ) : null}
                {renamingKey === instance.key ? (
                  <input
                    className="dsh-side-panels-tab-rename"
                    defaultValue={caption}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRename(instance.key, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setRenamingKey(null)
                      }
                    }}
                    onBlur={(event) => commitRename(instance.key, event.currentTarget.value)}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className="dsh-side-panels-tab-button"
                    onClick={() => store.activateInstance(instance.key)}
                  >
                    <span className="dsh-side-panels-tab-icon" aria-hidden>
                      {resolvePanelIcon(store.descriptor(instance.panelId)?.icon)}
                    </span>
                    <span className="dsh-side-panels-tab-label">{caption}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="dsh-side-panels-tab-close"
                  aria-label={t('aria.closeTab')}
                  title={t('aria.closeTab')}
                  onClick={() => store.closeInstance(instance.key)}
                >
                  <IconCloseFill14 size={14} />
                </button>
              </div>
            )
          })}
        </div>
        {/* New-instance menu: lists every registered panel. A single-instance
            panel that is already open just re-activates its tab (store.open
            decides), so the menu never needs to hide or disable rows. */}
        <div className="dsh-side-panels-add">
          <Tooltip label={t('aria.newPanel')} delayMs={500} side="bottom">
            <button
              type="button"
              className="dsh-side-panels-icon-button"
              aria-label={t('aria.newPanel')}
              aria-expanded={adding}
              onClick={() => { setAdding(v => !v) }}
            >
              <IconPlusOutline16 size={16} />
            </button>
          </Tooltip>
          {adding && (
            <div className="dsh-side-panels-add-menu" role="menu">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className="dsh-side-panels-add-item"
                  onClick={() => {
                    setAdding(false)
                    store.open(tab.id)
                  }}
                >
                  <span className="dsh-side-panels-add-icon" aria-hidden>
                    {resolvePanelIcon(store.descriptor(tab.id)?.icon)}
                  </span>
                  <span className="dsh-side-panels-add-label">{tab.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {terminalActive && actions?.render('header')}
        <Tooltip label={t('aria.close')} delayMs={500} side="bottom">
          <button
            type="button"
            className="dsh-side-panels-icon-button"
            aria-label={t('aria.close')}
            onClick={() => store.close()}
          >
            <IconCloseOutline16 size={16} />
          </button>
        </Tooltip>
      </div>
      {/* Session and tab switches only hide panes. The compound key keeps
          identical panel instance keys from different sessions independent. */}
        {renderPanes()}
      </div>
      </div>
      <Menu
        open={tabMenu !== null}
        portal
        dense
        side="bottom"
        align="start"
        anchor={<span className="dsh-side-panels-menu-anchor" aria-hidden="true" />}
        getAnchorRect={() => tabMenu === null ? null : new DOMRect(tabMenu.x, tabMenu.y, 1, 1)}
        items={tabMenuItems}
        onSelect={onTabMenuSelect}
        onClose={() => setTabMenu(null)}
      />
    </>
  )
}
