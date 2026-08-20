import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { SettingsSection, StatusText, Switch, Tag } from '@just-genius/dsh-plugin-ui'
import {
  ENTRY_PATH,
  LIST_PATH,
  summarize,
  type MemoryEntry,
  type MemoryEntryAction,
  type MemoryHttpResult,
} from '../shared.ts'
import type { MemoryKey } from './locales.ts'
import styles from './MemorySection.module.css'

export interface MemorySectionInjected {
  t: (key: MemoryKey) => string
}

export type MemorySectionProps = Partial<InjectFace<MemorySectionInjected>>

interface ListPayload {
  root: string
  entries: MemoryEntry[]
}

type EditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | null

export function MemorySection({ t }: MemorySectionProps) {
  const translate = t ?? ((key: MemoryKey) => key)
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<EditorMode>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const list = await getJson<ListPayload>(LIST_PATH)
      setRoot(list.root)
      setEntries(list.entries)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return entries
    return entries.filter((entry) => {
      const hay = `${entry.title}\n${entry.content}`.toLowerCase()
      return hay.includes(needle) || entry.source.includes(needle)
    })
  }, [entries, query])

  const openCreate = () => {
    setEditor({ kind: 'create' })
    setDraftTitle('')
    setDraftContent('')
    setConfirmId(null)
    setError(null)
  }

  const openEdit = (entry: MemoryEntry) => {
    setEditor({ kind: 'edit', id: entry.id })
    setDraftTitle(entry.title)
    setDraftContent(entry.content)
    setConfirmId(null)
    setError(null)
  }

  const saveEditor = async () => {
    if (editor === null || busy) return
    const title = draftTitle.trim()
    const content = draftContent.trim()
    if (title === '' || content === '') return
    setBusy(true)
    setError(null)
    try {
      const action: MemoryEntryAction = editor.kind === 'create'
        ? { action: 'create', title, content, enabled: true }
        : { action: 'update', id: editor.id, title, content }
      await postJson<MemoryEntry>(ENTRY_PATH, action)
      setEditor(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await postJson<MemoryEntry>(ENTRY_PATH, { action: 'toggle', id, enabled })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await postJson<{ deleted: true; id: string }>(ENTRY_PATH, { action: 'delete', id })
      setConfirmId(null)
      if (editor?.kind === 'edit' && editor.id === id) setEditor(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection busy={status === 'loading' || busy}>
      <div className={styles.page}>
        <StatusText>{translate('hint')}</StatusText>
        {root !== '' && (
          <p className={styles.root}>
            {translate('root')}: <code>{root}</code>
          </p>
        )}

        <div className={styles.toolbar}>
          <input
            className={styles.search}
            value={query}
            placeholder={translate('search')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="primary" size="sm" disabled={busy || editor !== null} onClick={openCreate}>
            {translate('add')}
          </Button>
        </div>

        {status === 'loading' && <StatusText>{translate('loading')}</StatusText>}
        {status === 'error' && error !== null && <p className={styles.feedback}>{error}</p>}
        {status === 'ready' && entries.length === 0 && editor === null && (
          <StatusText>{translate('empty')}</StatusText>
        )}
        {status === 'ready' && entries.length > 0 && filtered.length === 0 && (
          <StatusText>{translate('emptySearch')}</StatusText>
        )}

        {editor !== null && (
          <section className={styles.editor}>
            <div className={styles.fields}>
              <label className={styles.label} htmlFor="dsh-memory-title">{translate('title')}</label>
              <input
                id="dsh-memory-title"
                className={styles.input}
                value={draftTitle}
                disabled={busy}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
              <label className={styles.label} htmlFor="dsh-memory-content">{translate('content')}</label>
              <textarea
                id="dsh-memory-content"
                className={styles.textarea}
                value={draftContent}
                disabled={busy}
                onChange={(event) => setDraftContent(event.target.value)}
              />
            </div>
            <div className={styles.editorFooter}>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditor(null)}>
                {translate('cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || draftTitle.trim() === '' || draftContent.trim() === ''}
                onClick={() => void saveEditor()}
              >
                {busy ? translate('saving') : translate('save')}
              </Button>
            </div>
            {error !== null && <p className={styles.feedback}>{error}</p>}
          </section>
        )}

        <div className={styles.list}>
          {filtered.map((entry) => (
            <article key={entry.id} className={styles.row}>
              <div className={styles.rowHead}>
                <div>
                  <div className={styles.rowTitle}>{entry.title}</div>
                  <div className={styles.rowMeta}>
                    <Tag variant="text" tone={entry.enabled ? 'strong' : undefined}>
                      {entry.enabled ? translate('enabled') : translate('disabled')}
                    </Tag>
                    <Tag variant="text">
                      {entry.source === 'ai' ? translate('source.ai') : translate('source.manual')}
                    </Tag>
                    <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
                <Switch
                  label={translate('enabled')}
                  checked={entry.enabled}
                  disabled={busy}
                  onChange={(next) => void toggleEnabled(entry.id, next)}
                />
              </div>
              <div className={styles.preview}>{summarize(entry.content, 180)}</div>
              <div className={styles.rowActions}>
                <Button variant="outline" size="sm" disabled={busy || editor !== null} onClick={() => openEdit(entry)}>
                  {translate('edit')}
                </Button>
                {confirmId === entry.id ? (
                  <>
                    <span className={styles.feedback}>{translate('confirmDelete')}</span>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmId(null)}>
                      {translate('cancel')}
                    </Button>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => void remove(entry.id)}>
                      {translate('delete')}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmId(entry.id)}>
                    {translate('delete')}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </SettingsSection>
  )
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const value = await response.json() as MemoryHttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json() as MemoryHttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}
