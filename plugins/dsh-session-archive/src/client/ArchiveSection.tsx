import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { InjectFace } from '@just-genius/dsh-plugin-runtime/client'
import { FailureRow, SettingsSection, StatusText } from '@just-genius/dsh-plugin-ui'
import {
  DELETE_PATH,
  LIST_PATH,
  type ArchiveHttpResult,
  type ArchiveListPayload,
  type ArchivedSessionRow,
} from '../shared'
import type { ArchiveKey } from './locales'
import styles from './ArchiveSection.module.css'

export interface ArchiveSectionInjected {
  t: (key: ArchiveKey) => string
}

export type ArchiveSectionProps = Partial<InjectFace<ArchiveSectionInjected>>

interface WorkspaceGroup {
  key: string
  title: string
  path: string | null
  sessions: ArchivedSessionRow[]
}

export function ArchiveSection({ t }: ArchiveSectionProps) {
  const translate = t ?? ((key: ArchiveKey) => key)
  const [sessions, setSessions] = useState<ArchivedSessionRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const payload = await getJson<ArchiveListPayload>(LIST_PATH)
      setSessions(payload.sessions)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const groups = useMemo(() => groupSessions(sessions, translate('ungrouped')), [sessions, translate])

  const remove = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await postJson(DELETE_PATH, { sessionId: id })
      setConfirmId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('deleteFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SettingsSection busy={status === 'loading' || busyId !== null}>
      {status === 'loading' ? <StatusText>{translate('loading')}</StatusText> : null}
      {status === 'error' ? (
        <FailureRow>
          <p role="alert">{error ?? translate('loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            {translate('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {status === 'ready' ? (
        <>
          {error !== null ? <p role="alert">{error}</p> : null}
          {sessions.length === 0 ? <StatusText>{translate('empty')}</StatusText> : null}
          {groups.map((group) => (
            <section key={group.key} className={styles.group}>
              <div className={styles.groupHead}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                {group.path !== null ? <p className={styles.groupPath}>{group.path}</p> : null}
              </div>
              {group.sessions.map((session) => {
                const confirming = confirmId === session.id
                const busy = busyId === session.id
                return (
                  <div key={session.id} className={styles.row}>
                    <div>
                      <div className={styles.title} title={session.title}>{session.title}</div>
                      <p className={styles.meta}>
                        {session.updatedAt !== null
                          ? `${translate('updated')}: ${new Date(session.updatedAt).toLocaleString()}`
                          : session.id}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      {confirming ? (
                        <>
                          <span className={styles.confirm}>{translate('confirmDelete')}</span>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy}
                            onClick={() => void remove(session.id)}
                          >
                            {translate('delete')}
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId !== null}
                          onClick={() => setConfirmId(session.id)}
                        >
                          {translate('delete')}
                        </Button>
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

function groupSessions(sessions: ArchivedSessionRow[], ungrouped: string): WorkspaceGroup[] {
  const order: string[] = []
  const map = new Map<string, WorkspaceGroup>()
  for (const session of sessions) {
    const key = session.workspaceId ?? 'ungrouped'
    let group = map.get(key)
    if (group === undefined) {
      group = {
        key,
        title: session.workspaceTitle || ungrouped,
        path: session.workspacePath,
        sessions: [],
      }
      map.set(key, group)
      order.push(key)
    }
    group.sessions.push(session)
  }
  return order.map((key) => map.get(key)!).filter((group) => group.sessions.length > 0)
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
