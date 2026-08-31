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
  type MultiRepoProject,
  type RepoFolder,
  type WorkspaceView,
} from '../shared'
import { commitBinding, type WorkspaceFace } from './commit'
import { askEdit } from './flow'
import type { MultiRepoKey } from './locales'
import { getProjects, refreshProjects, subscribeProjects } from './projects'
import styles from './ProjectRowChrome.module.css'

export interface ProjectRowChromeInjected {
  t: (key: MultiRepoKey) => string
  workspaces: WorkspaceFace
}

export interface ProjectRowChromeProps extends Partial<ProjectRowChromeInjected> {
  useSessions?: SnapshotSelectorHook<SessionListState>
  useWorkspaces?: SnapshotSelectorHook<{ items: readonly WorkspaceView[] }>
}

interface RowMatch {
  row: HTMLElement
  actions: HTMLElement
  actionSlot: HTMLElement
  folder: HTMLElement | null
  project: MultiRepoProject | null
  workspace: WorkspaceView
  collapsed: boolean
  running: boolean
}

interface CardMatch {
  card: HTMLElement
  project: MultiRepoProject
}

export function ProjectRowChrome(props: ProjectRowChromeProps) {
  const translate = props.t ?? ((key: MultiRepoKey) => key)
  const useSessions = props.useSessions
  const useWorkspaces = props.useWorkspaces
  const items = useWorkspaces === undefined ? emptyWorkspaces : useWorkspaces((state) => state.items)
  const byId = useSessions === undefined ? emptyById : useSessions((state) => state.byId)
  const projects = useSyncExternalStore(subscribeProjects, getProjects, getProjects)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    void refreshProjects().catch(() => undefined)
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
    () => collectRowMatches(items, byId, projects),
    [items, byId, projects, epoch],
  )
  const cards = useMemo(
    () => collectCardMatches(projects),
    [projects, epoch],
  )

  const edit = async (match: RowMatch): Promise<void> => {
    const seed = seedRepos(match.workspace, match.project)
    const decision = await askEdit({
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
                data-multi-repo-chrome="1"
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
              data-multi-repo-chrome="1"
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
        <div key={card.project.root} className={styles.paths} data-multi-repo-chrome="1">
          {orderedRepos(card.project).map((repo, index) => (
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
  projects: readonly MultiRepoProject[],
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
    const project = projectForPath(projects, workspace.path)
    const running = workspace.sessionIds.some((id) => byId[id]?.running === true)
    matches.push({
      row,
      actions,
      actionSlot: ensureActionSlot(actions),
      folder: folder instanceof HTMLElement ? folder : null,
      project,
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
    return !(target instanceof HTMLElement && target.closest('[data-multi-repo-chrome]'))
  }
  const nodes = [...record.addedNodes, ...record.removedNodes]
  return nodes.some((node) => {
    if (!(node instanceof HTMLElement)) return node.nodeType === Node.ELEMENT_NODE
    return !node.hasAttribute('data-multi-repo-chrome') && node.closest('[data-multi-repo-chrome]') === null
  })
}

function collectCardMatches(projects: readonly MultiRepoProject[]): CardMatch[] {
  if (projects.length === 0) return []
  const matches: CardMatch[] = []
  for (const node of document.querySelectorAll<HTMLElement>('[role="button"][aria-label]')) {
    const label = node.getAttribute('aria-label') ?? ''
    const path = copyPathFromLabel(label)
    if (path === null) continue
    const project = projectForPath(projects, path)
    if (project === null || project.repos.length < 2) continue
    matches.push({ card: node, project })
  }
  return matches
}

/** Keep New Session as the last host control; park the edit button immediately before it. */
function ensureActionSlot(actions: HTMLElement): HTMLElement {
  const existing = actions.querySelector(':scope > [data-multi-repo-chrome="slot"]')
  if (existing instanceof HTMLElement) return existing
  const slot = document.createElement('span')
  slot.setAttribute('data-multi-repo-chrome', 'slot')
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
    if (!(child instanceof HTMLElement) || child.hasAttribute('data-multi-repo-chrome')) continue
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

function seedRepos(workspace: WorkspaceView, project: MultiRepoProject | null): {
  repos: RepoFolder[]
  primaryPath: string
  title: string
} {
  if (project !== null) {
    return {
      repos: project.repos,
      primaryPath: project.primaryPath,
      title: project.title,
    }
  }
  return {
    repos: [{ name: folderName(workspace.path), path: workspace.path, kind: 'folder' }],
    primaryPath: workspace.path,
    title: workspace.title,
  }
}

function projectForPath(projects: readonly MultiRepoProject[], path: string): MultiRepoProject | null {
  for (const project of projects) {
    if (samePath(project.root, path) || samePath(project.primaryPath, path)) return project
    if (project.repos.some((repo) => samePath(repo.path, path))) return project
  }
  return null
}
