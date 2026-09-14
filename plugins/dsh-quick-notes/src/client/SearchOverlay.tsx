// The search overlay: the second shortcut's surface.
//
// Instant case-insensitive matching over title, body, and tags; arrow keys
// move, Enter opens the note in a card, and each row carries the three quick
// actions the contract allows (pin, archive). Archived notes stay out
// of results until the toggle says otherwise.

import { useEffect, useMemo, useRef, useState } from 'react'
import { firstLineTitle, imageOnlyTitle, isTextless, type Note } from '../shared.ts'
import styles from './SearchOverlay.module.css'

export interface SearchOverlayProps {
  query: string
  results: Note[]
  includeArchived: boolean
  labels: SearchLabels
  onQueryChange: (query: string) => void
  onToggleArchived: () => void
  onOpen: (noteId: string) => void
  onClose: () => void
  onPin: (noteId: string) => void
  onArchive: (noteId: string) => void
}

export interface SearchLabels {
  placeholder: string
  empty: string
  noMatch: string
  includeArchived: string
  pin: string
  unpin: string
  archive: string
  unarchive: string
  untitled: string
}

export function SearchOverlay(props: SearchOverlayProps): JSX.Element {
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [props.query, props.includeArchived])

  const rows = useMemo(() => props.results, [props.results])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(current => (rows.length === 0 ? 0 : (current + 1) % rows.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(current => (rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[active]
      if (row !== undefined) props.onOpen(row.id)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="false" aria-label={props.labels.placeholder} onKeyDown={onKeyDown}>
      <div className={styles.panel}>
        <input
          ref={input}
          className={styles.input}
          type="search"
          value={props.query}
          placeholder={props.labels.placeholder}
          aria-label={props.labels.placeholder}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={props.includeArchived}
            onChange={props.onToggleArchived}
          />
          {props.labels.includeArchived}
        </label>

        {rows.length === 0 ? (
          <p className={styles.empty}>
            {props.query.trim() === '' ? props.labels.empty : props.labels.noMatch}
          </p>
        ) : (
          <ul className={styles.list}>
            {rows.map((note, at) => (
              <li key={note.id}>
                <div className={at === active ? `${styles.row} ${styles.rowActive}` : styles.row}>
                  <button
                    type="button"
                    className={styles.main}
                    onClick={() => props.onOpen(note.id)}
                    onMouseEnter={() => setActive(at)}
                  >
                    <span className={styles.title}>
                      {note.pinned ? '★ ' : ''}{titleOf(note, props.labels.untitled)}
                    </span>
                    <span className={styles.snippet}>{snippetOf(note)}</span>
                    {note.tags.length > 0 ? (
                      <span className={styles.tags}>
                        {note.tags.map(tag => <span key={tag} className={styles.tag}>#{tag}</span>)}
                      </span>
                    ) : null}
                  </button>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.action}
                      title={note.pinned ? props.labels.unpin : props.labels.pin}
                      aria-label={note.pinned ? props.labels.unpin : props.labels.pin}
                      onClick={() => props.onPin(note.id)}
                    >
                      {note.pinned ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      className={styles.action}
                      title={note.archived ? props.labels.unarchive : props.labels.archive}
                      aria-label={note.archived ? props.labels.unarchive : props.labels.archive}
                      onClick={() => props.onArchive(note.id)}
                    >
                      {note.archived ? '↩' : '↓'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function titleOf(note: Note, untitled: string): string {
  if (note.title.trim() !== '') return note.title
  return isTextless(note.body) ? imageOnlyTitle(note.updatedAt) : firstLineTitle(note.body) || untitled
}

function snippetOf(note: Note): string {
  const text = note.body.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return isTextless(note.body) ? '图片' : ''
  return text.length <= 90 ? text : `${text.slice(0, 89)}…`
}
