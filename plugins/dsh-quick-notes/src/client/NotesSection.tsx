// Settings → 随手笔记.
//
// One column, same chrome as the other settings pages: switches and pickers
// first, then a library list. The floating card is the editor — clicking a
// title opens it. This page only manages the library.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { InjectFace, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import {
  Button,
  FailureRow,
  Field,
  FieldHead,
  FilterChip,
  FilterChips,
  Input,
  Menu,
  SettingsSection,
  StatusText,
  SwitchField,
} from '@just-genius/dsh-plugin-ui'
import type { MenuItem } from '@just-genius/dsh-plugin-ui'
import type { NotesStore } from './store.ts'
import {
  DEFAULT_CONFIG,
  firstLineTitle,
  imageOnlyTitle,
  isTextless,
  matchesQuery,
  type Note,
  type QuickNotesConfig,
} from '../shared.ts'
import type { QuickNoteKey } from './locales.ts'
import styles from './NotesSection.module.css'

export interface NotesSectionInjected {
  store: NotesStore
  t: (key: QuickNoteKey) => string
  scope: SettingsScope<QuickNotesConfig>
}

export type NotesSectionProps = Partial<InjectFace<NotesSectionInjected>>

type Scope = 'notes' | 'archived'

export function NotesSection({ store, t, scope }: NotesSectionProps): JSX.Element {
  if (store === undefined) throw new Error('NotesSection requires NotesStore')
  const translate = t ?? (key => key)

  const settingsSnap = useSyncExternalStore(
    listener => scope?.subscribe(listener) ?? (() => {}),
    () => scope?.getSnapshot(),
    () => scope?.getSnapshot(),
  )
  const settings: QuickNotesConfig = { ...DEFAULT_CONFIG, ...settingsSnap?.value }
  const setField = <K extends keyof QuickNotesConfig>(field: K, value: QuickNotesConfig[K]): void => {
    if (scope === undefined) return
    void scope.set(field, value)
  }

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [catalog, setCatalog] = useState<{ id: string; name: string; models: { id: string; name: string }[] }[]>([])
  const [filter, setFilter] = useState<Scope>('notes')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [renamingTag, setRenamingTag] = useState(false)
  const [confirmTag, setConfirmTag] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  useEffect(() => {
    let alive = true
    void store.models()
      .then(loaded => {
        if (!alive) return
        setCatalog(loaded.groups.map(group => ({
          id: group.id,
          name: group.name,
          models: group.models.map(model => ({ id: model.id, name: model.name })),
        })))
      })
      .catch(() => { /* picker keeps the default option */ })
    return () => { alive = false }
  }, [store])

  useEffect(() => {
    void store.reload()
  }, [store])

  const counts = useMemo(() => ({
    notes: snapshot.notes.filter(note => !isShelved(note)).length,
    archived: snapshot.notes.filter(note => isShelved(note)).length,
  }), [snapshot.notes])

  const visible = useMemo(() => {
    const pool = snapshot.notes.filter(note => {
      if (filter === 'archived') return isShelved(note)
      return !isShelved(note)
    })
    return pool
      .filter(note => tagFilter === null || note.tags.some(tag => tag.toLowerCase() === tagFilter.toLowerCase()))
      .filter(note => matchesQuery(note, query))
  }, [snapshot.notes, filter, tagFilter, query])

  const failed = useMemo(
    () => snapshot.notes.filter(note => note.metadataState === 'failed' && !isShelved(note)),
    [snapshot.notes],
  )

  const changeFilter = (next: Scope): void => {
    setFilter(next)
    setSelected([])
    setConfirmDelete(null)
    setConfirmBulkDelete(false)
  }

  const toggleSelected = useCallback((id: string) => {
    setSelected(current => (
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    ))
  }, [])

  const bulk = useCallback(async (patch: { archived?: boolean; addTags?: string[]; removeTags?: string[] }) => {
    if (selected.length === 0) return
    await store.mutate({ action: 'bulk', ids: selected, ...patch })
    setSelected([])
  }, [selected, store])

  return (
    <SettingsSection busy={snapshot.status === 'loading'}>
      <SwitchField
        id="quick-notes-enabled"
        label={translate('enabled')}
        checked={settings.enabled}
        onChange={checked => setField('enabled', checked)}
      />
      <Field>
        <FieldHead
          label={translate('newNoteShortcut')}
          action={(
            <ShortcutButton
              label={translate('newNoteShortcut')}
              value={settings.newNoteShortcut}
              recordingLabel={translate('recordingShortcut')}
              onChange={value => setField('newNoteShortcut', value)}
            />
          )}
        />
      </Field>
      <Field>
        <FieldHead
          label={translate('searchShortcut')}
          action={(
            <ShortcutButton
              label={translate('searchShortcut')}
              value={settings.searchShortcut}
              recordingLabel={translate('recordingShortcut')}
              onChange={value => setField('searchShortcut', value)}
            />
          )}
        />
      </Field>
      <Field>
        <FieldHead
          label={translate('metadataModel')}
          action={(
            <ModelPicker
              label={translate('metadataModel')}
              provider={settings.metadataProvider}
              model={settings.metadataModel}
              groups={catalog}
              defaultLabel={translate('useDefaultModel')}
              onChange={(provider, model) => {
                setField('metadataProvider', provider)
                setField('metadataModel', model)
              }}
            />
          )}
        />
      </Field>

      {failed.length > 0 ? (
        <FailureRow>
          <Button size="sm" variant="outline" onClick={() => void store.retryFailed()}>
            {translate('retryFailed').replace('{n}', String(failed.length))}
          </Button>
        </FailureRow>
      ) : null}

      {snapshot.status === 'error' && snapshot.error !== null ? (
        <FailureRow>
          <p role="alert">{snapshot.error}</p>
          <Button size="sm" variant="outline" onClick={() => void store.reload()}>{translate('retry')}</Button>
        </FailureRow>
      ) : null}
      {snapshot.notice !== null ? <p className={styles.notice} role="status">{snapshot.notice}</p> : null}

      <div className={styles.library}>
        <div className={styles.toolbar}>
          <Input
            type="search"
            value={query}
            placeholder={translate('searchPlaceholder')}
            aria-label={translate('searchPlaceholder')}
            onChange={event => setQuery(event.currentTarget.value)}
          />
          <Button size="sm" variant="outline" onClick={() => store.openNewCard()}>
            {translate('newNote')}
          </Button>
        </div>

        <FilterChips label={translate('filters')}>
          <FilterChip active={filter === 'notes'} onClick={() => changeFilter('notes')}>
            {translate('scopeNotes')}
            {counts.notes > 0 ? ` ${String(counts.notes)}` : ''}
          </FilterChip>
          <FilterChip active={filter === 'archived'} onClick={() => changeFilter('archived')}>
            {translate('scopeArchived')}
            {counts.archived > 0 ? ` ${String(counts.archived)}` : ''}
          </FilterChip>
        </FilterChips>

        {snapshot.tags.length > 0 ? (
          <div className={styles.tagRow}>
            <FilterChips label={translate('filterTags')}>
              {snapshot.tags.map(tag => (
                <FilterChip
                  key={tag}
                  active={tagFilter === tag}
                  onClick={() => {
                    setTagFilter(current => current === tag ? null : tag)
                    setRenamingTag(false)
                    setConfirmTag(false)
                    setSelected([])
                  }}
                >
                  {tag}
                </FilterChip>
              ))}
            </FilterChips>
            {tagFilter !== null ? (
              <div className={styles.tagEdit}>
                {renamingTag ? (
                  <input
                    className={styles.rename}
                    defaultValue={tagFilter}
                    autoFocus
                    aria-label={translate('renameTag')}
                    onBlur={event => {
                      const next = event.currentTarget.value.trim()
                      setRenamingTag(false)
                      if (next === '' || next === tagFilter) return
                      void store.renameTag(tagFilter, next).then(() => setTagFilter(next))
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setRenamingTag(false)
                    }}
                  />
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => { setRenamingTag(true); setConfirmTag(false) }}>
                    {translate('renameTag')}
                  </Button>
                )}
                {confirmTag ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        void store.deleteTag(tagFilter)
                        setTagFilter(null)
                        setConfirmTag(false)
                      }}
                    >
                      {translate('deleteTag')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmTag(false)}>
                      {translate('cancel')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => { setConfirmTag(true); setRenamingTag(false) }}>
                    {translate('deleteTag')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {selected.length > 0 ? (
          <div className={styles.bulk} role="toolbar" aria-label={translate('selectedCount').replace('{n}', String(selected.length))}>
            <span className={styles.bulkCount}>{translate('selectedCount').replace('{n}', String(selected.length))}</span>
            <Button size="sm" variant="outline" onClick={() => void bulk({ archived: filter === 'notes' })}>
              {filter === 'notes' ? translate('archive') : translate('unarchive')}
            </Button>
            {filter === 'archived' ? (
              confirmBulkDelete ? (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      void store.deleteNotes(selected).then(() => {
                        setSelected([])
                        setConfirmBulkDelete(false)
                      })
                    }}
                  >
                    {translate('deleteNote')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmBulkDelete(false)}>
                    {translate('cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirmBulkDelete(true)}>
                  {translate('deleteNote')}
                </Button>
              )
            ) : null}
            {tagFilter !== null ? (
              <Button size="sm" variant="outline" onClick={() => void bulk({ removeTags: [tagFilter] })}>
                {translate('removeTagNamed').replace('{name}', tagFilter)}
              </Button>
            ) : null}
            <input
              className={styles.bulkTag}
              placeholder={translate('addTag')}
              aria-label={translate('addTag')}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                const value = event.currentTarget.value.trim()
                event.currentTarget.value = ''
                if (value === '') return
                void bulk({ addTags: [value] })
              }}
            />
          </div>
        ) : null}

        {visible.length === 0 ? (
          <StatusText>{translate('emptyNotes')}</StatusText>
        ) : (
          <ul className={styles.list}>
            {visible.map(note => (
              <NoteRow
                key={note.id}
                note={note}
                filter={filter}
                selected={selected.includes(note.id)}
                t={translate}
                onToggle={() => toggleSelected(note.id)}
                onOpen={() => store.openNote(note.id)}
                onPin={() => void store.setPinned(note.id, !note.pinned)}
                onArchive={() => void store.setArchived(note.id, !note.archived)}
                confirmingDelete={confirmDelete === note.id}
                onAskDelete={() => setConfirmDelete(note.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() => {
                  void store.deleteNotes([note.id]).then(() => {
                    setConfirmDelete(null)
                    setSelected(current => current.filter(id => id !== note.id))
                  })
                }}
                onRetry={() => void store.regenerate(note.id, true)}
              />
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  )
}

function NoteRow(props: {
  note: Note
  filter: Scope
  selected: boolean
  t: (key: QuickNoteKey) => string
  onToggle: () => void
  onOpen: () => void
  onPin: () => void
  onArchive: () => void
  confirmingDelete: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onRetry: () => void
}): JSX.Element {
  const { note, filter, t } = props
  const title = titleOf(note, t('untitled'))
  const date = new Date(note.updatedAt).toLocaleString()
  const failed = note.metadataState === 'failed'
  const archived = filter === 'archived'

  return (
    <li className={styles.row}>
      <input
        type="checkbox"
        className={styles.check}
        checked={props.selected}
        onChange={props.onToggle}
        aria-label={title}
      />
      <button type="button" className={styles.main} onClick={props.onOpen}>
        <span className={styles.title}>{!archived && note.pinned ? '★ ' : ''}{title}</span>
        <span className={styles.meta}>
          {date}
          {note.tags.length > 0 ? ` · ${note.tags.join(' · ')}` : ''}
          {failed ? ` · ${t('metadataFailed')}` : ''}
        </span>
      </button>
      <div className={styles.actions}>
        {archived ? (
          <>
            <Button size="sm" variant="ghost" onClick={props.onArchive}>{t('unarchive')}</Button>
            {props.confirmingDelete ? (
              <>
                <Button size="sm" variant="primary" onClick={props.onDelete}>{t('deleteNote')}</Button>
                <Button size="sm" variant="ghost" onClick={props.onCancelDelete}>{t('cancel')}</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={props.onAskDelete}>{t('deleteNote')}</Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={props.onPin}>{note.pinned ? t('unpin') : t('pin')}</Button>
            <Button size="sm" variant="ghost" onClick={props.onArchive}>{t('archive')}</Button>
            {failed ? (
              <Button size="sm" variant="ghost" onClick={props.onRetry}>{t('regenerate')}</Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  )
}

function ShortcutButton(props: {
  label: string
  value: string
  recordingLabel: string
  onChange: (value: string) => void
}): JSX.Element {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const parts: string[] = []
      if (event.metaKey || event.ctrlKey) parts.push('Mod')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
      if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return
      parts.push(key)
      if (parts.length < 2) return
      props.onChange(parts.join('+'))
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, props.onChange])

  return (
    <Button
      type="button"
      size="sm"
      variant="toolbar"
      aria-label={props.label}
      aria-pressed={recording}
      onClick={() => setRecording(current => !current)}
    >
      {recording ? props.recordingLabel : displayShortcut(props.value)}
    </Button>
  )
}

function ModelPicker(props: {
  label: string
  provider: string
  model: string
  defaultLabel: string
  groups: { id: string; name: string; models: { id: string; name: string }[] }[]
  onChange: (provider: string, model: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = props.provider === '' && props.model === '' ? '' : `${props.provider}/${props.model}`
  const items: MenuItem[] = [
    { id: '', label: props.defaultLabel },
    ...props.groups.flatMap(group => group.models.map(model => ({
      id: `${group.id}/${model.id}`,
      label: `${group.name} / ${model.name}`,
    }))),
  ]
  const selectedLabel = items.find(item => item.id === selected)?.label ?? props.defaultLabel

  return (
    <Menu
      open={open}
      items={items}
      selectedId={selected}
      onSelect={id => {
        if (id === '') {
          props.onChange('', '')
        } else {
          const slash = id.indexOf('/')
          props.onChange(id.slice(0, slash), id.slice(slash + 1))
        }
        setOpen(false)
      }}
      onClose={() => setOpen(false)}
      align="end"
      side="bottom"
      portal
      anchor={(
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          aria-label={props.label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          {selectedLabel}
        </Button>
      )}
    />
  )
}

/** Archived, or leftover recycle-bin rows waiting for the Host to revive. */
function isShelved(note: Note): boolean {
  return note.archived || note.trashed
}

function titleOf(note: Note, untitled: string): string {
  if (note.title.trim() !== '') return note.title
  return isTextless(note.body) ? imageOnlyTitle(note.updatedAt) : firstLineTitle(note.body) || untitled
}

function displayShortcut(value: string): string {
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  return value.replace(/^Mod/, mod)
}
