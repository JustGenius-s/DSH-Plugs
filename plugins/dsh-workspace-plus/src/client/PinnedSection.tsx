import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'
import {
  IconCloseOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconNewChatOutline16,
  StateDot,
  Tooltip,
} from '@just-genius/dsh-plugin-ui'

import type { MenuState } from './features.ts'
import type { WorkspacePlusKey } from './locales.ts'
import { isPinned, pinLayout, pinnedItems, type Pin, type PinLayout, type PinnedItem } from './pins.ts'
import { isWorkspaceBrowserTree, rowInfo, type RowInfo } from './rows.ts'
import type { MenuAnchor } from './RowMenu.tsx'
import { openSession, openWorkspace, sessionTitleOf } from './session-commands.ts'
import styles from './PinnedSection.module.css'

interface PinnedSectionProps {
  ctx: ClientContext
  state: MenuState
  t: (key: WorkspacePlusKey) => string
  onMenu: (row: RowInfo, anchor: MenuAnchor) => void
  onUnpin: (pin: Pin) => void
  onError: () => void
}

interface TreeMount {
  tree: HTMLElement
  groups: ReadonlyMap<string, HTMLElement>
}

function collectMounts(): TreeMount[] {
  const mounts: TreeMount[] = []
  for (const tree of document.querySelectorAll<HTMLElement>('[role="tree"]')) {
    if (!isWorkspaceBrowserTree(tree)) continue
    const groups = new Map<string, HTMLElement>()
    for (const row of tree.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]')) {
      if (row.closest('[data-workspace-plus-pins]') !== null || row.closest('[role="tree"]') !== tree) continue
      const info = rowInfo(row)
      if (info?.kind !== 'workspace') continue
      let group = row
      while (group.parentElement !== null && group.parentElement !== tree) group = group.parentElement
      if (group.parentElement === tree) groups.set(info.id, group)
    }
    mounts.push({ tree, groups })
  }
  return mounts
}

function sameMounts(a: readonly TreeMount[], b: readonly TreeMount[]): boolean {
  return a.length === b.length && a.every((mount, index) => {
    const other = b[index]
    return mount.tree === other.tree && mount.groups.size === other.groups.size
      && [...mount.groups].every(([id, group]) => other.groups.get(id) === group)
  })
}

function ownMutation(record: MutationRecord): boolean {
  return record.target instanceof Element
    && record.target.closest('[data-workspace-plus-pins]') !== null
}

export function PinnedSection(props: PinnedSectionProps) {
  const { ctx, state, t, onMenu, onUnpin, onError } = props
  const sources = useMemo(() => {
    const workspaces = getWorkspaces(ctx).list
    const sessions = getSessions(ctx).list
    return {
      workspaces: {
        subscribe: (listener: () => void) => workspaces.subscribe(listener),
        snapshot: () => workspaces.getSnapshot(),
      },
      sessions: {
        subscribe: (listener: () => void) => sessions.subscribe(listener),
        snapshot: () => sessions.getSnapshot(),
      },
    }
  }, [ctx])
  const workspaces = useSyncExternalStore(sources.workspaces.subscribe, sources.workspaces.snapshot)
  const sessions = useSyncExternalStore(sources.sessions.subscribe, sources.sessions.snapshot)
  const layout = useMemo(() => pinLayout(pinnedItems(
    state.pins, workspaces.items, sessions.byId, workspaces.archivedSessionIds,
  )), [state.pins, workspaces, sessions])
  const [mounts, setMounts] = useState<TreeMount[]>([])
  const hasPins = layout.entries.length > 0

  useLayoutEffect(() => {
    if (!hasPins) return
    let frame = 0
    const scan = (): void => {
      const next = collectMounts()
      setMounts((previous) => sameMounts(previous, next) ? previous : next)
    }
    const observer = new MutationObserver((records) => {
      if (records.every(ownMutation)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(scan)
    })
    scan()
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [hasPins])

  useEffect(() => {
    const guardPinnedProjectDrag = (event: DragEvent): void => {
      if (!(event.target instanceof Element)) return
      const row = event.target.closest('[role="treeitem"]')
      if (row === null) return
      const info = rowInfo(row)
      if (info?.kind === 'workspace' && isPinned(state.pins, info)) event.preventDefault()
    }
    document.addEventListener('dragstart', guardPinnedProjectDrag, true)
    return () => { document.removeEventListener('dragstart', guardPinnedProjectDrag, true) }
  }, [state.pins])

  if (!hasPins) return null
  return <>{mounts.map((mount, index) => (
    <PinnedTree
      key={index}
      mount={mount}
      layout={layout}
      currentSessionId={sessions.current}
      unreadSessions={state.unreadSessions}
      t={t}
      onMenu={onMenu}
      onUnpin={onUnpin}
      onOpen={(item) => {
        void Promise.resolve().then(() => {
          if (item.kind === 'workspace') return openWorkspace(ctx, item.pin.id)
          openSession(ctx, item.pin.id)
        }).catch(onError)
      }}
    />
  ))}</>
}

interface PinnedTreeProps {
  mount: TreeMount
  layout: PinLayout
  currentSessionId?: string
  unreadSessions: readonly string[]
  t: PinnedSectionProps['t']
  onMenu: PinnedSectionProps['onMenu']
  onUnpin: PinnedSectionProps['onUnpin']
  onOpen: (item: PinnedItem) => void
}

/** Leave React's native groups and host order intact; undo all styling on unpin. */
function PinnedTree({ mount, layout, currentSessionId, unreadSessions, t, onMenu, onUnpin, onOpen }: PinnedTreeProps) {
  useLayoutEffect(() => {
    const { tree, groups } = mount
    const previousLayout = tree.getAttribute('data-workspace-plus-pin-layout')
    tree.setAttribute('data-workspace-plus-pin-layout', '')
    const restoreGroups: (() => void)[] = []
    for (const { item, order } of layout.entries) {
      if (item.kind !== 'workspace') continue
      const group = groups.get(item.pin.id)
      if (group === undefined) continue
      const property = '--workspace-plus-pin-order'
      const previousOrder = group.style.getPropertyValue(property)
      const previousPriority = group.style.getPropertyPriority(property)
      const previousMarker = group.getAttribute('data-workspace-plus-pinned-group')
      group.style.setProperty(property, String(order))
      group.setAttribute('data-workspace-plus-pinned-group', item.pin.id)
      restoreGroups.push(() => {
        if (group.style.getPropertyValue(property) === String(order)) {
          if (previousOrder === '') group.style.removeProperty(property)
          else group.style.setProperty(property, previousOrder, previousPriority)
        }
        if (previousMarker === null) group.removeAttribute('data-workspace-plus-pinned-group')
        else group.setAttribute('data-workspace-plus-pinned-group', previousMarker)
      })
    }
    return () => {
      for (const restore of restoreGroups) restore()
      if (previousLayout === null) tree.removeAttribute('data-workspace-plus-pin-layout')
      else tree.setAttribute('data-workspace-plus-pin-layout', previousLayout)
    }
  }, [mount, layout])

  return createPortal(
    <>
      <div className={styles.heading} style={{ order: layout.headerOrder }} data-workspace-plus-pins="heading" role="presentation">
        {t('pins.title')}
      </div>
      {layout.entries.map(({ key, item, order }) => {
        if (item.kind === 'workspace' && mount.groups.has(item.pin.id)) return null
        const title = item.kind === 'workspace'
          ? item.workspace.title
          : sessionTitleOf(item.session, item.pin.id)
        return (
          <PinnedShortcut
            key={key}
            workspacePlusRow={{ kind: item.kind, id: item.pin.id, title }}
            item={item}
            order={order}
            selected={item.kind === 'session' && currentSessionId === item.pin.id}
            unread={item.kind === 'session' && unreadSessions.includes(item.pin.id)}
            t={t}
            onMenu={onMenu}
            onUnpin={onUnpin}
            onOpen={onOpen}
          />
        )
      })}
      <div
        className={styles.divider}
        style={{ order: layout.dividerOrder }}
        data-workspace-plus-pins="divider"
        role="separator"
      />
    </>,
    mount.tree,
  )
}

function PinnedShortcut({ workspacePlusRow, item, order, selected, unread, t, onOpen, onMenu, onUnpin }: {
  workspacePlusRow: RowInfo
  item: PinnedItem
  order: number
  selected: boolean
  unread: boolean
  t: PinnedSectionProps['t']
  onMenu: PinnedSectionProps['onMenu']
  onUnpin: PinnedSectionProps['onUnpin']
  onOpen: (item: PinnedItem) => void
}) {
  const workspaceTitle = item.kind === 'session' ? item.workspace?.title ?? t('pins.ungrouped') : undefined
  const status = item.kind === 'session'
    ? item.session.running ? 'ongoing' : item.session.completed ? 'done' : undefined
    : undefined
  return (
    <div
      className={styles.row}
      style={{ order }}
      data-workspace-plus-pins="shortcut"
      data-dsh-pinned="true"
      data-dsh-unread={unread ? 'true' : 'false'}
      role="treeitem"
      aria-selected={selected}
      aria-label={workspaceTitle === undefined ? workspacePlusRow.title : `${workspaceTitle}: ${workspacePlusRow.title}`}
    >
      <button type="button" className={styles.open} onClick={() => { onOpen(item) }}>
        <span className={styles.icon}>
          {item.kind === 'workspace'
            ? <IconFolderClose16 />
            : status === undefined ? <IconNewChatOutline16 /> : <StateDot state={status} />}
        </span>
        <span className={styles.text}>
          {workspaceTitle !== undefined ? <span className={styles.workspace} title={workspaceTitle}>{workspaceTitle}</span> : null}
          <span className={styles.title} title={workspacePlusRow.title}>{workspacePlusRow.title}</span>
        </span>
      </button>
      <div className={styles.actions}>
        <Tooltip label={t('menu.unpin')}>
          <button type="button" className={styles.action} aria-label={t('menu.unpin')} onClick={() => { onUnpin(item.pin) }}>
            <IconCloseOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('pins.actions')}>
          <button type="button" className={styles.action} aria-label={t('pins.actions')} onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(workspacePlusRow, { x: rect.left, y: rect.bottom })
          }}>
            <IconEllipsisOutline16 />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
