// One floating sticky-note card.
//
// Non-modal and always above the DSH page. The chrome drags it; the four
// edges and corners resize it (width and height independently). Geometry
// lives for the current page session only.
//
// Desktop (Electron, hiddenInset title bar) injects `-webkit-app-region:drag`
// onto `<header>` elements. This chrome is a `div`, and the whole card opts
// out of that region, so dragging a card never starts a window move.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { StickyEditor } from './StickyEditor.tsx'
import { firstLineTitle, imageOnlyTitle, isTextless, type Note } from '../shared.ts'
import type { CardState } from './store.ts'
import styles from './StickyCard.module.css'

export interface StickyCardProps {
  card: CardState
  note: Note | null
  busy: boolean
  labels: StickyLabels
  onFocus: (key: string) => void
  onClose: (key: string) => void
  onEdit: (key: string, markdown: string) => void
  onSaveNow: (key: string) => void
  onMove: (key: string, geometry: { x?: number; y?: number; width?: number; height?: number }) => void
  onTogglePin: (noteId: string) => void
  onArchive: (noteId: string) => void
  onRegenerate: (noteId: string) => void
  onSaveTags: (noteId: string, draft: string) => void
  onToast: (message: string) => void
}

export interface StickyLabels {
  pin: string
  unpin: string
  archive: string
  unarchive: string
  more: string
  close: string
  regenerate: string
  untitled: string
  placeholder: string
}

const MIN_WIDTH = 240
const MIN_HEIGHT = 200
/** Desktop's hiddenInset title-bar band. Cards must stay below it. */
const DESKTOP_TITLEBAR = 40
const EDGE = 8

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_HANDLES: { edge: ResizeEdge; kind: 'handleN' | 'handleS' | 'handleE' | 'handleW' | 'handleNE' | 'handleNW' | 'handleSE' | 'handleSW'; label: string }[] = [
  { edge: 'n', kind: 'handleN', label: '上下调整' },
  { edge: 's', kind: 'handleS', label: '上下调整' },
  { edge: 'e', kind: 'handleE', label: '左右调整' },
  { edge: 'w', kind: 'handleW', label: '左右调整' },
  { edge: 'ne', kind: 'handleNE', label: '调整大小' },
  { edge: 'nw', kind: 'handleNW', label: '调整大小' },
  { edge: 'se', kind: 'handleSE', label: '调整大小' },
  { edge: 'sw', kind: 'handleSW', label: '调整大小' },
]

export function StickyCard(props: StickyCardProps): JSX.Element {
  const { card, note, labels } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const [tagDraft, setTagDraft] = useState(note?.tags.join(', ') ?? '')
  const [dragging, setDragging] = useState(false)
  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const session = useRef<(() => void) | null>(null)

  useEffect(() => {
    setTagDraft(note?.tags.join(', ') ?? '')
  }, [note?.tags])

  useEffect(() => () => { session.current?.(); session.current = null }, [])

  const body = note?.body ?? card.draft
  const blank = note === null && card.draft.trim() === ''
  const title = displayTitle(note, card.draft, labels.untitled)

  const beginDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    if (isChromeControl(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    props.onFocus(card.key)
    const origin = { x: card.x, y: card.y, px: event.clientX, py: event.clientY }
    setDragging(true)
    session.current?.()
    session.current = listenWindowPointer({
      onMove: (next) => {
        props.onMove(card.key, {
          x: clamp(origin.x + next.clientX - origin.px, 8 - card.width + 80, window.innerWidth - 80),
          y: clamp(origin.y + next.clientY - origin.py, DESKTOP_TITLEBAR, window.innerHeight - 40),
        })
      },
      onEnd: () => {
        session.current = null
        setDragging(false)
      },
    })
  }

  const beginResize = (edge: ResizeEdge, event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onFocus(card.key)
    const origin = { x: card.x, y: card.y, w: card.width, h: card.height, px: event.clientX, py: event.clientY }
    setResizeCursor(cursorOf(edge))
    session.current?.()
    session.current = listenWindowPointer({
      onMove: (next) => {
        props.onMove(card.key, resizeGeometry(
          origin,
          edge,
          next.clientX - origin.px,
          next.clientY - origin.py,
          window.innerWidth,
          window.innerHeight,
        ))
      },
      onEnd: () => {
        session.current = null
        setResizeCursor(null)
      },
    })
  }

  return (
    <section
      className={blank ? `${styles.card} ${styles.cardBlank}` : styles.card}
      data-quick-note-card={card.key}
      data-dragging={dragging ? 'true' : undefined}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height, zIndex: card.z }}
      aria-label={title}
      onPointerDown={() => props.onFocus(card.key)}
    >
      <div className={styles.chrome} onPointerDown={beginDrag}>
        <span className={styles.grip} aria-hidden="true" />
        {blank ? null : <span className={styles.title} title={title}>{title}</span>}
        <div className={styles.actions}>
          {note !== null ? (
            <button
              type="button"
              className={styles.icon}
              title={note.pinned ? labels.unpin : labels.pin}
              aria-label={note.pinned ? labels.unpin : labels.pin}
              aria-pressed={note.pinned}
              onClick={() => props.onTogglePin(note.id)}
            >
              {note.pinned ? '★' : '☆'}
            </button>
          ) : null}
          {note !== null ? (
            <button
              type="button"
              className={styles.icon}
              title={note.archived ? labels.unarchive : labels.archive}
              aria-label={note.archived ? labels.unarchive : labels.archive}
              onClick={() => props.onArchive(note.id)}
            >
              {note.archived ? '↩' : '↓'}
            </button>
          ) : null}
          {note !== null ? (
            <div className={styles.menuWrap}>
              <button
                type="button"
                className={styles.icon}
                title={labels.more}
                aria-label={labels.more}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(open => !open)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className={styles.menu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => { setMenuOpen(false); setEditingTags(true) }}
                  >
                    标签
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    disabled={props.busy}
                    onClick={() => { setMenuOpen(false); props.onRegenerate(note.id) }}
                  >
                    {labels.regenerate}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className={styles.icon}
            title={labels.close}
            aria-label={labels.close}
            onClick={() => props.onClose(card.key)}
          >
            ✕
          </button>
        </div>
      </div>

      {editingTags && note !== null ? (
        <div className={styles.tagEditor} data-quick-note-tags="">
          <input
            className={styles.tagInput}
            value={tagDraft}
            placeholder="用逗号分隔"
            onChange={(event) => setTagDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                props.onSaveTags(note.id, tagDraft)
                setEditingTags(false)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setTagDraft(note.tags.join(', '))
                setEditingTags(false)
              }
            }}
          />
          <button
            type="button"
            className={styles.tagSave}
            onClick={() => { props.onSaveTags(note.id, tagDraft); setEditingTags(false) }}
          >
            保存
          </button>
        </div>
      ) : null}

      {note !== null && note.tags.length > 0 && !editingTags ? (
        <div className={styles.tags}>
          {note.tags.map(tag => <span key={tag} className={styles.tag}>#{tag}</span>)}
        </div>
      ) : null}

      <div className={styles.body}>
        <StickyEditor
          markdown={body}
          revision={card.key}
          autoFocus={card.fresh}
          focusTick={card.focusTick}
          bare={blank}
          placeholder={labels.placeholder}
          ariaLabel={title}
          onChange={(markdown) => props.onEdit(card.key, markdown)}
          onSaveNow={() => props.onSaveNow(card.key)}
          onOpenSearch={() => {}}
          onToast={props.onToast}
        />
      </div>

      {RESIZE_HANDLES.map(handle => (
        <span
          key={handle.edge}
          className={`${styles.handle} ${styles[handle.kind]}`}
          data-resize={handle.edge}
          role="separator"
          aria-label={handle.label}
          onPointerDown={(event) => beginResize(handle.edge, event)}
        />
      ))}
      {dragging || resizeCursor !== null ? createPortal(
        <div className={styles.shield} style={resizeCursor === null ? undefined : { cursor: resizeCursor }} />,
        document.body,
      ) : null}
    </section>
  )
}

/**
 * Follow the pointer on `window`, not on the card.
 *
 * The overlay host is click-through (`pointer-events: none`). Pointer capture
 * on a child of that host is unreliable in Electron, so once a drag starts we
 * listen at the window in the capture phase until the button comes up.
 */
function listenWindowPointer(handlers: {
  onMove: (event: PointerEvent) => void
  onEnd: () => void
}): () => void {
  const move = (event: PointerEvent): void => {
    event.preventDefault()
    handlers.onMove(event)
  }
  const end = (): void => {
    detach()
    handlers.onEnd()
  }
  const detach = (): void => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
  return detach
}

function isChromeControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, input, textarea, a') !== null
}

function displayTitle(note: Note | null, draft: string, untitled: string): string {
  if (note !== null && note.title.trim() !== '') return note.title
  if (note !== null) {
    return isTextless(note.body) ? imageOnlyTitle(note.updatedAt) : firstLineTitle(note.body)
  }
  const fromDraft = firstLineTitle(draft)
  return fromDraft === '' ? untitled : fromDraft
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cursorOf(edge: ResizeEdge): string {
  if (edge === 'n' || edge === 's') return 'ns-resize'
  if (edge === 'e' || edge === 'w') return 'ew-resize'
  if (edge === 'ne' || edge === 'sw') return 'nesw-resize'
  return 'nwse-resize'
}

/** Next card box after dragging one edge or corner. Width-only and height-only edges keep the other axis. */
function resizeGeometry(
  origin: { x: number; y: number; w: number; h: number },
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewW: number,
  viewH: number,
): { x: number; y: number; width: number; height: number } {
  const left = EDGE
  const top = DESKTOP_TITLEBAR
  const right = Math.max(left + MIN_WIDTH, viewW - EDGE)
  const bottom = Math.max(top + MIN_HEIGHT, viewH - EDGE)
  const east = edge.includes('e')
  const west = edge.includes('w')
  const south = edge.includes('s')
  const north = edge.includes('n')

  let x = origin.x
  let y = origin.y
  let width = origin.w
  let height = origin.h

  if (east) width = origin.w + dx
  if (west) {
    width = origin.w - dx
    x = origin.x + dx
  }
  if (south) height = origin.h + dy
  if (north) {
    height = origin.h - dy
    y = origin.y + dy
  }

  if (width < MIN_WIDTH) {
    if (west) x = origin.x + origin.w - MIN_WIDTH
    width = MIN_WIDTH
  }
  if (height < MIN_HEIGHT) {
    if (north) y = origin.y + origin.h - MIN_HEIGHT
    height = MIN_HEIGHT
  }

  if (x < left) {
    if (west) width -= left - x
    x = left
  }
  if (y < top) {
    if (north) height -= top - y
    y = top
  }
  if (x + width > right) {
    if (east) width = right - x
    else x = right - width
  }
  if (y + height > bottom) {
    if (south) height = bottom - y
    else y = bottom - height
  }

  return {
    x,
    y,
    width: clamp(width, MIN_WIDTH, right - left),
    height: clamp(height, MIN_HEIGHT, bottom - top),
  }
}
