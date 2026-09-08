// Shared contract between the Host half and the Browser half of the
// "随手笔记" (quick-notes) plugin, plus the pure rules both halves use.
//
// The Host owns the note library on disk, the pasted-image attachments, and the
// model call that mints a title and tags. The Browser half owns the floating
// cards, the shortcut search overlay, and the Settings page. Everything that
// has to agree across that boundary lives here.

/** Same-origin HTTP routes registered by the Host half. */
export const NOTES_PATH = '/quick-notes/notes'
export const NOTE_PATH = '/quick-notes/note'
export const METADATA_PATH = '/quick-notes/metadata'
export const IMAGE_PATH = '/quick-notes/image'
export const ATTACHMENT_PATH = '/quick-notes/attachment'

/** Settings namespace owned by the Host half (lowercase + hyphen). */
export const SETTINGS_NAMESPACE = 'quick-notes' as const

/** Largest single pasted image the Host accepts, in bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Image media types accepted from the clipboard. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Most cards allowed on screen at once. */
export const MAX_OPEN_CARDS = 10

/** Debounce before an edit is flushed to disk, in milliseconds. */
export const AUTOSAVE_DEBOUNCE_MS = 500

/** Most tags one generated metadata round may attach to a note. */
export const MAX_AI_TAGS = 3

/** Most brand-new tags one generated metadata round may mint. */
export const MAX_NEW_AI_TAGS = 1

/** Longest note body sent to the model. Longer notes are truncated. */
export const MAX_METADATA_TEXT = 4_000

/** Shared `{ ok, value | message }` envelope. */
export type NotesResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** How the current title was produced. `manual` freezes AI overwrites. */
export type TitleSource = 'first-line' | 'ai' | 'image-only' | 'manual'

/** Outcome of the last automatic metadata round for one note. */
export type MetadataState = 'pending' | 'done' | 'failed' | 'skipped'

/** One note as the Host stores and serves it. */
export interface Note {
  id: string
  title: string
  titleSource: TitleSource
  body: string
  tags: string[]
  pinned: boolean
  archived: boolean
  trashed: boolean
  createdAt: number
  updatedAt: number
  /** True once a first automatic title/tag round has been attempted. */
  metadataAttempted: boolean
  metadataState: MetadataState
  metadataError: string | null
}

/** The note library plus the tag directory, as Settings and search read it. */
export interface NotesSnapshot {
  root: string
  notes: Note[]
  tags: string[]
  /** Present after `create`, so the card binds to that row instead of guessing. */
  createdId?: string
}

export type NoteAction =
  | { action: 'create'; body?: string; tags?: string[] }
  | {
      action: 'update'
      id: string
      body?: string
      title?: string
      titleSource?: TitleSource
      tags?: string[]
      pinned?: boolean
      archived?: boolean
      metadataState?: MetadataState
      metadataError?: string | null
      metadataAttempted?: boolean
    }
  | { action: 'delete'; ids: string[] }
  | { action: 'bulk'; ids: string[]; archived?: boolean; addTags?: string[]; removeTags?: string[] }
  | { action: 'rename-tag'; name: string; next: string }
  | { action: 'delete-tag'; name: string }

/** Plugin configuration, stored in the Host settings namespace. */
export interface QuickNotesConfig {
  enabled: boolean
  newNoteShortcut: string
  searchShortcut: string
  metadataProvider: string
  metadataModel: string
}

export const DEFAULT_CONFIG: QuickNotesConfig = {
  enabled: true,
  newNoteShortcut: 'Mod+Shift+N',
  searchShortcut: 'Mod+Shift+F',
  metadataProvider: '',
  metadataModel: '',
}

/** One pasted image, as the Browser half uploads and the Host stores it. */
export interface SavedImage {
  id: string
  mediaType: string
  size: number
}

/** Result of a metadata round; `needsConfirm` asks before overwriting edits. */
export type MetadataOutcome =
  | { kind: 'generated'; note: Note }
  | { kind: 'skipped'; note: Note }
  | { kind: 'failed'; note: Note }
  | { kind: 'needs-confirm'; note: Note }

/** Compare notes the way both the Settings list and search overlay order them. */
export function compareNotes(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Case-insensitive substring search across title, body, and tags.
 *
 * Chinese has no word boundaries to tokenize, so a plain substring match is
 * both predictable and fast enough for a local library.
 */
export function matchesQuery(note: Note, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (note.title.toLowerCase().includes(needle)) return true
  if (note.body.toLowerCase().includes(needle)) return true
  return note.tags.some(tag => tag.toLowerCase().includes(needle))
}

/** Relevance ordering for a non-empty query; pinned and freshness break ties. */
export function rankNotes(notes: readonly Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return notes.slice().sort(compareNotes)
  return notes
    .map(note => ({ note, score: scoreNote(note, needle) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || compareNotes(a.note, b.note)
    ))
    .map(entry => entry.note)
}

function scoreNote(note: Note, needle: string): number {
  const title = note.title.toLowerCase()
  let score = 0
  if (title === needle) score += 100
  else if (title.startsWith(needle)) score += 60
  else if (title.includes(needle)) score += 40
  if (note.body.toLowerCase().includes(needle)) score += 12
  if (note.tags.some(tag => tag.toLowerCase() === needle)) score += 30
  else if (note.tags.some(tag => tag.toLowerCase().includes(needle))) score += 16
  return score
}

/**
 * The fallback title: the first non-empty line of the body.
 *
 * Used the moment a note is saved and kept permanently when no model is
 * configured or the model fails, so a note is never "Untitled".
 */
export function firstLineTitle(body: string): string {
  for (const line of body.split('\n')) {
    const text = line.replace(/^\s*[-*+]\s+/, '').replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').trim()
    if (text !== '') return truncate(text, 80)
  }
  return ''
}

/** True when a note carries no text at all — only images (or nothing). */
export function isTextless(body: string): boolean {
  return plainTextOf(body).trim() === ''
}

/** Body with every Markdown image and code fence stripped, for model input. */
export function plainTextOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\r/g, '')
}

/** The title given to a note that holds only images. */
export function imageOnlyTitle(now = Date.now()): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `图片笔记 ${stamp}`
}

/** Model input: the visible text, capped so a long note cannot blow the budget. */
export function metadataTextOf(body: string): string {
  // Collapse the runs of spaces left behind by stripped images and fences, so
  // the model reads "买咖啡 记得磨豆" instead of "买咖啡   记得磨豆".
  const text = plainTextOf(body)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length <= MAX_METADATA_TEXT ? text : text.slice(0, MAX_METADATA_TEXT)
}

/** Attachment reference written into Markdown by the editor. */
export function attachmentRef(imageId: string): string {
  return `/quick-notes/attachment/${imageId}`
}

/** Extract every attachment id referenced by a note body. */
export function attachmentIdsOf(body: string): string[] {
  const ids = new Set<string>()
  // Capture up to the closing paren (or the start of an optional title), not
  // just to the first space: a target like ".../attachment/not a valid id"
  // must be rejected whole instead of yielding the bare token "not".
  for (const match of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)]*?)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const href = match[1] ?? ''
    const found = attachmentIdOf(href)
    if (found !== null) ids.add(found)
  }
  return [...ids]
}

/** Read the attachment id out of a Markdown image target, if it is one. */
export function attachmentIdOf(href: string): string | null {
  const prefix = '/quick-notes/attachment/'
  if (!href.startsWith(prefix)) return null
  const id = href.slice(prefix.length).split(/[?#]/)[0]?.trim() ?? ''
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null
}

/** Normalize a user-typed tag: trimmed, collapsed spaces, length-capped. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 32)
}

/** De-duplicate tags case-insensitively, preserving first-seen order. */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

/** Stable id: time-ordered, random-suffixed, filesystem-safe. */
export function mintNoteId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `note-${now.toString(36)}-${rand}`
}

export function mintImageId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `img-${now.toString(36)}-${rand}`
}
