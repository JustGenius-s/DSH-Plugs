import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type {
  SessionListState,
} from '@just-genius/dsh-plugin-runtime/client'
import type { SnapshotSelectorHook } from '@just-genius/dsh-plugin-runtime/client'
import { IconEditOutline16, StateDot } from '@just-genius/dsh-plugin-ui'
import {
  folderName,
  orderedRepos,
  samePath,
  type WorkspaceBinding,
  type RepoFolder,
  type WorkspaceView,
} from '../shared.ts'
import { commitBinding, type WorkspaceFace } from './commit.ts'
import { askEditBinding } from './flow.ts'
import type { WorkspacePlusKey } from './locales.ts'
import { getBindings, refreshBindings, subscribeBindings } from './bindings.ts'
import styles from './WorkspaceRowChrome.module.css'

export interface WorkspaceRowChromeInjected {
  t: (key: WorkspacePlusKey) => string
  workspaces: WorkspaceFace
}

export interface WorkspaceRowChromeProps extends Partial<WorkspaceRowChromeInjected> {
  useSessions?: SnapshotSelectorHook<SessionListState>
  useWorkspaces?: SnapshotSelectorHook<{ items: readonly WorkspaceView[] }>
}

interface RowMatch {
  row: HTMLElement
  actions: HTMLElement
  actionSlot: HTMLElement
  folder: HTMLElement | null
  binding: WorkspaceBinding | null
  workspace: WorkspaceView
  collapsed: boolean
  running: boolean
}

interface CardMatch {
  card: HTMLElement
  binding: WorkspaceBinding
}

export function WorkspaceRowChrome(props: WorkspaceRowChromeProps) {
  const translate = props.t ?? ((key: WorkspacePlusKey) => key)
  const useSessions = props.useSessions
  const useWorkspaces = props.useWorkspaces
  const items = useWorkspaces === undefined ? emptyWorkspaces : useWorkspaces((state) => state.items)
  const byId = useSessions === undefined ? emptyById : useSessions((state) => state.byId)
  const bindings = useSyncExternalStore(subscribeBindings, getBindings, getBindings)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    void refreshBindings().catch(() => undefined)
  }, [])

  useEffect(() => {
    let frame = 0
    const bump = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { setEpoch((value) => value + 1) })
    }
    const observer = new MutationObserver((records) => {
      if (records.some(isHostMutation)) bump()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-label'],
    })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  const matches = useMemo(
    () => collectRowMatches(items, byId, bindings),
    [items, byId, bindings, epoch],
  )
  const cards = useMemo(
    () => collectCardMatches(bindings),
    [bindings, epoch],
  )

  const edit = async (match: RowMatch): Promise<void> => {
    const seed = seedRepos(match.workspace, match.binding)
    const decision = await askEditBinding({
      repos: seed.repos,
      primaryPath: seed.primaryPath,
      title: seed.title,
    })
    if (decision.kind !== 'multi' || props.workspaces === undefined) return
    await commitBinding(decision, {
      workspaces: props.workspaces,
      workspaceId: match.workspace.workspaceId,
      previousPrimaryPath: seed.primaryPath,
    })
  }

  return (
    <>
      {matches.map((match) => (
        <span key={match.workspace.workspaceId}>
          {match.collapsed && match.running && match.folder !== null
            ? createPortal(
              <span
                className={styles.busy}
                data-workspace-plus-chrome="1"
                title={translate('row.running')}
                aria-label={translate('row.running')}
              >
                <StateDot state="ongoing" />
              </span>,
              match.folder,
            )
            : null}
          {createPortal(
            <button
              type="button"
              className={styles.edit}
              data-workspace-plus-chrome="1"
              aria-label={translate('edit')}
              title={translate('edit')}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void edit(match)
              }}
            >
              <IconEditOutline16 />
            </button>,
            match.actionSlot,
          )}
        </span>
      ))}
      {cards.map((card) => createPortal(
        <div key={card.binding.root} className={styles.paths} data-workspace-plus-chrome="1">
          {orderedRepos(card.binding).map((repo, index) => (
            <div
              key={repo.path}
              className={styles.path}
              data-primary={index === 0 ? 'true' : undefined}
            >
              {index === 0 ? `${translate('primary')} · ${repo.path}` : repo.path}
            </div>
          ))}
        </div>,
        card.card,
      ))}
    </>
  )
}

const emptyWorkspaces: readonly WorkspaceView[] = []
const emptyById: SessionListState['byId'] = {}

function collectRowMatches(
  items: readonly WorkspaceView[],
  byId: SessionListState['byId'],
  bindings: readonly WorkspaceBinding[],
): RowMatch[] {
  const matches: RowMatch[] = []
  for (const row of document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]')) {
    const title = row.children.item(2)?.textContent?.trim() ?? ''
    if (title === '') continue
    const workspace = items.find((item) => item.title === title)
    if (workspace === undefined) continue
    const actions = row.children.item(row.children.length - 1)
    if (!(actions instanceof HTMLElement)) continue
    const folder = row.children.item(0)
    const binding = bindingForPath(bindings, workspace.path)
    const running = workspace.sessionIds.some((id) => byId[id]?.running === true)
    matches.push({
      row,
      actions,
      actionSlot: ensureActionSlot(actions),
      folder: folder instanceof HTMLElement ? folder : null,
      binding,
      workspace,
      collapsed: row.getAttribute('aria-expanded') === 'false',
      running,
    })
  }
  return matches
}

function isHostMutation(record: MutationRecord): boolean {
  if (record.type === 'attributes') {
    const target = record.target
    return !(target instanceof HTMLElement && target.closest('[data-workspace-plus-chrome]'))
  }
  const nodes = [...record.addedNodes, ...record.removedNodes]
  return nodes.some((node) => {
    if (!(node instanceof HTMLElement)) return node.nodeType === Node.ELEMENT_NODE
    return !node.hasAttribute('data-workspace-plus-chrome') && node.closest('[data-workspace-plus-chrome]') === null
  })
}

function collectCardMatches(bindings: readonly WorkspaceBinding[]): CardMatch[] {
  if (bindings.length === 0) return []
  const matches: CardMatch[] = []
  for (const node of document.querySelectorAll<HTMLElement>('[role="button"][aria-label]')) {
    const label = node.getAttribute('aria-label') ?? ''
    const path = copyPathFromLabel(label)
    if (path === null) continue
    const binding = bindingForPath(bindings, path)
    if (binding === null || binding.repos.length < 2) continue
    matches.push({ card: node, binding })
  }
  return matches
}

/** Keep New Session as the last host control; park the edit button immediately before it. */
function ensureActionSlot(actions: HTMLElement): HTMLElement {
  const existing = actions.querySelector(':scope > [data-workspace-plus-chrome="slot"]')
  if (existing instanceof HTMLElement) return existing
  const slot = document.createElement('span')
  slot.setAttribute('data-workspace-plus-chrome', 'slot')
  slot.className = styles.slot
  const plus = lastHostAction(actions)
  if (plus !== null) {
    if (slot.nextElementSibling !== plus) actions.insertBefore(slot, plus)
  } else if (slot.parentElement !== actions) {
    actions.appendChild(slot)
  }
  return slot
}

function lastHostAction(actions: HTMLElement): Element | null {
  for (let i = actions.children.length - 1; i >= 0; i -= 1) {
    const child = actions.children.item(i)
    if (!(child instanceof HTMLElement) || child.hasAttribute('data-workspace-plus-chrome')) continue
    return child
  }
  return null
}

function copyPathFromLabel(label: string): string | null {
  const match = /^(?:复制|Copy):\s*(.+)$/.exec(label)
  if (match === null) return null
  const path = match[1]?.trim() ?? ''
  return path === '' ? null : path
}

function seedRepos(workspace: WorkspaceView, binding: WorkspaceBinding | null): {
  repos: RepoFolder[]
  primaryPath: string
  title: string
} {
  if (binding !== null) {
    return {
      repos: binding.repos,
      primaryPath: binding.primaryPath,
      title: binding.title,
    }
  }
  return {
    repos: [{ name: folderName(workspace.path), path: workspace.path, kind: 'folder' }],
    primaryPath: workspace.path,
    title: workspace.title,
  }
}

function bindingForPath(bindings: readonly WorkspaceBinding[], path: string): WorkspaceBinding | null {
  for (const binding of bindings) {
    if (samePath(binding.root, path) || samePath(binding.primaryPath, path)) return binding
    if (binding.repos.some((repo) => samePath(repo.path, path))) return binding
  }
  return null
}
