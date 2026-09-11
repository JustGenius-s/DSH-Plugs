import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal, Toast, type MenuEntry } from '@just-genius/dsh-plugin-ui'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import {
  archiveSession,
  copyText,
  deepLink,
  findSession,
  findWorkspace,
  forkSession,
  newSession,
  openInExplorer,
  refreshSessions,
  removeWorkspace,
  renameSession,
  renameWorkspace,
  sessionTitleOf,
  workspaceIdForSession,
} from './actions.ts'
import { PROJECT_PATH } from '../shared.ts'
import { postJson } from './http.ts'
import { refreshBindings } from './bindings.ts'
import { getMenuState, isEnabled, setPin, setUnreadSessions, subscribeMenuState, toggleId, type FeatureKey } from './features.ts'
import type { WorkspacePlusKey } from './locales.ts'
import { RowMenu, type MenuAnchor } from './RowMenu.tsx'
import { rowInfo, tagRows, type RowInfo } from './rows.ts'
import { isPinned } from './pins.ts'
import { PinnedSection } from './PinnedSection.tsx'

export interface RowMenuOverlayInjected {
  t?: (key: WorkspacePlusKey) => string
  ctx?: ClientContext
}

interface OpenMenu {
  row: RowInfo
  anchor: MenuAnchor
}

interface RenameRequest {
  title: string
  initial: string
  confirm: (next: string) => Promise<void>
}

/**
 * Owns the row menus: listens for the trigger gestures, builds the enabled
 * entries for the row under the pointer, and runs the chosen action.
 *
 * Rendered as a `shell.overlay` so it shares one React root with the rest of
 * the plugin instead of managing its own.
 */
export function RowMenuOverlay({ t, ctx }: RowMenuOverlayInjected) {
  const translate = t ?? ((key: WorkspacePlusKey) => key)
  const state = useSyncExternalStore(subscribeMenuState, getMenuState, getMenuState)
  const [open, setOpen] = useState<OpenMenu | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [pending, setPending] = useState<RenameRequest | null>(null)

  const flash = useCallback((key: WorkspacePlusKey) => {
    setToast({ id: Date.now(), text: translate(key) })
  }, [translate])

  const close = useCallback(() => { setOpen(null) }, [])

  // Re-tag rows whenever pin/unread state or the DOM changes, so the CSS
  // badges follow the user's actions without a full reload.
  useEffect(() => {
    tagRows(state)
  }, [state])

  useEffect(() => {
    let raf = 0
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(() => { tagRows(getMenuState()) })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (ctx === undefined) return
    const onGesture = (event: MouseEvent): void => {
      if (event.type === 'dblclick' && !isEnabled('dblclick', state)) return
      if (event.type === 'contextmenu' && !isEnabled('contextmenu', state)) return
      const target = event.target instanceof Element ? event.target : undefined
      const row = target?.closest<HTMLElement>('[role="treeitem"]')
      if (row === null || row === undefined) return
      const info = rowInfo(row)
      if (info === undefined) return
      if (event.type === 'contextmenu') event.preventDefault()
      event.stopPropagation()
      setOpen({ row: info, anchor: { x: event.clientX, y: event.clientY } })
    }

    document.addEventListener('dblclick', onGesture, true)
    document.addEventListener('contextmenu', onGesture, true)
    return () => {
      document.removeEventListener('dblclick', onGesture, true)
      document.removeEventListener('contextmenu', onGesture, true)
    }
  }, [ctx, state])

  const items = useMemo(() => {
    if (open === null || ctx === undefined) return []
    return open.row.kind === 'workspace'
      ? workspaceEntries(ctx, open.row, state.features, translate)
      : sessionEntries(ctx, open.row, state.features, translate)
  }, [open, ctx, state, translate])

  const onSelect = useCallback((id: string) => {
    if (open === null || ctx === undefined) return
    setOpen(null)
    void run(ctx, open.row, id, { flash, setPending, translate })
  }, [open, ctx, flash, translate])

  return (
    <>
      {ctx !== undefined ? (
        <PinnedSection
          ctx={ctx}
          state={state}
          t={translate}
          onMenu={(row, anchor) => { setOpen({ row, anchor }) }}
          onUnpin={(pin) => {
            void Promise.resolve(setPin(pin, false)).then(
              () => { flash('toast.unpinned') },
              () => { flash('toast.failed') },
            )
          }}
          onError={() => { flash('toast.openFailed') }}
        />
      ) : null}
      {open !== null && ctx !== undefined
        ? (
          <RowMenu
            items={items}
            anchor={open.anchor}
            onSelect={onSelect}
            onClose={close}
          />
        )
        : null}
      {pending !== null
        ? (
          <RenameDialog
            title={pending.title}
            initial={pending.initial}
            cancelLabel={translate('cancel')}
            saveLabel={translate('modal.save')}
            onCancel={() => { setPending(null) }}
            onSubmit={(next) => {
              setPending(null)
              void pending.confirm(next).catch(() => { flash('toast.renameFailed') })
            }}
          />
        )
        : null}
      {toast !== null
        ? (
          <Toast
            key={toast.id}
            text={toast.text}
            onDone={() => { setToast(null) }}
          />
        )
        : null}
    </>
  )
}

/** Single-line rename prompt shared by the workspace and session rows. */
function RenameDialog(props: {
  title: string
  initial: string
  cancelLabel: string
  saveLabel: string
  onCancel: () => void
  onSubmit: (next: string) => void
}) {
  const [value, setValue] = useState(props.initial)
  const trimmed = value.trim()
  const submit = (): void => {
    if (trimmed === '') return
    props.onSubmit(trimmed)
  }
  return (
    <Modal
      open
      title={props.title}
      closeLabel={props.cancelLabel}
      onClose={props.onCancel}
      footer={(
        <>
          <Button variant="outline" onClick={props.onCancel}>{props.cancelLabel}</Button>
          <Button variant="primary" disabled={trimmed === ''} onClick={submit}>{props.saveLabel}</Button>
        </>
      )}
    >
      <Input
        value={value}
        autoFocus
        onChange={(event) => { setValue(event.currentTarget.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
      />
    </Modal>
  )
}

// ── Entry builders ────────────────────────────────────────────────────────

type Flags = Record<FeatureKey, boolean>

function on(flags: Flags, key: FeatureKey): boolean {
  return flags[key] !== false
}

/** Enabled menu rows for a workspace (Project) row. */
function workspaceEntries(
  ctx: ClientContext,
  row: RowInfo,
  flags: Flags,
  t: (key: WorkspacePlusKey) => string,
): MenuEntry[] {
  const entries: MenuEntry[] = []
  const pinned = isPinned(getMenuState().pins, row)
  const workspace = findWorkspace(ctx, row.id)

  if (on(flags, 'workspacePin')) {
    entries.push({ id: 'pin', label: pinned ? t('menu.unpin') : t('menu.pin'), disabled: workspace === undefined })
  }
  if (on(flags, 'workspaceRename')) {
    entries.push({ id: 'rename', label: t('menu.rename') })
  }
  if (on(flags, 'workspaceOpenExplorer')) {
    entries.push({ id: 'openExplorer', label: t('menu.openExplorer'), disabled: workspace === undefined })
  }
  if (on(flags, 'workspaceCopyPath')) {
    entries.push({ id: 'copyPath', label: t('menu.copyPath'), disabled: workspace === undefined })
  }
  if (on(flags, 'workspaceNewSession')) {
    entries.push({ id: 'newSession', label: t('menu.newSession') })
  }
  if (on(flags, 'workspaceDelete')) {
    entries.push({
      id: 'remove',
      label: t('menu.removeFromList'),
      danger: true,
      disabled: workspace === undefined,
    })
  }
  return entries
}

/** Enabled menu rows for a session (Chat) row. */
function sessionEntries(
  ctx: ClientContext,
  row: RowInfo,
  flags: Flags,
  t: (key: WorkspacePlusKey) => string,
): MenuEntry[] {
  const entries: MenuEntry[] = []
  const state = getMenuState()
  const workspaceId = workspaceIdForSession(ctx, row.id)
  const pinned = isPinned(state.pins, row)
  const unread = state.unreadSessions.includes(row.id)
  const session = findSession(ctx, row.id)

  if (on(flags, 'sessionPin')) {
    entries.push({
      id: 'pin',
      label: pinned ? t('menu.unpin') : t('menu.pin'),
      disabled: !pinned && workspaceId === undefined,
    })
  }
  if (on(flags, 'sessionRename')) {
    entries.push({ id: 'rename', label: t('menu.rename') })
  }
  if (on(flags, 'sessionUnread')) {
    entries.push({ id: 'unread', label: unread ? t('menu.markRead') : t('menu.markUnread') })
  }
  if (on(flags, 'sessionArchive')) {
    entries.push({ id: 'archive', label: t('menu.archive') })
  }
  if (on(flags, 'sessionFork')) {
    entries.push({ id: 'fork', label: t('menu.fork') })
  }
  if (on(flags, 'sessionCopyLink')) {
    entries.push({ id: 'copyLink', label: t('menu.copyLink') })
  }
  if (on(flags, 'sessionCopyTitle')) {
    entries.push({ id: 'copyTitle', label: t('menu.copyTitle') })
  }
  if (on(flags, 'sessionOpenWindow')) {
    entries.push({ id: 'openWindow', label: t('menu.openWindow') })
  }
  if (on(flags, 'sessionOpenFolder')) {
    entries.push({
      id: 'openFolder',
      label: t('menu.openFolder'),
      disabled: session?.cwd === undefined,
    })
  }
  return entries
}

// ── Dispatch ──────────────────────────────────────────────────────────────

interface RunDeps {
  flash: (key: WorkspacePlusKey) => void
  setPending: (request: RenameRequest | null) => void
  translate: (key: WorkspacePlusKey) => string
}

async function run(
  ctx: ClientContext,
  row: RowInfo,
  id: string,
  deps: RunDeps,
): Promise<void> {
  try {
    await dispatch(ctx, row, id, deps)
  } catch (error) {
    console.warn('[dsh-workspace-plus] row action failed', error)
    deps.flash('toast.failed')
  }
}

async function dispatch(
  ctx: ClientContext,
  row: RowInfo,
  id: string,
  deps: RunDeps,
): Promise<void> {
  const { flash, setPending, translate: t } = deps
  const state = getMenuState()

  if (row.kind === 'workspace') {
    const workspace = findWorkspace(ctx, row.id)
    switch (id) {
      case 'pin': {
        if (workspace === undefined) return
        const pinned = !isPinned(state.pins, row)
        await setPin({ kind: 'workspace', id: row.id }, pinned)
        flash(pinned ? 'toast.pinned' : 'toast.unpinned')
        return
      }
      case 'rename': {
        setPending({
          title: t('menu.renameWorkspace'),
          initial: row.title,
          confirm: async (next) => {
            await renameWorkspace(ctx, row.id, next)
            flash('toast.renamed')
          },
        })
        return
      }
      case 'openExplorer': {
        if (workspace === undefined) return
        await openInExplorer(workspace.path)
        return
      }
      case 'copyPath': {
        if (workspace === undefined) return
        flash((await copyText(workspace.path)) ? 'toast.pathCopied' : 'toast.copyFailed')
        return
      }
      case 'newSession': {
        newSession(ctx, row.id)
        return
      }
      case 'remove': {
        if (workspace === undefined) return
        // Drop the multi-folder binding with the row; otherwise re-adding the
        // same directory would silently resurrect the old extra folders.
        await postJson(PROJECT_PATH, { action: 'delete', root: workspace.path }).catch(() => undefined)
        await refreshBindings().catch(() => undefined)
        await removeWorkspace(ctx, row.id)
        flash('toast.removed')
        return
      }
      default:
        return
    }
  }

  const session = findSession(ctx, row.id)
  const sessionTitle = sessionTitleOf(session, row.title)
  switch (id) {
    case 'pin': {
      const workspaceId = workspaceIdForSession(ctx, row.id)
      const pinned = !isPinned(state.pins, row)
      if (pinned && workspaceId === undefined) return
      await setPin({ kind: 'session', id: row.id, workspaceId: workspaceId ?? '' }, pinned)
      flash(pinned ? 'toast.pinned' : 'toast.unpinned')
      return
    }
    case 'rename': {
      setPending({
        title: t('menu.renameSession'),
        initial: sessionTitle,
        confirm: async (next) => {
          await renameSession(ctx, row.id, next)
          flash('toast.renamed')
        },
      })
      return
    }
    case 'unread': {
      const unread = !state.unreadSessions.includes(row.id)
      setUnreadSessions(toggleId(state.unreadSessions, row.id))
      flash(unread ? 'toast.markedUnread' : 'toast.markedRead')
      return
    }
    case 'archive': {
      await archiveSession(ctx, row.id)
      refreshSessions(ctx)
      flash('toast.archived')
      return
    }
    case 'fork': {
      await forkSession(ctx, row.id)
      return
    }
    case 'copyLink': {
      flash((await copyText(deepLink(row.id))) ? 'toast.linkCopied' : 'toast.copyFailed')
      return
    }
    case 'copyTitle': {
      flash((await copyText(sessionTitle)) ? 'toast.titleCopied' : 'toast.copyFailed')
      return
    }
    case 'openWindow': {
      window.open(deepLink(row.id), '_blank')
      return
    }
    case 'openFolder': {
      if (session?.cwd === undefined) return
      await openInExplorer(session.cwd)
      return
    }
    default:
      return
  }
}
