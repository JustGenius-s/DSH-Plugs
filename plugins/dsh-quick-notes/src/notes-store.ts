// On-disk note library for 随手笔记.
//
// Storage is deliberately simple and user-readable: one `index.json` holding
// every note's metadata, and the Markdown body of each note in `notes/<id>.md`
// under `$DSH_HOME/quick-notes`. Pasted images live in `attachments/` and are
// referenced from the Markdown by a same-origin URL.
//
// Every write goes through a temp-file + rename, so a crash mid-write leaves
// the previous file intact. The library is global by design: notes are not
// scoped to a workspace.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  compareNotes,
  dedupeTags,
  metadataTextOf,
  mintNoteId,
  normalizeTag,
  attachmentIdsOf,
  isTextless,
  type Note,
  type NoteAction,
  type NotesSnapshot,
  type TitleSource,
} from './shared.ts'

interface NoteIndex {
  version: 1
  notes: Note[]
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function rootDir(): string {
  return join(dshHome(), 'quick-notes')
}

function notesDir(): string {
  return join(rootDir(), 'notes')
}

function attachmentsDir(): string {
  return join(rootDir(), 'attachments')
}

function indexPath(): string {
  return join(rootDir(), 'index.json')
}

export function attachmentDir(imageId: string): string {
  return join(attachmentsDir(), imageId)
}

function ensureDirs(): void {
  mkdirSync(notesDir(), { recursive: true })
  mkdirSync(attachmentsDir(), { recursive: true })
}

function atomicWrite(file: string, body: string | Buffer): void {
  ensureDirs()
  const tmp = `${file}.tmp-${String(process.pid)}`
  writeFileSync(tmp, body)
  renameSync(tmp, file)
}

function emptyIndex(): NoteIndex {
  return { version: 1, notes: [] }
}

function isTitleSource(value: unknown): value is TitleSource {
  return value === 'first-line' || value === 'ai' || value === 'image-only' || value === 'manual'
}

function isMetadataState(value: unknown): value is Note['metadataState'] {
  return value === 'pending' || value === 'done' || value === 'failed' || value === 'skipped'
}

/** Validate one stored note, discarding anything a future version cannot read. */
function normalizeNote(raw: unknown): Note | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  if (typeof value.body !== 'string') return null
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null
  if (!Array.isArray(value.tags)) return null
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    titleSource: isTitleSource(value.titleSource) ? value.titleSource : 'first-line',
    body: value.body,
    tags: dedupeTags(value.tags.filter((tag): tag is string => typeof tag === 'string')),
    pinned: value.pinned === true,
    archived: value.archived === true,
    trashed: value.trashed === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    metadataAttempted: value.metadataAttempted === true,
    metadataState: isMetadataState(value.metadataState) ? value.metadataState : 'skipped',
    metadataError: typeof value.metadataError === 'string' ? value.metadataError : null,
  }
}

function loadIndex(): NoteIndex {
  try {
    const raw = JSON.parse(readFileSync(indexPath(), 'utf8')) as { notes?: unknown }
    if (!Array.isArray(raw.notes)) return emptyIndex()
    const notes: Note[] = []
    let revived = false
    for (const item of raw.notes) {
      const note = normalizeNote(item)
      if (note === null) continue
      // Older libraries had a recycle bin. Those notes stay — they become
      // archived, which is the only way a note can leave the active list.
      if (note.trashed) {
        notes.push({ ...note, trashed: false, archived: true })
        revived = true
      } else {
        notes.push(note)
      }
    }
    const index: NoteIndex = { version: 1, notes }
    if (revived) saveIndex(index)
    return index
  } catch {
    return emptyIndex()
  }
}

function saveIndex(index: NoteIndex): void {
  atomicWrite(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
}

function readBody(id: string): string {
  try {
    return readFileSync(join(notesDir(), `${id}.md`), 'utf8')
  } catch {
    return ''
  }
}

function writeBody(id: string, body: string): void {
  atomicWrite(join(notesDir(), `${id}.md`), body.endsWith('\n') ? body : `${body}\n`)
}

/** The tag directory: every tag in use, most-used first, then alphabetical. */
function tagDirectory(notes: readonly Note[]): string[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const note of notes) {
    if (note.trashed) continue
    for (const raw of note.tags) {
      const tag = normalizeTag(raw)
      if (tag === '') continue
      const key = tag.toLowerCase()
      const found = counts.get(key)
      if (found === undefined) counts.set(key, { name: tag, count: 1 })
      else found.count += 1
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(entry => entry.name)
}

export function notesRoot(): string {
  return rootDir()
}

/** Every note plus the tag directory, ordered for list rendering. */
export function listSnapshot(): NotesSnapshot {
  const index = loadIndex()
  const notes = index.notes
    .map(note => ({ ...note, body: readBody(note.id) }))
    .sort(compareNotes)
  return { root: rootDir(), notes, tags: tagDirectory(index.notes) }
}

export function getNote(id: string): Note | null {
  const found = loadIndex().notes.find(note => note.id === id)
  if (found === undefined) return null
  return { ...found, body: readBody(found.id) }
}

/** Apply one mutation, persisting index and body together. */
export function applyAction(action: NoteAction): NotesSnapshot {
  switch (action.action) {
    case 'create': {
      const created = createNote(action.body ?? '', action.tags ?? [])
      return { ...listSnapshot(), createdId: created.id }
    }
    case 'update':
      updateNote(action)
      return listSnapshot()
    case 'delete':
      deleteNotes(action.ids)
      return listSnapshot()
    case 'bulk':
      bulkEdit(action)
      return listSnapshot()
    case 'rename-tag': {
      renameTag(action.name, action.next)
      return listSnapshot()
    }
    case 'delete-tag': {
      deleteTag(action.name)
      return listSnapshot()
    }
  }
}

function createNote(body: string, tags: string[]): Note {
  const now = Date.now()
  const note: Note = {
    id: mintNoteId(now),
    title: '',
    titleSource: 'first-line',
    body,
    tags: dedupeTags(tags),
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
    metadataAttempted: false,
    metadataState: 'pending',
    metadataError: null,
  }
  const index = loadIndex()
  index.notes.push(note)
  writeBody(note.id, body)
  saveIndex(index)
  return note
}

function updateNote(action: Extract<NoteAction, { action: 'update' }>): Note | null {
  const index = loadIndex()
  const at = index.notes.findIndex(note => note.id === action.id)
  if (at < 0) return null
  const previous = index.notes[at]!
  const next: Note = {
    ...previous,
    title: action.title === undefined ? previous.title : action.title,
    titleSource: action.titleSource === undefined ? previous.titleSource : action.titleSource,
    tags: action.tags === undefined ? previous.tags : dedupeTags(action.tags),
    pinned: action.pinned ?? previous.pinned,
    archived: action.archived ?? previous.archived,
    metadataAttempted: action.metadataAttempted ?? previous.metadataAttempted,
    metadataState: action.metadataState ?? previous.metadataState,
    metadataError: action.metadataError === undefined ? previous.metadataError : action.metadataError,
    updatedAt: Date.now(),
  }
  let bodyChanged = false
  if (action.body !== undefined && action.body !== previous.body) {
    next.body = action.body
    writeBody(next.id, action.body)
    bodyChanged = true
  }
  index.notes[at] = next
  saveIndex(index)
  // Editing a note is the common way an image stops being referenced, so this
  // is where the orphan sweep has to run — otherwise removed images pile up
  // for as long as the note exists.
  if (bodyChanged) pruneOrphans(index)
  return { ...next, body: action.body ?? readBody(next.id) }
}

function deleteNotes(ids: readonly string[]): void {
  if (ids.length === 0) return
  const drop = new Set(ids)
  const index = loadIndex()
  const next = index.notes.filter(note => !drop.has(note.id))
  if (next.length === index.notes.length) return
  index.notes = next
  saveIndex(index)
  pruneOrphans(index)
}

function bulkEdit(action: Extract<NoteAction, { action: 'bulk' }>): void {
  if (action.ids.length === 0) return
  const ids = new Set(action.ids)
  const index = loadIndex()
  let touched = false
  for (let at = 0; at < index.notes.length; at += 1) {
    const note = index.notes[at]!
    if (!ids.has(note.id)) continue
    const next: Note = {
      ...note,
      archived: action.archived ?? note.archived,
      tags: mergeTags(note.tags, action.addTags, action.removeTags),
      updatedAt: Date.now(),
    }
    index.notes[at] = next
    touched = true
  }
  if (!touched) return
  saveIndex(index)
  pruneOrphans(index)
}

function mergeTags(current: readonly string[], add?: string[], remove?: string[]): string[] {
  if (add === undefined && remove === undefined) return [...current]
  const removed = new Set((remove ?? []).map(tag => normalizeTag(tag).toLowerCase()))
  const kept = current.filter(tag => !removed.has(tag.toLowerCase()))
  return dedupeTags([...kept, ...(add ?? [])])
}

function renameTag(name: string, next: string): void {
  const from = normalizeTag(name).toLowerCase()
  const to = normalizeTag(next)
  if (from === '' || to === '' || from === to.toLowerCase()) return
  const index = loadIndex()
  for (let at = 0; at < index.notes.length; at += 1) {
    const note = index.notes[at]!
    if (!note.tags.some(tag => tag.toLowerCase() === from)) continue
    index.notes[at] = {
      ...note,
      tags: dedupeTags(note.tags.map(tag => (tag.toLowerCase() === from ? to : tag))),
      updatedAt: Date.now(),
    }
  }
  saveIndex(index)
}

function deleteTag(name: string): void {
  const target = normalizeTag(name).toLowerCase()
  if (target === '') return
  const index = loadIndex()
  for (let at = 0; at < index.notes.length; at += 1) {
    const note = index.notes[at]!
    if (!note.tags.some(tag => tag.toLowerCase() === target)) continue
    index.notes[at] = {
      ...note,
      tags: note.tags.filter(tag => tag.toLowerCase() !== target),
      updatedAt: Date.now(),
    }
  }
  saveIndex(index)
}

/** Drop note bodies and attachments no longer reachable from the index. */
function pruneOrphans(index: NoteIndex): void {
  const keepBodies = new Set(index.notes.map(note => `${note.id}.md`))
  if (existsSync(notesDir())) {
    for (const name of readdirSync(notesDir())) {
      if (name.endsWith('.md') && !keepBodies.has(name)) {
        try {
          rmSync(join(notesDir(), name))
        } catch {
          // Best effort: a stray file must not fail the write it followed.
        }
      }
    }
  }
  const keepImages = new Set<string>()
  for (const note of index.notes) {
    for (const id of attachmentIdsOf(readBody(note.id))) keepImages.add(id)
  }
  if (!existsSync(attachmentsDir())) return
  for (const name of readdirSync(attachmentsDir())) {
    if (keepImages.has(name)) continue
    try {
      rmSync(join(attachmentsDir(), name), { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
}

/** Persist a pasted image and return the id its Markdown reference uses. */
export function saveImage(imageId: string, mediaType: string, data: Buffer): void {
  ensureDirs()
  const dir = attachmentDir(imageId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, 'meta.json'), `${JSON.stringify({ id: imageId, mediaType, size: data.byteLength }, null, 2)}\n`)
  atomicWrite(join(dir, 'blob'), data)
}

/** Read back a stored image; `null` when the id is unknown. */
export function readImage(imageId: string): { mediaType: string; data: Buffer } | null {
  try {
    const meta = JSON.parse(readFileSync(join(attachmentDir(imageId), 'meta.json'), 'utf8')) as { mediaType?: unknown }
    const data = readFileSync(join(attachmentDir(imageId), 'blob'))
    return { mediaType: typeof meta.mediaType === 'string' ? meta.mediaType : 'application/octet-stream', data }
  } catch {
    return null
  }
}

/** The text the model sees for one note, or `''` for an image-only note. */
export function metadataInput(body: string): string {
  return isTextless(body) ? '' : metadataTextOf(body)
}
