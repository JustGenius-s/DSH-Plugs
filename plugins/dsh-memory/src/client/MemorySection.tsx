import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconPlusOutline16,
  IconSearchOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import {
  AddButton,
  ExpandableRow,
  FailureRow,
  InlineNotice,
  RowList,
  SettingsSection,
  StatusText,
  Switch,
  Tag,
} from '@just-genius/dsh-plugin-ui'
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
  const [expanded, setExpanded] = useState<string | null>(null)
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
    setExpanded(null)
  }

  const openEdit = (entry: MemoryEntry) => {
    setEditor({ kind: 'edit', id: entry.id })
    setDraftTitle(entry.title)
    setDraftContent(entry.content)
    setConfirmId(null)
    setError(null)
    setExpanded(entry.id)
  }

  const closeEditor = () => {
    setEditor(null)
    setDraftTitle('')
    setDraftContent('')
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
      const saved = await postJson<MemoryEntry>(ENTRY_PATH, action)
      closeEditor()
      setExpanded(saved.id)
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
      if (editor?.kind === 'edit' && editor.id === id) closeEditor()
      if (expanded === id) setExpanded(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection busy={status === 'loading' || busy}>
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
          <StatusText>{translate('hint')}</StatusText>
          {root !== '' ? (
            <p className={styles.root}>
              {translate('root')}: <code>{root}</code>
            </p>
          ) : null}

          <Input
            type="search"
            icon={<IconSearchOutline16 aria-hidden="true" />}
            value={query}
            placeholder={translate('search')}
            aria-label={translate('search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />

          {editor?.kind === 'create' ? (
            <MemoryEditor
              titleId="dsh-memory-create-title"
              contentId="dsh-memory-create-content"
              draftTitle={draftTitle}
              draftContent={draftContent}
              busy={busy}
              error={error}
              translate={translate}
              onTitleChange={setDraftTitle}
              onContentChange={setDraftContent}
              onCancel={closeEditor}
              onSave={() => void saveEditor()}
            />
          ) : (
            <AddButton
              disabled={busy}
              icon={<IconPlusOutline16 aria-hidden="true" />}
              onClick={openCreate}
            >
              {translate('add')}
            </AddButton>
          )}

          {entries.length === 0 && editor === null ? (
            <StatusText>{translate('empty')}</StatusText>
          ) : null}
          {entries.length > 0 && filtered.length === 0 ? (
            <StatusText>{translate('emptySearch')}</StatusText>
          ) : null}

          {error !== null && editor === null ? (
            <InlineNotice kind="error" role="alert">{error}</InlineNotice>
          ) : null}

          {filtered.length > 0 ? (
            <RowList>
              {filtered.map((entry) => {
                const open = expanded === entry.id
                const editing = editor?.kind === 'edit' && editor.id === entry.id
                return (
                  <ExpandableRow
                    key={entry.id}
                    open={open}
                    onToggle={() => {
                      setExpanded((current) => current === entry.id ? null : entry.id)
                      setConfirmId(null)
                      if (editor?.kind === 'edit' && editor.id === entry.id) closeEditor()
                    }}
                    toggleLabel={`${open ? translate('collapse') : translate('expand')}: ${entry.title}`}
                    name={entry.title}
                    nameTitle={entry.title}
                    summary={summarize(entry.content, 120)}
                    summaryLines={2}
                    meta={(
                      <>
                        <Tag variant="text">
                          {entry.source === 'ai' ? translate('source.ai') : translate('source.manual')}
                        </Tag>
                        <Switch
                          label={translate('enabled')}
                          checked={entry.enabled}
                          disabled={busy}
                          onChange={(next) => void toggleEnabled(entry.id, next)}
                        />
                      </>
                    )}
                  >
                    {editing ? (
                      <MemoryEditor
                        titleId={`dsh-memory-edit-title-${entry.id}`}
                        contentId={`dsh-memory-edit-content-${entry.id}`}
                        draftTitle={draftTitle}
                        draftContent={draftContent}
                        busy={busy}
                        error={error}
                        translate={translate}
                        onTitleChange={setDraftTitle}
                        onContentChange={setDraftContent}
                        onCancel={closeEditor}
                        onSave={() => void saveEditor()}
                      />
                    ) : (
                      <>
                        <pre className={styles.body}>{entry.content.trim()}</pre>
                        <dl className={styles.details}>
                          <dt>{translate('updated')}</dt>
                          <dd>{new Date(entry.updatedAt).toLocaleString()}</dd>
                          <dt>{translate('source')}</dt>
                          <dd>
                            {entry.source === 'ai'
                              ? translate('source.ai')
                              : translate('source.manual')}
                          </dd>
                        </dl>
                        <div className={styles.actions}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => openEdit(entry)}
                          >
                            {translate('edit')}
                          </Button>
                          {confirmId === entry.id ? (
                            <>
                              <span className={styles.confirm}>{translate('confirmDelete')}</span>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={busy}
                                onClick={() => void remove(entry.id)}
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
                              disabled={busy}
                              onClick={() => setConfirmId(entry.id)}
                            >
                              {translate('delete')}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </ExpandableRow>
                )
              })}
            </RowList>
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  )
}

function MemoryEditor(props: {
  titleId: string
  contentId: string
  draftTitle: string
  draftContent: string
  busy: boolean
  error: string | null
  translate: (key: MemoryKey) => string
  onTitleChange: (value: string) => void
  onContentChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  const {
    titleId,
    contentId,
    draftTitle,
    draftContent,
    busy,
    error,
    translate,
    onTitleChange,
    onContentChange,
    onCancel,
    onSave,
  } = props

  return (
    <section className={styles.editor} aria-label={translate('add')}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={titleId}>{translate('title')}</label>
        <Input
          id={titleId}
          value={draftTitle}
          disabled={busy}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={contentId}>{translate('content')}</label>
        <textarea
          id={contentId}
          className={styles.textarea}
          value={draftContent}
          disabled={busy}
          onChange={(event) => onContentChange(event.currentTarget.value)}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {translate('cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || draftTitle.trim() === '' || draftContent.trim() === ''}
          onClick={onSave}
        >
          {busy ? translate('saving') : translate('save')}
        </Button>
      </div>
      {error !== null ? <InlineNotice kind="error" role="alert">{error}</InlineNotice> : null}
    </section>
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
