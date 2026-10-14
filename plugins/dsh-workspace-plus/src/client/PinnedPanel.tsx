/**
 * The pinned area: one compact list above the official sidebar browsing region.
 *
 * It is a VIEW, not a second source of truth. Projects come from this plugin's
 * own pin store (DSH has no workspace pin); sessions come straight from the
 * official `pinnedSessionIds`, so the panel and the official row button are the
 * same write. Nothing here reorders the official tree, claims a slot, or writes
 * an ordering ledger.
 *
 * A pinned PROJECT expands IN PLACE when its row is clicked, exactly like an
 * official workspace row: the leading folder glyph becomes a chevron on hover,
 * and the trailing buttons are the same pair the official row shows (a `...`
 * menu, then new session). Its menu lists the rows DSH ships plus this plugin's
 * additions, both taken from `row-actions.ts` so the two cannot drift.
 *
 * A pinned SESSION row mirrors the official session row: leading status slot,
 * title, trailing relative time, then the hover actions. Titles crawl when
 * clipped (`title-marquee.ts`), matching the official reveal.
 *
 * Mounting is deliberately out-of-band: the panel portals into a container this
 * plugin inserts as the first child of the sidebar's row scroll container, which
 * sits below the section header and scrolls with the rows, without occupying or
 * replacing the official `sidebar.workspaces` slot.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type {
  ClientContext,
  SessionId,
  SessionListState,
  SessionSummary,
} from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'
import {
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconNewChatOutline16,
  OfficialArchiveIcon,
  OfficialPinFillIcon,
  OfficialPinOutlineIcon,
  IconTriangleRightFill14,
  Menu,
  MenuItemButton,
  StateDot,
  Tooltip,
  relativeTime,
} from '@just-genius/dsh-plugin-ui'

import { isCollapsedRail } from './anchor.ts'
import type { Translate, WorkspacePlusKey } from './locales.ts'
import { pendingInteractionsOf, sessionDotState, useWaitingWaits, type WaitKind } from './pending.ts'
import {
  buildPinnedRows,
  type PinnedChildSession,
  type PinnedProjectRow,
  type PinnedRow,
} from './pinned-model.ts'
import { MenuRowIcon } from './menu-icons.tsx'
import { menuOpenAttribute } from './menu-open.ts'
import {
  DRAG_MIME,
  TOP_SCOPE,
  canDrop,
  dropPositionAt,
  encodeDragPayload,
  orderAfterDrop,
  projectScope,
  rowOrderKey,
  dragIdInScope,
  reorderRequestFor,
  type DragSource,
  type DropPosition,
  type DropTarget,
  type ReorderRequest,
} from './pinned-order.ts'
import { projectMenuActions, sessionMenuActions, type RowAction } from './row-actions.ts'
import { openSession, openWorkspace, sessionTitleOf } from './session-commands.ts'
import { ensureMount, findScrollHost, removeMount } from './sidebar-host.ts'
import { useTitleMarquee } from './title-marquee.ts'
import styles from './PinnedPanel.module.css'

export interface PinnedPanelInjected {
  t: Translate
  ctx: ClientContext
  /** Pinned workspace ids, newest first, and their toggle. */
  workspacePins: readonly string[]
  setWorkspacePin: (workspaceId: string, pinned: boolean) => void
  /** Whether the whole area is folded away; remembered per browser. */
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  /** Project ids the user folded; remembered per browser. */
  collapsedProjects: readonly string[]
  setProjectCollapsed: (workspaceId: string, collapsed: boolean) => void
  /** Run one action for a row; the executor lives in `row-actions.ts`. */
  onProjectAction: (workspaceId: string, actionId: string) => void
  onSessionAction: (sessionId: string, actionId: string) => void
  /** Start a new session inside a workspace. */
  onNewSession: (workspaceId: string) => void
  /** Whether an export for this session is already running. */
  isExporting: (sessionId: string) => boolean
  /** Whether a session has a working directory (gates its "open folder" row). */
  sessionHasFolder: (sessionId: string) => boolean
  /** Drag-arranged row order per scope; see `pinned-order.ts`. */
  pinnedOrder: Readonly<Record<string, readonly string[]>>
  /** Record a completed drop; see `ReorderRequest` for why it is structured. */
  onReorder: (request: ReorderRequest) => void
  onError: () => void
}

/**
 * The official scroll container, as React state.
 *
 * Watched rather than resolved once: the browser mounts, remounts on layout
 * changes, and swaps its tree out entirely while a search query is active. An
 * `undefined` host means "not browsing right now", which hides the panel instead
 * of mounting it somewhere it would be discarded.
 */
function useScrollHost(): HTMLElement | undefined {
  const [host, setHost] = useState<HTMLElement | undefined>(() => findScrollHost())
  const [rail, setRail] = useState(false)

  useEffect(() => {
    const sync = (): void => {
      const next = findScrollHost()
      setHost((previous) => (previous === next ? previous : next))
      const sidebar = next?.closest('[data-slot="sidebar"] > *')
      setRail(isCollapsedRail(sidebar?.className))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label'],
    })
    return () => { observer.disconnect() }
  }, [])

  return rail ? undefined : host
}

/**
 * A clock for the trailing relative times.
 *
 * One shared timer for the whole panel, and a slow one: the buckets are minutes
 * and hours, so a per-second tick would re-render every row for nothing.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [])
  return now
}

/** A relative time label, in the official wording and buckets. */
function timeLabel(t: Translate, updatedAt: number, now: number): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}` as WorkspacePlusKey, { n })
}

export function PinnedPanel(props: PinnedPanelInjected) {
  const {
    ctx, t, workspacePins, collapsed, setCollapsed,
    collapsedProjects, setProjectCollapsed,
    onProjectAction, onSessionAction, onNewSession,
    isExporting, sessionHasFolder, onError,
  } = props
  const target = useScrollHost()
  // Resolve the pending store once; a host without it simply reports no waits.
  const pendingStore = useMemo(() => pendingInteractionsOf(ctx), [ctx])
  const waits = useWaitingWaits(pendingStore)

  const workspacesSource = useMemo(() => {
    const list = getWorkspaces(ctx).list
    return { subscribe: (l: () => void) => list.subscribe(l), snapshot: () => list.getSnapshot() }
  }, [ctx])
  const sessionsSource = useMemo(() => {
    const list = getSessions(ctx).list
    return { subscribe: (l: () => void) => list.subscribe(l), snapshot: () => list.getSnapshot() }
  }, [ctx])

  const workspaces = useSyncExternalStore(workspacesSource.subscribe, workspacesSource.snapshot)
  const sessions = useSyncExternalStore(sessionsSource.subscribe, sessionsSource.snapshot)

  const current = ctx.uiSession.adapter.current
  const currentSessionId = useSyncExternalStore(current.subscribe, () => current.getSnapshot().key)

  const rows = useMemo(() => buildPinnedRows({
    projectPins: workspacePins,
    workspaces: workspaces.items.map((item) => ({
      id: String(item.workspaceId),
      title: item.title,
      path: item.path,
      sessionIds: item.sessionIds.map(String),
    })),
    pinnedSessionIds: workspaces.pinnedSessionIds.map(String),
    sessions: sessionViews(sessions),
    archivedSessionIds: workspaces.archivedSessionIds.map(String),
    ...(currentSessionId === undefined ? {} : { currentSessionId }),
    order: props.pinnedOrder,
  // `props.pinnedOrder` MUST be here: it is an input to the row order, so
  // omitting it left a drag writing storage that no re-render ever read back —
  // the drop registered and the list did not move.
  }), [workspacePins, workspaces, sessions, currentSessionId, props.pinnedOrder])

  const now = useNow()
  // Which row's menu is open. Held here (not per row) so opening a second row's
  // menu MOVES the marker rather than leaving two rows marked.
  const [menuOwner, setMenuOwner] = useState<string | null>(null)
  const drag = useRowDrag({
    rows,
    order: props.pinnedOrder,
    onReorder: props.onReorder,
  })

  // The mount container is created once per scroll host and removed on teardown,
  // so disabling the plugin leaves the official sidebar byte-identical.
  const [host, setHost] = useState<HTMLElement | undefined>(undefined)
  useEffect(() => {
    if (target === undefined) {
      removeMount()
      setHost(undefined)
      return
    }
    setHost(ensureMount(target))
    return () => { removeMount() }
  }, [target])

  if (host === undefined || rows.length === 0) return null

  const openRowSession = (sessionId: string): void => {
    try {
      openSession(ctx, sessionId)
    } catch (error) {
      console.warn('[dsh-workspace-plus] opening session failed', error)
      onError()
    }
  }

  return createPortal(
    <>
      <div className={styles.heading}>
        <button
          type="button"
          className={styles.headingButton}
          aria-expanded={!collapsed}
          aria-label={t('pins.title')}
          onClick={() => { setCollapsed(!collapsed) }}
        >
          <OfficialPinFillIcon size={12} />
          <span className={styles.headingText}>{t('pins.title')}</span>
        </button>
        {collapsed ? <span className={styles.count}>{countEntries(rows)}</span> : null}
        {/* The fold control sits on the RIGHT, where the row affordances live. */}
        <button
          type="button"
          className={styles.fold}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'pins.expand' : 'pins.collapse')}
          onClick={() => { setCollapsed(!collapsed) }}
        >
          <IconTriangleRightFill14 className={collapsed ? styles.arrow : styles.arrowOpen} />
        </button>
      </div>
      {collapsed ? null : (
        <div className={styles.list} data-workspace-plus-pins="list">
          {rows.map((row) => (
            row.kind === 'workspace'
              ? (
                <ProjectRow
                  key={`workspace:${row.id}`}
                  row={row}
                  t={t}
                  now={now}
                  folded={collapsedProjects.includes(row.id)}
                  waits={waits}
                  sessions={sessions}
                  isExporting={isExporting}
                  sessionHasFolder={sessionHasFolder}
                  menuOpenKey={menuOwner}
                  onMenuOpenChange={setMenuOwner}
                  onToggle={() => { setProjectCollapsed(row.id, !collapsedProjects.includes(row.id)) }}
                  onOpenWorkspace={() => {
                    void openWorkspace(ctx, row.id).catch((error: unknown) => {
                      console.warn('[dsh-workspace-plus] opening workspace failed', error)
                      onError()
                    })
                  }}
                  onNewSession={() => { onNewSession(row.id) }}
                  onAction={(actionId) => { onProjectAction(row.id, actionId) }}
                  onSessionAction={onSessionAction}
                  onOpenSession={openRowSession}
                  drag={drag}
                />
              )
              : (
                <SessionRow
                  key={`session:${row.id}`}
                  session={{ ...row, pinned: true }}
                  t={t}
                  now={now}
                  wait={waits.get(row.id)}
                  summary={sessionAt(sessions, row.id)}
                  ownerTitle={row.workspaceTitle}
                  exporting={isExporting(row.id)}
                  hasFolder={sessionHasFolder(row.id)}
                  menuOpenKey={menuOwner}
                  onMenuOpenChange={setMenuOwner}
                  onOpen={() => { openRowSession(row.id) }}
                  onAction={(actionId) => { onSessionAction(row.id, actionId) }}
                  drag={drag}
                />
              )
          ))}
        </div>
      )}
      <div className={styles.divider} role="separator" />
    </>,
    host,
  )
}


/**
 * The row-drag interaction, for both kinds of row.
 *
 * HTML5 drag events rather than pointer events, matching the official list: the
 * browser then draws the drag image, handles auto-scroll inside the sidebar's
 * scroller, and cancels cleanly on Escape or a drop outside the window, none of
 * which a pointer implementation gets for free.
 *
 * The indicator is driven from React state (which row, which half) rather than
 * by mutating classes in the event handler, so a re-render can never leave a
 * stale marker behind — dropping out of the window clears it through `onDragEnd`.
 */
interface RowDrag {
  /** Props for a draggable row. */
  handle: (scope: string, id: string) => {
    draggable: true
    onDragStart: (event: React.DragEvent) => void
    onDragEnd: () => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
    'data-dragging': '' | undefined
    'data-drop': DropPosition | undefined
  }
}

function useRowDrag(options: {
  rows: readonly PinnedRow[]
  order: Readonly<Record<string, readonly string[]>>
  onReorder: (request: ReorderRequest) => void
}): RowDrag {
  const [source, setSource] = useState<DragSource | undefined>(undefined)
  const [target, setTarget] = useState<DropTarget | undefined>(undefined)

  /**
   * The ids of one scope, in the order the user currently SEES.
   *
   * Read from the rendered rows rather than from storage: the stored order only
   * names rows the user has arranged, so it is the rendered list — not the
   * stored array — that a drop has to be computed against.
   */
  const idsInScope = (scope: string): string[] => {
    if (scope === TOP_SCOPE) return options.rows.map((row) => rowOrderKey(row))
    const project = options.rows.find(
      (row): row is PinnedProjectRow => row.kind === 'workspace' && projectScope(row.id) === scope,
    )
    return project === undefined ? [] : project.sessions.map((session) => session.id)
  }

  const clear = (): void => {
    setSource(undefined)
    setTarget(undefined)
  }

  const commit = (from: DragSource, to: DropTarget): void => {
    // `canDrop` is the entire cross-scope rule: a child's scope is its project's,
    // and nothing else in the panel shares it, so a child cannot land outside
    // its project and a top-level row cannot land inside one.
    if (!canDrop(from, to)) return
    const list = idsInScope(from.scope)
    options.onReorder(reorderRequestFor(
      from.scope,
      // Complete list, not just the moved id: what is stored then names every
      // row the user could see, so the next render reproduces it exactly.
      orderAfterDrop(list, from.id, to.id, to.position),
      from.id,
    ))
  }

  return {
    handle: (scope, id) => ({
      draggable: true,
      onDragStart: (event) => {
        const next = { scope, id }
        setSource(next)
        setTarget(undefined)
        event.dataTransfer.effectAllowed = 'move'
        // A private MIME is set alongside text/plain so our own drops can tell a
        // row drag from a file or text drag; text/plain keeps the gesture
        // behaving normally if it is dropped outside the panel.
        event.dataTransfer.setData(DRAG_MIME, encodeDragPayload(next))
        event.dataTransfer.setData('text/plain', id)
      },
      onDragEnd: clear,
      onDragOver: (event) => {
        if (source === undefined || source.scope !== scope) return
        // preventDefault IS the "this is a valid drop target" signal; without it
        // the browser refuses the drop and shows a "no" cursor.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const position = dropPositionAt(
          event.currentTarget.getBoundingClientRect(),
          event.clientY,
        )
        setTarget((previous) => (
          previous?.scope === scope && previous.id === id && previous.position === position
            ? previous
            : { scope, id, position }
        ))
      },
      onDragLeave: (event) => {
        // Only clear when the pointer actually left this row: moving between a
        // row's own children fires dragleave on the row too, and clearing there
        // makes the indicator flicker.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setTarget((previous) => (previous?.id === id && previous.scope === scope ? undefined : previous))
      },
      onDrop: (event) => {
        if (source === undefined) return
        event.preventDefault()
        commit(source, { scope, id, position: dropPositionAt(event.currentTarget.getBoundingClientRect(), event.clientY) })
        clear()
      },
      'data-dragging': source?.scope === scope && source.id === id ? '' : undefined,
      'data-drop': (
        source !== undefined && target?.scope === scope && target.id === id && canDrop(source, target)
          ? target.position
          : undefined
      ),
    }),
  }
}

/**
 * A pinned project: a group header that expands in place.
 *
 * Follows the OFFICIAL project row:
 *   - clicking it toggles the group, which is what an official workspace row does;
 *   - hovering turns the folder glyph into a chevron, so the affordance shows
 *     without a permanent arrow competing with the title;
 *   - the trailing buttons are the official pair — a `...` menu, then new session.
 *
 * There is deliberately NO unpin "x": unpinning is a menu row, which is where the
 * official rows keep every state-changing action.
 */
function ProjectRow(props: {
  row: PinnedProjectRow
  t: Translate
  now: number
  folded: boolean
  waits: ReadonlyMap<string, WaitKind>
  sessions: SessionListState
  isExporting: (sessionId: string) => boolean
  sessionHasFolder: (sessionId: string) => boolean
  /**
   * The key of whichever row's menu is up (or null). A KEY rather than a boolean
   * so a nested session row can tell its own menu from its project's: the row
   * derives its own key below instead of inheriting the parent's state.
   */
  menuOpenKey: string | null
  onMenuOpenChange: (key: string | null) => void
  onToggle: () => void
  onOpenWorkspace: () => void
  onNewSession: () => void
  onAction: (actionId: string) => void
  onSessionAction: (sessionId: string, actionId: string) => void
  onOpenSession: (sessionId: string) => void
  drag: RowDrag
}) {
  const { row, t, now, folded, waits, sessions } = props
  // The official row tints the folder while it holds the session you are in.
  const holdsCurrent = row.sessions.some((session) => session.current === true)
  const ownKey = `workspace:${row.id}`
  const dragHandle = props.drag.handle(TOP_SCOPE, dragIdInScope(TOP_SCOPE, row))
  return (
    <div className={styles.group} data-workspace-plus-pins="group">
      <div
        className={styles.row}
        role="treeitem"
        aria-expanded={!folded}
        aria-label={row.title}
        {...menuOpenAttribute(props.menuOpenKey === ownKey)}
        {...dragHandle}
        onClick={props.onToggle}
      >
        {/* Two leading slots, as the official project row has: the folder at rest,
            the chevron while the row is hovered. */}
        <span className={holdsCurrent ? `${styles.folderSlot} ${styles.folderActive}` : styles.folderSlot}>
          {folded ? <IconFolderClose16 /> : <IconFolderOpen16 />}
        </span>
        <span className={styles.chevronSlot}>
          <IconTriangleRightFill14 className={folded ? styles.chevronOpen : styles.arrow} />
        </span>
        <MarqueeTitle text={row.title} className={styles.text} />
        {folded && row.sessions.length > 0
          ? <span className={styles.countPill}>{row.sessions.length}</span>
          : null}
        {/* The action strip must not toggle the group it sits in. */}
        <div className={styles.actions} onClick={(event) => { event.stopPropagation() }}>
          <RowMenuButton
            t={t}
            actions={projectMenuActions({ pinned: true })}
            label={row.title}
            onOpenChange={(open) => { props.onMenuOpenChange(open ? ownKey : null) }}
            onSelect={props.onAction}
          />
          <Tooltip label={t('menu.newSession')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={styles.action}
              aria-label={t('menu.newSession')}
              onClick={props.onNewSession}
            >
              <IconNewChatOutline16 />
            </button>
          </Tooltip>
        </div>
      </div>
      {folded ? null : (
        <div className={styles.children} role="group">
          {row.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              t={t}
              now={now}
              wait={waits.get(session.id)}
              summary={sessionAt(sessions, session.id)}
              exporting={props.isExporting(session.id)}
              hasFolder={props.sessionHasFolder(session.id)}
              menuOpenKey={props.menuOpenKey}
              onMenuOpenChange={props.onMenuOpenChange}
              onOpen={() => { props.onOpenSession(session.id) }}
              onAction={(actionId) => { props.onSessionAction(session.id, actionId) }}
              drag={props.drag}
              scope={projectScope(row.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A nested or stand-alone session, rendered identically either way.
 *
 * Mirrors the OFFICIAL session row: leading status slot, title, trailing relative
 * time, then hover actions (menu, archive, pin). There is no unpin "x" — unpinning
 * is a menu row, as it is for every other state change.
 */
function SessionRow(props: {
  session: PinnedChildSession & { workspaceTitle?: string }
  t: Translate
  now: number
  wait: WaitKind | undefined
  summary: SessionSummary | undefined
  ownerTitle?: string
  exporting: boolean
  hasFolder: boolean
  /**
   * The key of whichever row's menu is up (or null). A KEY rather than a boolean
   * so a nested session row can tell its own menu from its project's: the row
   * derives its own key below instead of inheriting the parent's state.
   */
  menuOpenKey: string | null
  onMenuOpenChange: (key: string | null) => void
  onOpen: () => void
  onAction: (actionId: string) => void
  drag: RowDrag
  /**
   * The list this row is dragged within. Absent means the top level; a nested
   * row passes its project's scope, which is what confines it to that project.
   */
  scope?: string
}) {
  const { session, t, now, wait, summary, ownerTitle, exporting, hasFolder, onOpen, onAction } = props
  // A pending decision outranks live activity, exactly as the official row does,
  // so a pinned row cannot disagree with the row inside its workspace group.
  const dot = sessionDotState(summary ?? {}, wait)
  const label = wait === undefined ? session.title : `${t(waitLabelKey(wait))}, ${session.title}`
  const ownKey = `session:${session.id}`
  // The scope decides the key: the top level lists rows as `kind:id` (so a
  // project and a session cannot collide) while a project's children list bare
  // session ids. Deriving it here rather than at the call site keeps the handle
  // and `idsInScope` on one function.
  const scope = props.scope ?? TOP_SCOPE
  const dragHandle = props.drag.handle(scope, dragIdInScope(scope, { kind: 'session', id: session.id }))
  return (
    <div
      className={styles.row}
      role="treeitem"
      aria-selected={session.current === true}
      aria-label={label}
      {...menuOpenAttribute(props.menuOpenKey === ownKey)}
      {...dragHandle}
      onClick={onOpen}
    >
      <span className={styles.slot}>
        {/* The pin here MARKS a pinned row (as the official `pinIndicator`
            does); a status dot outranks it. An unpinned row leaves the slot
            empty rather than showing a pin it does not have. */}
        {dot !== undefined
          ? <StateDot state={dot} />
          : (session.pinned ? <OfficialPinFillIcon size={12} /> : null)}
      </span>
      <MarqueeTitle
        className={styles.text}
        prefix={ownerTitle === undefined ? undefined : `${ownerTitle} · `}
        text={session.title}
      />
      {/* The official row hides its trailing time while the actions show; CSS does
          the same here, so the two never overlap. */}
      <span className={styles.time} aria-hidden="true">{timeLabel(t, session.updatedAt, now)}</span>
      <div className={styles.actions} onClick={(event) => { event.stopPropagation() }}>
        <RowMenuButton
          t={t}
          actions={sessionMenuActions({ pinned: session.pinned, exporting, hasFolder })}
          label={session.title}
          onOpenChange={(open) => { props.onMenuOpenChange(open ? ownKey : null) }}
          onSelect={onAction}
        />
        <Tooltip label={t('menu.archive')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={styles.action}
            aria-label={t('menu.archive')}
            onClick={() => { onAction('archive') }}
          >
            <OfficialArchiveIcon size={14} />
          </button>
        </Tooltip>
        {/* Reflects THIS session's pin state rather than always offering to
            unpin: a pinned project lists every session it holds, so most rows
            here are not individually pinned, and a hard-coded "unpin" would
            drop a pin the user never placed. */}
        <Tooltip label={t(session.pinned ? 'menu.unpinSession' : 'menu.pinSession')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={styles.action}
            aria-label={t(session.pinned ? 'menu.unpinSession' : 'menu.pinSession')}
            onClick={() => { onAction(session.pinned ? 'unpinSession' : 'pinSession') }}
          >
            {session.pinned ? <OfficialPinFillIcon size={14} /> : <OfficialPinOutlineIcon size={14} />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * The trailing `...` button and its menu.
 *
 * Built from the shared action lists, so the rows it shows are the same ones the
 * official menu gains. The button stops propagation because it lives inside a
 * clickable row: without that, opening the menu would also toggle the group.
 */
function RowMenuButton(props: {
  t: Translate
  actions: readonly RowAction[]
  label: string
  /** Told when this menu opens/closes, so the row can mark itself. */
  onOpenChange?: (open: boolean) => void
  onSelect: (actionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const setOpenAndReport = (next: boolean): void => {
    setOpen(next)
    props.onOpenChange?.(next)
  }
  // Rows are rendered as `MenuItemButton` COMPONENTS, not as `items` data.
  //
  // The official Menu supports both, and they are not equivalent: the data path
  // has no notion of a group, so it cannot draw the hairline that separates a
  // plugin's rows from the host's. The host's own project menu passes its rows
  // as children, which is why it showed a separator and this menu did not —
  // measured side by side, the two were identical in every other respect
  // (card border/shadow/padding/radius, and the 3px above the first row and
  // below the last) and differed only by that one hairline.
  //
  // So both menus now go through the same path: same row component, same
  // separator support, same keyboard walk and focus return.
  const rows = props.actions
  return (
    <Menu
      open={open}
      portal
      onSelect={() => undefined}
      onClose={() => { setOpenAndReport(false) }}
      anchor={(
        <button
          type="button"
          className={styles.action}
          aria-label={props.label}
          onClick={(event) => {
            event.stopPropagation()
            setOpenAndReport(!open)
          }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    >
      {rows.map((action) => (
        <MenuItemButton
          key={action.id}
          // The first row of the plugin's own block starts a new group, exactly
          // as the host's rows do when the plugin's rows follow them.
          separatorBefore={action === rows[0]}
          icon={<MenuRowIcon name={action.icon} />}
          danger={action.danger}
          disabled={action.disabled}
          onSelect={() => {
            setOpenAndReport(false)
            props.onSelect(action.id)
          }}
        >
          {props.t(action.labelKey)}
        </MenuItemButton>
      ))}
    </Menu>
  )
}

/**
 * A title that reveals its overflow by crawling while the pointer is over it,
 * with the same edge masks the official rows use.
 */
function MarqueeTitle(props: { text: string; className: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const marquee = useTitleMarquee(ref)
  return (
    <span
      ref={ref}
      className={props.className}
      onPointerEnter={marquee.enter}
      onPointerLeave={marquee.leave}
    >
      {props.prefix === undefined ? null : <span className={styles.owner}>{props.prefix}</span>}
      {props.text}
    </span>
  )
}

/** Rows the folded header reports: projects plus the sessions they hold. */
function countEntries(rows: readonly PinnedRow[]): number {
  let total = 0
  for (const row of rows) total += row.kind === 'workspace' ? 1 + row.sessions.length : 1
  return total
}

/** The label naming what a blocked session is waiting for. */
function waitLabelKey(kind: WaitKind): WorkspacePlusKey {
  switch (kind) {
    case 'approval': return 'row.waiting.approval'
    case 'plan-review': return 'row.waiting.planReview'
    case 'question': return 'row.waiting.question'
  }
}

/** Project the session list into the panel's minimal view. */
function sessionViews(list: SessionListState): Record<string, PinnedSessionLike | undefined> {
  const view: Record<string, PinnedSessionLike | undefined> = {}
  for (const [id, session] of Object.entries(list.byId)) {
    view[id] = {
      id,
      title: sessionTitleOf(session, session.displayTitle),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
      ...(session.blank === true ? { blank: true } : {}),
      ...(session.origin === 'subagent' ? { subagent: true } : {}),
    }
  }
  return view
}

type PinnedSessionLike = {
  id: string
  title: string
  updatedAt: number
  blank?: boolean
  subagent?: boolean
}

/**
 * One session summary by plain-string id.
 *
 * The list is keyed by the platform's branded SessionId, which a DOM attribute
 * or a slot's owner props cannot carry; the cast is confined to this lookup.
 */
function sessionAt(list: SessionListState, id: string): SessionSummary | undefined {
  return list.byId[id as SessionId]
}
