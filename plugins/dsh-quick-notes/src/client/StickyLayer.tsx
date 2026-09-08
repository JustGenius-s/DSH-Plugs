// The shell overlay: floating cards, the search overlay, and the shortcuts.
//
// This is the whole "always on top" half of the plugin. It registers on
// `shell.overlay` (click-through by default) but paints through a portal on
// `document.body`. Codex's sticky user bubble also portals there at z-index
// 45; staying inside the overlay slot would leave the cards under it.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { SearchOverlay } from './SearchOverlay.tsx'
import { StickyCard } from './StickyCard.tsx'
import type { NotesStore } from './store.ts'
import { dedupeTags, DEFAULT_CONFIG, type QuickNotesConfig } from '../shared.ts'
import type { QuickNoteKey } from './locales.ts'
import styles from './StickyLayer.module.css'

/** Props resolved by the `shell.overlay` registration. */
export interface StickyLayerInjected {
  store: NotesStore
  t: (key: QuickNoteKey) => string
  config: QuickNotesConfig
  scope?: SettingsScope<QuickNotesConfig>
}

/** Chord text ("Mod+Shift+N") → the KeyboardEvent fields it means. */
interface Chord {
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function StickyLayer({ store, t, config: initialConfig, scope }: Partial<StickyLayerInjected>): JSX.Element {
  if (store === undefined) throw new Error('StickyLayer requires NotesStore')
  const translate = t ?? ((key: QuickNoteKey) => key)
  // Re-read config from the live scope when present, so a shortcut edited in
  // Settings takes effect without a page reload.
  const scopeSnapshot = useSyncExternalStore(
    listener => scope?.subscribe(listener) ?? (() => {}),
    () => scope?.getSnapshot(),
    () => scope?.getSnapshot(),
  )
  const stored = scope === undefined ? initialConfig : scopeSnapshot?.value
  const config: QuickNotesConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    enabled: stored?.enabled ?? DEFAULT_CONFIG.enabled,
    newNoteShortcut: stored?.newNoteShortcut || DEFAULT_CONFIG.newNoteShortcut,
    searchShortcut: stored?.searchShortcut || DEFAULT_CONFIG.searchShortcut,
  }
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const layer = useRef<HTMLDivElement | null>(null)

  const labels = useMemo(() => ({
    pin: translate('pin'),
    unpin: translate('unpin'),
    archive: translate('archive'),
    unarchive: translate('unarchive'),
    more: translate('more'),
    close: translate('close'),
    regenerate: translate('regenerate'),
    untitled: translate('untitled'),
    placeholder: translate('placeholder'),
    searchPlaceholder: translate('searchPlaceholder'),
    searchEmpty: translate('searchEmpty'),
    searchNoMatch: translate('searchNoMatch'),
  }), [translate])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setQuery('')
  }, [])

  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // Shortcuts capture on this window and every same-origin iframe.
  // Session-card drawers (Synapse map) keep focus inside an iframe;
  // a parent-only listener would miss Mod+Shift+N there.
  useEffect(() => {
    if (config.enabled !== true) return
    const newChord = parseChord(config.newNoteShortcut)
    const searchChord = parseChord(config.searchShortcut)
    let lastNew = 0
    const fireNew = (target: EventTarget | null): void => {
      const now = Date.now()
      if (now - lastNew < 400) return
      lastNew = now
      store.openNewCard(cardKeyOf(target))
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (event.key === 'Escape' && event.type === 'keydown') {
        if (searchOpen) {
          event.preventDefault()
          setSearchOpen(false)
          return
        }
        const cardKey = cardKeyOf(event.target)
        if (cardKey !== null) {
          event.preventDefault()
          store.closeCard(cardKey)
        }
        return
      }
      const chorded = event.metaKey || event.ctrlKey || event.altKey
      if (!chorded && isTypingTarget(event.target)) return
      if (matches(event, newChord)) {
        event.preventDefault()
        event.stopPropagation()
        fireNew(event.target)
        return
      }
      if (event.type === 'keydown' && matches(event, searchChord)) {
        event.preventDefault()
        event.stopPropagation()
        setSearchOpen(open => !open)
      }
    }
    // Session cards (Synapse map) live in a same-origin iframe. A keydown
    // there never reaches this window, so bind every reachable frame too.
    return bindShortcutFrames(onKey)
  }, [config.enabled, config.newNoteShortcut, config.searchShortcut, searchOpen, store])

  // Never lose a keystroke: flush pending edits before the page goes away.
  useEffect(() => {
    const flush = (): void => store.flushAll()
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [store])

  useEffect(() => {
    void store.reload()
  }, [store])

  const results = useMemo(
    () => store.search(query, includeArchived),
    // `snapshot.notes` is the real dependency; store.search reads live state.
    [store, query, includeArchived, snapshot.notes],
  )

  return createPortal(
    <div ref={layer} className={styles.layer}>
      {snapshot.cards.map(card => (
        <StickyCard
          key={card.key}
          card={card}
          note={card.noteId === null ? null : store.noteOf(card.noteId) ?? null}
          busy={false}
          labels={labels}
          onFocus={(key) => store.focusCard(key)}
          onClose={(key) => store.closeCard(key)}
          onEdit={(key, markdown) => store.editCard(key, markdown)}
          onSaveNow={(key) => store.flushNow(key)}
          onMove={(key, geometry) => store.moveCard(key, geometry)}
          onTogglePin={(id) => {
            const current = store.noteOf(id)
            void store.setPinned(id, current?.pinned !== true)
          }}
          onArchive={(id) => {
            const note = store.noteOf(id)
            void store.setArchived(id, note?.archived !== true)
          }}
          onRegenerate={(id) => void store.regenerate(id, false)}
          onSaveTags={(id, draft) => {
            void store.mutate({
              action: 'update',
              id,
              tags: dedupeTags(draft.split(',').map(tag => tag.trim()).filter(tag => tag !== '')),
            })
          }}
          onToast={(message) => store.setNotice(message)}
        />
      ))}

      {snapshot.notice !== null ? (
        <div className={styles.notice} role="status">{snapshot.notice}</div>
      ) : null}

      {searchOpen ? (
        <SearchOverlay
          query={query}
          results={results}
          includeArchived={includeArchived}
          labels={{
            placeholder: labels.searchPlaceholder,
            empty: labels.searchEmpty,
            noMatch: labels.searchNoMatch,
            includeArchived: translate('includeArchived'),
            pin: labels.pin,
            unpin: labels.unpin,
            archive: labels.archive,
            unarchive: labels.unarchive,
            untitled: labels.untitled,
          }}
          onQueryChange={setQuery}
          onToggleArchived={() => setIncludeArchived(value => !value)}
          onOpen={(id) => {
            store.openNote(id)
            setSearchOpen(false)
          }}
          onClose={closeSearch}
          onPin={(id) => {
            const note = store.noteOf(id)
            void store.setPinned(id, note?.pinned !== true)
          }}
          onArchive={(id) => {
            const note = store.noteOf(id)
            void store.setArchived(id, note?.archived !== true)
          }}
        />
      ) : null}
    </div>,
    document.body,
  )
}

/**
 * Listen for shortcuts on this window and every same-origin iframe.
 *
 * Clicking a Synapse session card focuses the map iframe; without this,
 * ⌘⇧N dies inside the frame and no note card appears.
 */
function bindShortcutFrames(onKey: (event: KeyboardEvent) => void): () => void {
  const attached = new Set<Window>()
  const bind = (target: Window | null): void => {
    if (target === null || attached.has(target)) return
    try {
      target.addEventListener('keydown', onKey, true)
      target.addEventListener('keyup', onKey, true)
      attached.add(target)
    } catch {
      // Cross-origin frames throw; skip them.
    }
  }
  const scan = (): void => {
    bind(window)
    for (const frame of document.querySelectorAll('iframe')) {
      bind(frame.contentWindow)
    }
  }
  scan()
  const observer = new MutationObserver(scan)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('load', scan, true)
  return () => {
    observer.disconnect()
    document.removeEventListener('load', scan, true)
    for (const target of attached) {
      try {
        target.removeEventListener('keydown', onKey, true)
        target.removeEventListener('keyup', onKey, true)
      } catch {
        // Frame already gone.
      }
    }
    attached.clear()
  }
}

/** The card under the event, if the user is focused inside one. */
function cardKeyOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-quick-note-tags]') !== null) return null
  return target.closest('[data-quick-note-card]')?.getAttribute('data-quick-note-card') ?? null
}

/** True when the event started in a field that owns its own key handling. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function matches(event: KeyboardEvent, chord: Chord): boolean {
  if (chord.key === '') return false
  if (chord.meta && !(event.metaKey || event.ctrlKey)) return false
  if (!chord.meta && (event.metaKey || event.ctrlKey)) return false
  if (event.shiftKey !== chord.shift) return false
  if (event.altKey !== chord.alt) return false
  if (event.code === codeOf(chord.key)) return true
  // IME often reports `key` as "Process"; fall back to the printed key.
  return event.key.toLowerCase() === chord.key.toLowerCase()
}

function codeOf(key: string): string {
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`
  if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`
  return key
}

/**
 * Parse a shortcut string like `Mod+Shift+N` into modifier flags plus a key.
 *
 * `Mod` is ⌘ on macOS and Ctrl elsewhere, which is what the Settings page
 * records and what the key recorder writes back.
 */
export function parseChord(value: string): Chord {
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  const chord: Chord = { meta: false, ctrl: false, shift: false, alt: false, key: '' }
  for (const part of parts) {
    const token = part.toLowerCase()
    if (token === 'mod') {
      chord.meta = true
      continue
    }
    if (token === 'ctrl' || token === 'control') {
      chord.ctrl = true
      chord.meta = true
      continue
    }
    if (token === 'cmd' || token === 'meta' || token === 'command') {
      chord.meta = true
      continue
    }
    if (token === 'shift') {
      chord.shift = true
      continue
    }
    if (token === 'alt' || token === 'option') {
      chord.alt = true
      continue
    }
    chord.key = part.length === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  }
  return chord
}
