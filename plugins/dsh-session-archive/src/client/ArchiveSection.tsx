import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { InjectFace } from '@just-genius/dsh-plugin-runtime/client'
import { FailureRow, SettingsSection, StatusText } from '@just-genius/dsh-plugin-ui'
import {
  DELETE_PATH,
  LIST_PATH,
  UNARCHIVE_PATH,
  type ArchiveHttpResult,
  type ArchiveListPayload,
} from '../shared'
import type { ArchiveKey } from './locales'
import {
  blockingError,
  failureMessage,
  groupSessions,
  initialArchiveView,
  pendingActionOf,
  reduceArchiveView,
  refreshNotice,
  rowErrorOf,
  runRowMutation,
} from './view-state'
import styles from './ArchiveSection.module.css'

export interface ArchiveSectionInjected {
  t: (key: ArchiveKey) => string
}

export type ArchiveSectionProps = Partial<InjectFace<ArchiveSectionInjected>>

export function ArchiveSection({ t }: ArchiveSectionProps) {
  // Memoized so `reload` keeps one identity: the mount effect must fetch once,
  // not once per render.
  const translate = useMemo(() => t ?? ((key: ArchiveKey) => key), [t])
  const [view, dispatch] = useReducer(reduceArchiveView, undefined, initialArchiveView)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const readSeq = useRef(0)

  /**
   * Read the list. A refresh never blanks the rendered rows: the reducer
   * replaces them only once a payload arrives, so an in-flight read is
   * invisible to every row that is not the one being mutated.
   *
   * @returns whether this read's rows were adopted; false when it failed or a
   * newer read had already superseded it.
   */
  const reload = useCallback(async (): Promise<boolean> => {
    const seq = ++readSeq.current
    dispatch({ type: 'list-start', seq })
    try {
      const payload = await getJson<ArchiveListPayload>(LIST_PATH)
      dispatch({ type: 'list-ok', seq, rows: payload.sessions })
      return seq === readSeq.current
    } catch (error) {
      dispatch({ type: 'list-failed', seq, message: failureMessage(error, translate('loadFailed')) })
      return false
    }
  }, [translate])

  useEffect(() => {
    void reload()
  }, [reload])

  const groups = useMemo(() => groupSessions(view.rows, translate('ungrouped')), [view.rows, translate])

  /**
   * Run one row mutation. The row holds its loading state until the refreshed
   * list arrives, so the action reads as finished only when the data that
   * changed is gone — not when the request returns. Other rows stay usable.
   */
  const mutate = (id: string, action: 'delete' | 'unarchive') => {
    void runRowMutation({
      id,
      action,
      dispatch,
      perform: () => postJson(action === 'delete' ? DELETE_PATH : UNARCHIVE_PATH, { sessionId: id }),
      refresh: reload,
      failureMessage: translate(action === 'delete' ? 'deleteFailed' : 'unarchiveFailed'),
    }).then((outcome) => {
      if (outcome === 'done' && action === 'delete') setConfirmId(null)
    })
  }

  const firstLoad = !view.loaded
  const blocking = blockingError(view)
  const notice = refreshNotice(view)

  return (
    <SettingsSection busy={firstLoad}>
      {firstLoad && view.status === 'loading' ? <StatusText>{translate('loading')}</StatusText> : null}
      {blocking !== null ? (
        <FailureRow>
          <p role="alert">{blocking}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            {translate('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {view.loaded ? (
        <>
          {notice !== null ? <p role="alert">{notice}</p> : null}
          {view.rows.length === 0 ? <StatusText>{translate('empty')}</StatusText> : null}
          {groups.map((group) => (
            <section key={group.key} className={styles.group}>
              <div className={styles.groupHead}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                {group.path !== null ? <p className={styles.groupPath}>{group.path}</p> : null}
              </div>
              {group.sessions.map((session) => {
                const confirming = confirmId === session.id
                const pending = pendingActionOf(view, session.id)
                const rowError = rowErrorOf(view, session.id)
                const busy = pending !== undefined
                return (
                  <div key={session.id} className={styles.row}>
                    <div>
                      <div className={styles.title} title={session.title}>{session.title}</div>
                      <p className={styles.meta}>
                        {session.updatedAt !== null
                          ? `${translate('updated')}: ${new Date(session.updatedAt).toLocaleString()}`
                          : session.id}
                      </p>
                      {rowError !== undefined ? (
                        <p role="alert" className={styles.rowError}>{rowError}</p>
                      ) : null}
                    </div>
                    <div className={styles.actions}>
                      {confirming ? (
                        <>
                          <span className={styles.confirm}>{translate('confirmDelete')}</span>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy}
                            onClick={() => mutate(session.id, 'delete')}
                          >
                            {pending === 'delete' ? translate('deleting') : translate('delete')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setConfirmId(null)}
                          >
                            {translate('cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => mutate(session.id, 'unarchive')}
                          >
                            {pending === 'unarchive' ? translate('unarchiving') : translate('unarchive')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirmId(session.id)}
                          >
                            {translate('delete')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </>
      ) : null}
    </SettingsSection>
  )
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const value = await response.json() as ArchiveHttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}

async function postJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json() as ArchiveHttpResult<unknown>
  if (!value.ok) throw new Error(value.message)
}
