// Browser-side state for 随手笔记.
//
// One store drives every surface: the floating cards, the search overlay, and
// the Settings page. It owns autosave timing, the card windows, and the
// "label this note once, when it is first closed" rule, and it exposes a
// `useSyncExternalStore`-shaped subscription so React stays a pure renderer.

import { getJson, postJson, readSessionModelCatalogWhenReady } from '@just-genius/dsh-plugin-runtime/client'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import {
  AUTOSAVE_DEBOUNCE_MS,
  MAX_OPEN_CARDS,
  dedupeTags,
  firstLineTitle,
  imageOnlyTitle,
  isTextless,
  rankNotes,
  type Note,
  type NoteAction,
  type NotesSnapshot,
  type QuickNotesConfig,
} from '../shared.ts'

/** One floating card on screen. */
export interface CardState {
  /** Stable key; the note id once the note exists. */
  key: string
  noteId: string | null
  /** Draft body before the first save creates the note. */
  draft: string
  x: number
  y: number
  width: number
  height: number
  z: number
  /** Marks the card created by the "new note" shortcut, reused while empty. */
  fresh: boolean
  /** Bumped to force the editor to take focus (shortcut reuse). */
  focusTick: number
}

export interface NotesStoreState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  notes: Note[]
  tags: string[]
  cards: CardState[]
  topZ: number
  /** Transient status line: save state, AI failures, limits. */
  notice: string | null
}

interface Geometry {
  x: number
  y: number
  width: number
  height: number
}

const CARD_WIDTH = 360
const CARD_HEIGHT = 300
const CASCADE = 26

/**
 * The single owner of note state on the browser side.
 *
 * Writes are optimistic-but-simple: a mutation posts to the Host and adopts
 * the snapshot it returns, so the list can never drift from disk.
 */
export class NotesStore {
  private state: NotesStoreState = {
    status: 'loading',
    error: null,
    notes: [],
    tags: [],
    cards: [],
    topZ: 10,
    notice: null,
  }

  private readonly listeners = new Set<() => void>()
  private readonly pending = new Map<string, { timer: number; body: string }>()
  /** One in-flight `create` per card. A second flush waits, then updates. */
  private readonly creating = new Map<string, Promise<string | null>>()
  private readonly labelling = new Set<string>()
  private cascade = 0
  private modelCatalog: { groups: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[] } | undefined
  private modelsLoaded = false

  constructor(private readonly ctx: ClientContext) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): NotesStoreState => this.state

  // ---------------------------------------------------------------- reading

  async reload(): Promise<void> {
    try {
      const snapshot = await getJson<{ ok: boolean; value?: NotesSnapshot; message?: string }>(NOTES_ROUTE)
      if (!snapshot.ok || snapshot.value === undefined) {
        throw new Error(snapshot.message ?? '读取笔记失败')
      }
      this.patch({
        status: 'ready',
        error: null,
        notes: snapshot.value.notes,
        tags: snapshot.value.tags,
      })
    } catch (error) {
      this.patch({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** The DSH model catalog, for the Settings page picker. */
  async models(): Promise<{ groups: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[] }> {
    if (this.modelsLoaded && this.modelCatalog !== undefined) return this.modelCatalog
    const catalog = await readSessionModelCatalogWhenReady(this.ctx)
    const groups = (catalog?.groups ?? []).map(group => ({
      id: group.id,
      name: group.name,
      models: (group.models ?? []).map(model => ({ id: model.id, name: model.name })),
    }))
    this.modelCatalog = { groups }
    this.modelsLoaded = true
    return this.modelCatalog
  }

  // ----------------------------------------------------------------- cards

  /**
   * Open a new card.
   *
   * `besides` is the card the user is already in. That press must spawn
   * another card — the empty-card reuse would just refocus the one they
   * are looking at, which feels like the shortcut died.
   */
  openNewCard(besides?: string | null): void {
    if (besides === undefined || besides === null) {
      const existing = this.state.cards.find(card => (
        card.fresh && card.noteId === null && this.bodyOf(card).trim() === ''
      ))
      if (existing !== undefined) {
        this.revealCard(existing.key)
        return
      }
    }
    if (this.state.cards.length >= MAX_OPEN_CARDS) {
      this.patch({ notice: `最多同时打开 ${String(MAX_OPEN_CARDS)} 张便签` })
      return
    }
    const key = `card-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`
    const origin = besides === undefined || besides === null
      ? undefined
      : this.state.cards.find(card => card.key === besides)
    const geometry = origin === undefined ? this.nextGeometry() : this.offsetGeometry(origin)
    this.patch({
      cards: [...this.state.cards, {
        key,
        noteId: null,
        draft: '',
        ...geometry,
        z: this.state.topZ + 1,
        fresh: true,
        focusTick: 1,
      }],
      topZ: this.state.topZ + 1,
      notice: null,
    })
  }

  /**
   * Adopt a note created by another plugin (会话地图 → 添加到笔记).
   *
   * The host write already happened; this only refreshes the library and
   * opens the new card so the user can see it.
   */
  adoptImportedNote(snapshot: NotesSnapshot, createdId: string): void {
    if (createdId === '') return
    this.patch({
      status: 'ready',
      error: null,
      notes: snapshot.notes,
      tags: snapshot.tags,
      notice: null,
    })
    this.openNote(createdId)
  }

  /** Open an existing note, or focus it when it is already on screen. */
  openNote(id: string): void {
    const existing = this.state.cards.find(card => card.noteId === id)
    if (existing !== undefined) {
      this.revealCard(existing.key)
      return
    }
    if (this.state.cards.length >= MAX_OPEN_CARDS) {
      this.patch({ notice: `最多同时打开 ${String(MAX_OPEN_CARDS)} 张便签` })
      return
    }
    const key = `note-${id}`
    this.patch({
      cards: [...this.state.cards, {
        key,
        noteId: id,
        draft: '',
        ...this.nextGeometry(),
        z: this.state.topZ + 1,
        fresh: false,
        focusTick: 1,
      }],
      topZ: this.state.topZ + 1,
      notice: null,
    })
  }

  focusCard(key: string): void {
    const z = this.state.topZ + 1
    this.patch({
      cards: this.state.cards.map(card => (card.key === key ? { ...card, z } : card)),
      topZ: z,
    })
  }

  /**
   * Bring an existing card back: on-screen, on top, and with the editor
   * focused. A second shortcut press used to only bump `z`, so nothing
   * visible happened when an empty card was already open.
   */
  revealCard(key: string): void {
    const z = this.state.topZ + 1
    this.patch({
      cards: this.state.cards.map(card => (
        card.key === key
          ? { ...card, z, ...this.clampGeometry(card), focusTick: (card.focusTick ?? 0) + 1 }
          : card
      )),
      topZ: z,
    })
  }

  closeCard(key: string): void {
    const card = this.state.cards.find(candidate => candidate.key === key)
    this.flushNow(key)
    if (card?.noteId !== null && card?.noteId !== undefined) {
      void this.labelOnClose(card.noteId)
    }
    this.patch({ cards: this.state.cards.filter(candidate => candidate.key !== key) })
  }

  moveCard(key: string, geometry: Partial<Geometry>): void {
    this.patch({
      cards: this.state.cards.map(card => (card.key === key ? { ...card, ...geometry } : card)),
    })
  }

  // -------------------------------------------------------------- editing

  /** Record a keystroke: debounced save, with a synchronous flush available. */
  editCard(key: string, body: string): void {
    const card = this.state.cards.find(candidate => candidate.key === key)
    if (card === undefined) return
    // Do not re-render the card on every keystroke. A React re-render of a
    // contenteditable blurs it, which used to call create again and spawn
    // a new note per IME composition update.
    const previous = this.pending.get(key)
    if (previous !== undefined) window.clearTimeout(previous.timer)
    const timer = window.setTimeout(() => { void this.flush(key) }, AUTOSAVE_DEBOUNCE_MS)
    this.pending.set(key, { timer, body })
  }

  /** Write a pending edit immediately (blur, Esc, close, unload). */
  flushNow(key: string): void {
    const pendingEdit = this.pending.get(key)
    if (pendingEdit === undefined) return
    window.clearTimeout(pendingEdit.timer)
    this.pending.delete(key)
    void this.saveBody(key, pendingEdit.body)
  }

  async flush(key: string): Promise<void> {
    const pendingEdit = this.pending.get(key)
    if (pendingEdit === undefined) return
    this.pending.delete(key)
    await this.saveBody(key, pendingEdit.body)
  }

  flushAll(): void {
    for (const key of [...this.pending.keys()]) this.flushNow(key)
  }

  private async persistDraft(key: string, body: string): Promise<string | null> {
    const inflight = this.creating.get(key)
    if (inflight !== undefined) {
      const id = await inflight
      if (id !== null) await this.writeUpdate(id, body)
      return id
    }

    let settle: (id: string | null) => void = () => {}
    const gate = new Promise<string | null>(resolve => { settle = resolve })
    this.creating.set(key, gate)
    try {
      const known = new Set(this.state.notes.map(note => note.id))
      const snapshot = await this.post<NotesSnapshot>({ action: 'create', body })
      const createdId = snapshot.createdId
        ?? snapshot.notes.find(note => !known.has(note.id))?.id
        ?? null
      this.patch({
        cards: this.state.cards.map(card => (
          card.key === key ? { ...card, noteId: createdId, draft: body, fresh: false } : card
        )),
        notes: snapshot.notes,
        tags: snapshot.tags,
      })
      settle(createdId)
      return createdId
    } catch (error) {
      settle(null)
      throw error
    } finally {
      this.creating.delete(key)
    }
  }

  private async writeUpdate(id: string, body: string): Promise<void> {
    const snapshot = await this.post<NotesSnapshot>({ action: 'update', id, body })
    this.patch({ notes: snapshot.notes, tags: snapshot.tags })
  }

  private async saveBody(key: string, body: string): Promise<void> {
    const card = this.state.cards.find(candidate => candidate.key === key)
    if (card === undefined) return
    if (body.trim() === '' && card.noteId === null && !this.creating.has(key)) return
    if (card.noteId === null) {
      await this.persistDraft(key, body)
      return
    }
    await this.writeUpdate(card.noteId, body)
  }

  private bodyOf(card: CardState): string {
    return this.pending.get(card.key)?.body ?? card.draft
  }

  // ------------------------------------------------------------ mutations

  async mutate(action: NoteAction): Promise<void> {
    const snapshot = await this.post<NotesSnapshot>(action)
    this.patch({ notes: snapshot.notes, tags: snapshot.tags, error: null })
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.mutate({ action: 'update', id, pinned })
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.mutate({ action: 'update', id, archived })
  }

  /** Permanently remove notes. Used from the archived list only. */
  async deleteNotes(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.mutate({ action: 'delete', ids: [...ids] })
    const gone = new Set(ids)
    this.patch({ cards: this.state.cards.filter(card => card.noteId === null || !gone.has(card.noteId)) })
  }

  async renameTag(name: string, next: string): Promise<void> {
    await this.mutate({ action: 'rename-tag', name, next })
  }

  async deleteTag(name: string): Promise<void> {
    await this.mutate({ action: 'delete-tag', name })
  }

  // -------------------------------------------------------------- metadata

  /**
   * Label a note the first time it is closed.
   *
   * Skipped when the note is empty (it is discarded anyway) or already
   * labelled, so closing a card twice never costs a second model call.
   */
  async labelOnClose(id: string): Promise<void> {
    const note = this.state.notes.find(candidate => candidate.id === id)
    if (note === undefined || note.metadataAttempted) return
    if (isTextless(note.body)) {
      await this.applyFallbackTitle(note)
      return
    }
    if (this.labelling.has(id)) return
    this.labelling.add(id)
    try {
      const response = await postJson<{
        ok: boolean
        value?: NotesSnapshot & { outcome?: string }
        message?: string
      }>(METADATA_ROUTE, { id })
      if (!response.ok || response.value === undefined) {
        throw new Error(response.message ?? '生成标题失败')
      }
      this.patch({ notes: response.value.notes, tags: response.value.tags })
    } catch {
      // Silent by design: the note keeps its first-line title. The Settings
      // page surfaces the recorded failure, so nothing is lost.
      await this.reload()
    } finally {
      this.labelling.delete(id)
    }
  }

  /** Re-run labelling from the Settings page or the card menu. */
  async regenerate(id: string, force = false): Promise<void> {
    const note = this.state.notes.find(candidate => candidate.id === id)
    if (note !== undefined && isTextless(note.body)) {
      await this.applyFallbackTitle(note)
      return
    }
    try {
      const response = await postJson<{
        ok: boolean
        value?: NotesSnapshot & { needsConfirm?: boolean }
        message?: string
      }>(METADATA_ROUTE, { id, force })
      if (!response.ok || response.value === undefined) {
        throw new Error(response.message ?? '生成标题失败')
      }
      if (response.value.needsConfirm === true) {
        this.patch({ notice: '标题已手动修改，重新生成会覆盖它' })
        return
      }
      this.patch({ notes: response.value.notes, tags: response.value.tags, notice: null })
    } catch (error) {
      this.patch({ notice: error instanceof Error ? error.message : '生成标题失败' })
    }
  }

  /** Retry every note whose metadata round failed. */
  async retryFailed(): Promise<void> {
    const failed = this.state.notes.filter(note => note.metadataState === 'failed' && !note.archived && !note.trashed)
    for (const note of failed) await this.regenerate(note.id, true)
  }

  private async applyFallbackTitle(note: Note): Promise<void> {
    const title = isTextless(note.body) ? imageOnlyTitle(note.updatedAt) : firstLineTitle(note.body)
    if (title === note.title) return
    await this.mutate({
      action: 'update',
      id: note.id,
      title,
      titleSource: isTextless(note.body) ? 'image-only' : 'first-line',
      metadataAttempted: true,
      metadataState: 'skipped',
      metadataError: null,
    })
  }

  // -------------------------------------------------------------- plumbing

  setNotice(notice: string | null): void {
    this.patch({ notice })
  }

  /** Search results, ranked, with archived notes excluded unless asked. */
  search(query: string, includeArchived: boolean): Note[] {
    const pool = this.state.notes.filter(note => includeArchived || !(note.archived || note.trashed))
    return rankNotes(pool, query)
  }

  noteOf(id: string): Note | undefined {
    return this.state.notes.find(note => note.id === id)
  }

  private offsetGeometry(origin: CardState): Geometry {
    return this.clampGeometry({
      ...origin,
      x: origin.x + CASCADE,
      y: origin.y + CASCADE,
    })
  }

  private clampGeometry(card: CardState): Geometry {
    const titlebar = 40
    const maxX = Math.max(24, window.innerWidth - card.width - 24)
    const maxY = Math.max(titlebar + 8, window.innerHeight - card.height - 24)
    return {
      x: Math.min(maxX, Math.max(24, card.x)),
      y: Math.min(maxY, Math.max(titlebar + 8, card.y)),
      width: card.width,
      height: card.height,
    }
  }

  private nextGeometry(): Geometry {
    const offset = this.cascade * CASCADE
    this.cascade = (this.cascade + 1) % 6
    // Desktop's hiddenInset title bar is a 40px window-drag band. A card
    // spawned inside it cannot be grabbed — the window moves instead.
    const titlebar = 40
    const maxX = Math.max(24, window.innerWidth - CARD_WIDTH - 24)
    const maxY = Math.max(titlebar + 8, window.innerHeight - CARD_HEIGHT - 24)
    const centerX = Math.round((window.innerWidth - CARD_WIDTH) / 2)
    const centerY = Math.round((window.innerHeight - CARD_HEIGHT) / 2)
    return {
      x: Math.min(maxX, Math.max(24, centerX + offset)),
      y: Math.min(maxY, Math.max(titlebar + 8, centerY + offset)),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }
  }

  private async post<T>(body: unknown): Promise<T> {
    const response = await postJson<{ ok: boolean; value?: T; message?: string }>(NOTE_ROUTE, body)
    if (!response.ok || response.value === undefined) {
      throw new Error(response.message ?? '操作失败')
    }
    return response.value
  }

  private patch(next: Partial<NotesStoreState>): void {
    this.state = { ...this.state, ...next }
    for (const listener of [...this.listeners]) listener()
  }

  /** Detach every listener and drop pending timers. */
  dispose(): void {
    for (const pendingEdit of this.pending.values()) window.clearTimeout(pendingEdit.timer)
    this.pending.clear()
    this.listeners.clear()
  }
}

const NOTE_ROUTE = '/quick-notes/note'
const NOTES_ROUTE = '/quick-notes/notes'
const METADATA_ROUTE = '/quick-notes/metadata'

/** Tags shown for a note: its own tags, de-duplicated. */
export function tagsOf(note: Note): string[] {
  return dedupeTags(note.tags)
}
