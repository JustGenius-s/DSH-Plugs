import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import {
  Button,
  Input,
  Menu,
  Modal,
  RiskConfirmation,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  GIT_GRAPH_ACTION_PATH,
  type GitGraphActionName,
  type GitGraphActionRequest,
  type GitGraphActionResponse,
  type GitGraphRow,
  type GitResetMode,
} from '../../../shared/git-graph'

export interface CommitMenuState {
  row: GitGraphRow
  x: number
  y: number
}

interface PendingAction {
  row: GitGraphRow
  action: GitGraphActionName
  mode?: GitResetMode
  branch?: string
}

export function openCommitMenu(
  event: MouseEvent,
  row: GitGraphRow,
  setMenu: (next: CommitMenuState) => void,
): void {
  event.preventDefault()
  event.stopPropagation()
  setMenu({ row, x: event.clientX, y: event.clientY })
}

export function CommitContextMenu(props: {
  menu: CommitMenuState | null
  cwd?: string
  t: (key: string) => string
  onClose: () => void
  onRan: () => void
  onNotice: (text: string, kind: 'ok' | 'error') => void
}) {
  const { menu, cwd, t, onClose, onRan, onNotice } = props
  const [busy, setBusy] = useState(false)
  const [hardReset, setHardReset] = useState<GitGraphRow | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [branchRow, setBranchRow] = useState<GitGraphRow | null>(null)
  const [branchName, setBranchName] = useState('')
  const items = useMemo(() => menuItems(menu?.row, t), [menu?.row, t])

  const run = useCallback(async (pending: PendingAction) => {
    if (cwd === undefined) {
      onNotice(t('gitGraph.noCwd'), 'error')
      return
    }
    setBusy(true)
    const request: GitGraphActionRequest = {
      cwd,
      sha: pending.row.sha,
      action: pending.action,
    }
    if (pending.branch !== undefined) request.branch = pending.branch
    if (pending.mode !== undefined) request.mode = pending.mode
    const result = await postAction(request)
    setBusy(false)
    if (!result.ok) {
      onNotice(result.message, 'error')
      return
    }
    onNotice(result.message ?? t('gitGraph.actionOk'), 'ok')
    onRan()
  }, [cwd, onNotice, onRan, t])

  const onSelect = useCallback((id: string) => {
    if (menu === null || busy) return
    void choose(id, menu.row, cwd, t, {
      onClose,
      onNotice,
      setHardReset,
      setAcknowledged,
      setBranchRow,
      setBranchName,
      run,
    })
  }, [busy, cwd, menu, onClose, onNotice, run, t])

  const closeHardReset = (): void => {
    setHardReset(null)
    setAcknowledged(false)
  }

  const closeBranch = (): void => {
    setBranchRow(null)
    setBranchName('')
  }

  return (
    <>
      <Menu
        open={menu !== null}
        portal
        dense
        side="bottom"
        align="start"
        anchor={<span className="dsh-git-graph-menu-anchor" aria-hidden="true" />}
        getAnchorRect={() => menu === null ? null : new DOMRect(menu.x, menu.y, 1, 1)}
        items={items}
        onSelect={onSelect}
        onClose={onClose}
      />
      <RiskConfirmation
        open={hardReset !== null}
        title={t('gitGraph.resetHard')}
        description={t('gitGraph.confirmHard')}
        acknowledgeLabel={t('gitGraph.confirmHardAck')}
        cancelLabel={t('gitGraph.cancel')}
        confirmLabel={t('gitGraph.confirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeHardReset}
        onConfirm={() => {
          const row = hardReset
          closeHardReset()
          if (row === null) return
          void run({ row, action: 'reset', mode: 'hard' })
        }}
      />
      <Modal
        open={branchRow !== null}
        onClose={closeBranch}
        title={t('gitGraph.createBranchTitle')}
        closeLabel={t('gitGraph.close')}
        description={t('gitGraph.branchPrompt')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeBranch}>
              {t('gitGraph.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || branchName.trim().length === 0}
              onClick={() => {
                const row = branchRow
                const name = branchName.trim()
                closeBranch()
                if (row === null || name.length === 0) return
                void run({ row, action: 'create-branch', branch: name })
              }}
            >
              {t('gitGraph.createBranchConfirm')}
            </Button>
          </>
        )}
      >
        <Input
          autoFocus
          value={branchName}
          onChange={(event) => setBranchName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const row = branchRow
            const name = branchName.trim()
            if (row === null || name.length === 0 || busy) return
            closeBranch()
            void run({ row, action: 'create-branch', branch: name })
          }}
        />
      </Modal>
    </>
  )
}

function menuItems(row: GitGraphRow | undefined, t: (key: string) => string): readonly MenuEntry[] {
  if (row === undefined) return []
  if (row.kind === 'workdir') {
    return [{ id: 'copy-status', label: t('gitGraph.copyStatus') }]
  }
  return [
    { id: 'copy-sha', label: t('gitGraph.copySha') },
    { id: 'copy-message', label: t('gitGraph.copyMessage') },
    { type: 'separator', id: 'sep-copy' },
    { id: 'checkout', label: t('gitGraph.checkout') },
    { id: 'create-branch', label: t('gitGraph.createBranch') },
    { id: 'cherry-pick', label: t('gitGraph.cherryPick') },
    { id: 'revert', label: t('gitGraph.revert') },
    {
      id: 'reset',
      label: t('gitGraph.reset'),
      submenu: [
        { id: 'reset-soft', label: t('gitGraph.resetSoft') },
        { id: 'reset-mixed', label: t('gitGraph.resetMixed') },
        { id: 'reset-hard', label: t('gitGraph.resetHard'), danger: true },
      ],
    },
  ]
}

async function choose(
  id: string,
  row: GitGraphRow,
  cwd: string | undefined,
  t: (key: string) => string,
  hooks: {
    onClose: () => void
    onNotice: (text: string, kind: 'ok' | 'error') => void
    setHardReset: (row: GitGraphRow | null) => void
    setAcknowledged: (value: boolean) => void
    setBranchRow: (row: GitGraphRow | null) => void
    setBranchName: (name: string) => void
    run: (pending: PendingAction) => Promise<void>
  },
): Promise<void> {
  if (id === 'copy-sha') {
    await writeClipboard(row.sha)
    hooks.onClose()
    hooks.onNotice(t('gitGraph.copied'), 'ok')
    return
  }
  if (id === 'copy-message') {
    await writeClipboard(row.subject)
    hooks.onClose()
    hooks.onNotice(t('gitGraph.copied'), 'ok')
    return
  }
  if (id === 'copy-status') {
    await writeClipboard(row.detail ?? '')
    hooks.onClose()
    hooks.onNotice(t('gitGraph.copied'), 'ok')
    return
  }
  if (cwd === undefined) {
    hooks.onNotice(t('gitGraph.noCwd'), 'error')
    hooks.onClose()
    return
  }

  if (id === 'create-branch') {
    hooks.onClose()
    hooks.setBranchName(`from-${row.shortSha}`)
    hooks.setBranchRow(row)
    return
  }
  if (id === 'reset-hard') {
    hooks.onClose()
    hooks.setAcknowledged(false)
    hooks.setHardReset(row)
    return
  }

  let action: GitGraphActionName
  let mode: GitResetMode | undefined
  if (id === 'checkout') action = 'checkout'
  else if (id === 'cherry-pick') action = 'cherry-pick'
  else if (id === 'revert') action = 'revert'
  else if (id === 'reset-soft' || id === 'reset-mixed') {
    action = 'reset'
    mode = id === 'reset-soft' ? 'soft' : 'mixed'
  } else {
    return
  }
  hooks.onClose()
  await hooks.run({ row, action, mode })
}

async function postAction(request: GitGraphActionRequest): Promise<GitGraphActionResponse> {
  try {
    const response = await fetch(GIT_GRAPH_ACTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    })
    const value = await response.json() as GitGraphActionResponse
    if (typeof value.ok !== 'boolean') {
      return { ok: false, code: 'git', message: `action failed: ${response.status}` }
    }
    return value
  } catch (error) {
    return {
      ok: false,
      code: 'git',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
