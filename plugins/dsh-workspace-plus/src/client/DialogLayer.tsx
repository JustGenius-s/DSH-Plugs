/**
 * The plugin's dialogs, rendered once into `shell.overlay`.
 *
 * Both are driven by the single-request stores in `dialogs.ts`, so a row menu deep
 * in the sidebar can open a dialog that lives here without either owning the
 * other. Nothing renders while both requests are empty, which is the normal state.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal } from '@just-genius/dsh-plugin-ui'

import type { ActivityEntry } from './archive-confirm.ts'
import { getDialogs, subscribeDialogs } from './dialogs.ts'
import type { Translate } from './locales.ts'
import type { RenameTarget } from './row-actions.ts'

export interface DialogLayerInjected {
  t: Translate
  /** Perform the rename; rejection is surfaced inside the dialog. */
  applyRename: (target: RenameTarget, title: string) => Promise<void>
}

export function DialogLayer(props: Partial<DialogLayerInjected>) {
  const dialogs = useSyncExternalStore(subscribeDialogs, getDialogs, getDialogs)
  const t = props.t
  const applyRename = props.applyRename
  if (t === undefined || applyRename === undefined) return null
  const rename = dialogs.rename
  return (
    <>
      {rename === null ? null : (
        <RenameDialog
          key={`${rename.target.kind}:${rename.target.id}`}
          title={t(rename.target.kind === 'workspace' ? 'rename.title.workspace' : 'rename.title.session')}
          initial={rename.target.title}
          labels={{ cancel: t('cancel'), save: t('rename.save'), failed: t('toast.renameFailed') }}
          onClose={(title) => { rename.resolve(title) }}
          onSubmit={(title) => applyRename(rename.target, title)}
        />
      )}
      {dialogs.archive === null ? null : (
        <ArchiveDialog
          title={dialogs.archive.title}
          activity={dialogs.archive.activity}
          t={t}
          onClose={(confirmed) => { dialogs.archive?.resolve(confirmed) }}
        />
      )}
      {dialogs.remove === null ? null : (
        <Modal
          open
          title={t('menu.removeFromList')}
          closeLabel={t('cancel')}
          onClose={() => { dialogs.remove?.resolve(false) }}
          footer={(
            <Button
              variant="primary"
              type="button"
              onClick={() => { dialogs.remove?.resolve(true) }}
            >
              {t('menu.removeFromList')}
            </Button>
          )}
        >
          <p>{t('confirm.removeWorkspace', { title: dialogs.remove.title })}</p>
        </Modal>
      )}
    </>
  )
}

/**
 * Description of the work an archive would stop, one line per family.
 *
 * The wording mirrors the official dialog's `activityLine`: counts plus names,
 * with an unknown family (a provider's own kind) still listed rather than
 * dropped, because a hidden line would understate what is about to be killed.
 */
function activityLine(entry: ActivityEntry, t: Translate): string {
  const names = entry.items.map((item) => item.label ?? item.id).join('、')
  const n = entry.items.length
  switch (entry.kind) {
    case 'turn': return t('archive.turn')
    case 'subagent': return t('archive.subagents', { n, names })
    case 'job': return t('archive.jobs', { n, names })
    case 'schedule': return t('archive.schedules', { n, names })
    default: return t('archive.other', { kind: entry.kind, n })
  }
}

/**
 * Ask before archiving a session that still has work running.
 *
 * This is a real question, not a courtesy: accepting it stops a live turn, its
 * subagents, its background jobs and its schedules, and none of that resumes.
 * The dialog therefore lists what will be stopped rather than asking vaguely.
 */
function ArchiveDialog(props: {
  title: string
  activity: readonly ActivityEntry[]
  t: Translate
  onClose: (confirmed: boolean) => void
}) {
  const { t } = props
  return (
    <Modal
      open
      title={t('archive.title')}
      closeLabel={t('cancel')}
      onClose={() => { props.onClose(false) }}
      footer={(
        <>
          <Button variant="outline" type="button" onClick={() => { props.onClose(false) }}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="button" onClick={() => { props.onClose(true) }}>
            {t('archive.action')}
          </Button>
        </>
      )}
    >
      <p>{t('archive.desc', { title: props.title })}</p>
      {props.activity.length === 0 ? null : (
        <ul aria-label={t('archive.activity')}>
          {props.activity.map((entry, index) => (
            <li key={`${entry.kind}-${String(index)}`}>{activityLine(entry, t)}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/**
 * One rename dialog.
 *
 * Submitting keeps the dialog open while the write is in flight and reports a
 * failure in place: closing first would claim a success the Host may refuse (a
 * duplicate name, or a session that is no longer loaded).
 */
function RenameDialog(props: {
  title: string
  initial: string
  labels: { cancel: string; save: string; failed: string }
  onClose: (title: string | undefined) => void
  onSubmit: (title: string) => Promise<void>
}) {
  const [value, setValue] = useState(props.initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(props.initial)
    setBusy(false)
    setError(null)
  }, [props.initial])

  const submit = (): void => {
    const next = value.trim()
    if (next === '' || busy) return
    setBusy(true)
    setError(null)
    void props.onSubmit(next).then(
      () => { props.onClose(next) },
      (reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  return (
    <Modal
      open
      title={props.title}
      closeLabel={props.labels.cancel}
      onClose={() => { props.onClose(undefined) }}
      footer={(
        <Button variant="primary" type="button" disabled={busy || value.trim() === ''} onClick={submit}>
          {props.labels.save}
        </Button>
      )}
    >
      <Input
        autoFocus
        value={value}
        onChange={(event) => { setValue(event.currentTarget.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
      />
      {/* The Host's message when it has one, else the plugin's generic line:
          a bare "failed" tells the user nothing about a refused rename. */}
      {error === null ? null : <p role="alert">{error === '' ? props.labels.failed : error}</p>}
    </Modal>
  )
}
