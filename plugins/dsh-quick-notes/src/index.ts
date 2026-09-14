// Host half of 随手笔记: the note library, pasted-image storage, and the one
// model call that labels a note.
//
// It owns four same-origin routes (see shared.ts) that the browser half calls,
// plus the `quick-notes` settings namespace. Everything else — cards, search,
// Settings chrome — lives in the browser half.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, Schema, errorMessage, installSettingsSection, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import { generateMetadata } from './metadata.ts'
import { applyAction, listSnapshot, notesRoot, readImage, saveImage } from './notes-store.ts'
import {
  ATTACHMENT_PATH,
  DEFAULT_CONFIG,
  IMAGE_MEDIA_TYPES,
  IMAGE_PATH,
  MAX_IMAGE_BYTES,
  METADATA_PATH,
  NOTE_PATH,
  NOTES_PATH,
  SETTINGS_NAMESPACE,
  attachmentIdOf,
  dedupeTags,
  firstLineTitle,
  imageOnlyTitle,
  isTextless,
  mintImageId,
  normalizeTag,
  type Note,
  type NoteAction,
  type NotesSnapshot,
  type QuickNotesConfig,
} from './shared.ts'

export const name = 'dsh-quick-notes'
export const inject = [HOST_SERVICES.webServer, HOST_SERVICES.settings, HOST_SERVICES.llm, HOST_SERVICES.agentDefaultModel] as const

/** Host-side schema for the one plugin settings namespace. */
export const ConfigSchema: Schema<QuickNotesConfig> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled),
  newNoteShortcut: Schema.string().default(DEFAULT_CONFIG.newNoteShortcut),
  searchShortcut: Schema.string().default(DEFAULT_CONFIG.searchShortcut),
  metadataProvider: Schema.string().default(DEFAULT_CONFIG.metadataProvider),
  metadataModel: Schema.string().default(DEFAULT_CONFIG.metadataModel),
})

export function apply(ctx: Context): void {
  let source = (): QuickNotesConfig => DEFAULT_CONFIG

  installSettingsSection(ctx, SETTINGS_NAMESPACE, ConfigSchema, DEFAULT_CONFIG, {
    setSource: (next) => { source = next },
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: NOTES_PATH,
      handler: (req, res) => handleNotes(req, res),
    }),
    'quick-notes: notes route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: NOTE_PATH,
      handler: (req, res) => { void handleNote(req, res) },
    }),
    'quick-notes: note route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: METADATA_PATH,
      handler: (req, res) => { void handleMetadata(ctx, req, res, source) },
    }),
    'quick-notes: metadata route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: IMAGE_PATH,
      handler: (req, res) => { void handleImageUpload(req, res) },
    }),
    'quick-notes: image upload route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ATTACHMENT_PATH,
      handler: (req, res) => handleAttachment(req, res),
    }),
    'quick-notes: attachment route',
  )
}

function handleNotes(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  sendJson(res, 200, { ok: true, value: listSnapshot() })
}

/** Create, update, archive, delete, bulk-edit, and tag maintenance. */
async function handleNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '', 'http://dsh.local')
    const id = url.searchParams.get('id')?.trim() ?? ''
    if (id === '') {
      sendJson(res, 400, { ok: false, message: 'id is required' })
      return
    }
    const note = listSnapshot().notes.find(candidate => candidate.id === id)
    if (note === undefined) {
      sendJson(res, 404, { ok: false, message: 'note not found' })
      return
    }
    sendJson(res, 200, { ok: true, value: note })
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: errorMessage(error) })
    return
  }

  const action = parseAction(body)
  if (action === undefined) {
    sendJson(res, 400, { ok: false, message: 'invalid note action' })
    return
  }

  try {
    const snapshot = applyAction(action)
    sendJson(res, 200, { ok: true, value: snapshot })
  } catch (error) {
    sendJson(res, 500, { ok: false, message: errorMessage(error) })
  }
}

/**
 * Label one note on demand.
 *
 * Called when a non-empty card is first closed, and again only when the user
 * asks for it. `force` is what makes a manual title overwritable, and the
 * browser half confirms that case before sending it.
 */
async function handleMetadata(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  source: () => QuickNotesConfig,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  if (body === null || typeof body !== 'object') {
    sendJson(res, 400, { ok: false, message: 'invalid body' })
    return
  }

  const value = body as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id : ''
  if (id === '') {
    sendJson(res, 400, { ok: false, message: 'id is required' })
    return
  }

  const snapshot = listSnapshot()
  const note = snapshot.notes.find(candidate => candidate.id === id)
  if (note === undefined) {
    sendJson(res, 404, { ok: false, message: 'note not found' })
    return
  }

  const config = source()
  const selection = config.metadataProvider !== '' && config.metadataModel !== ''
    ? { provider: config.metadataProvider, model: config.metadataModel }
    : undefined

  try {
    const outcome = await generateMetadata(ctx, note, snapshot.tags, selection, value.force === true)
    if (outcome.kind === 'needs-confirm') {
      sendJson(res, 200, { ok: true, value: { ...listSnapshot(), needsConfirm: true } })
      return
    }
    const updated = persistMetadata(outcome.note)
    sendJson(res, 200, {
      ok: true,
      value: { ...listSnapshot(), outcome: outcome.kind, note: updated },
    })
  } catch (error) {
    sendJson(res, 500, { ok: false, message: errorMessage(error) })
  }
}

/**
 * Write a generated label back, keeping the fallback title when there is none.
 *
 * A note always has a readable title: the first line of its body, or
 * "图片笔记 <date>" when it holds only images.
 */
function persistMetadata(note: Note): Note {
  const title = note.title.trim() === ''
    ? (isTextless(note.body) ? imageOnlyTitle(note.updatedAt) : firstLineTitle(note.body))
    : note.title
  const titleSource = note.title.trim() === ''
    ? (isTextless(note.body) ? 'image-only' : 'first-line')
    : note.titleSource
  applyAction({
    action: 'update',
    id: note.id,
    ...(title === note.title ? {} : { title }),
    ...(titleSource === note.titleSource ? {} : { titleSource }),
    tags: note.tags,
    metadataAttempted: note.metadataAttempted,
    metadataState: note.metadataState,
    metadataError: note.metadataError,
  })
  return { ...note, title, titleSource }
}

/** Accept one pasted image as base64 and return its Markdown reference id. */
async function handleImageUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req, MAX_IMAGE_BYTES * 2)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  if (body === null || typeof body !== 'object') {
    sendJson(res, 400, { ok: false, message: 'invalid body' })
    return
  }

  const value = body as Record<string, unknown>
  const mediaType = typeof value.mediaType === 'string' ? value.mediaType : ''
  const data = typeof value.data === 'string' ? value.data : ''
  if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    sendJson(res, 415, { ok: false, message: `unsupported image type: ${mediaType || 'unknown'}` })
    return
  }
  if (data === '') {
    sendJson(res, 400, { ok: false, message: 'image data is required' })
    return
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(data, 'base64')
  } catch {
    sendJson(res, 400, { ok: false, message: 'image data is not valid base64' })
    return
  }
  if (buffer.byteLength === 0) {
    sendJson(res, 400, { ok: false, message: 'image is empty' })
    return
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    sendJson(res, 413, { ok: false, message: 'image is larger than 10MB' })
    return
  }

  try {
    const id = mintImageId()
    saveImage(id, mediaType, buffer)
    sendJson(res, 200, { ok: true, value: { id, mediaType, size: buffer.byteLength } })
  } catch (error) {
    sendJson(res, 500, { ok: false, message: errorMessage(error) })
  }
}

/** Serve a stored image to the editor's Markdown reference. */
function handleAttachment(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  const id = attachmentIdOf((req.url ?? '').split('?')[0] ?? '')
  if (id === null) {
    sendJson(res, 404, { ok: false, message: 'attachment not found' })
    return
  }
  const found = readImage(id)
  if (found === null) {
    sendJson(res, 404, { ok: false, message: 'attachment not found' })
    return
  }
  res.writeHead(200, {
    'content-type': found.mediaType,
    'content-length': String(found.data.byteLength),
    'cache-control': 'private, max-age=31536000, immutable',
  })
  res.end(found.data)
}

function parseAction(body: unknown): NoteAction | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = body as Record<string, unknown>
  const action = value.action

  if (action === 'create') {
    return {
      action: 'create',
      body: typeof value.body === 'string' ? value.body : '',
      tags: Array.isArray(value.tags) ? dedupeTags(value.tags.filter((tag): tag is string => typeof tag === 'string')) : [],
    }
  }

  if (action === 'update') {
    if (typeof value.id !== 'string') return undefined
    return {
      action: 'update',
      id: value.id,
      ...(typeof value.body === 'string' ? { body: value.body } : {}),
      ...(typeof value.title === 'string' ? { title: value.title } : {}),
      ...(isTitleSource(value.titleSource) ? { titleSource: value.titleSource } : {}),
      ...(Array.isArray(value.tags)
        ? { tags: dedupeTags(value.tags.filter((tag): tag is string => typeof tag === 'string')) }
        : {}),
      ...(typeof value.pinned === 'boolean' ? { pinned: value.pinned } : {}),
      ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
      ...(typeof value.metadataAttempted === 'boolean' ? { metadataAttempted: value.metadataAttempted } : {}),
      ...(isMetadataState(value.metadataState) ? { metadataState: value.metadataState } : {}),
      ...(value.metadataError === null || typeof value.metadataError === 'string'
        ? { metadataError: value.metadataError === null ? null : String(value.metadataError) }
        : {}),
    }
  }

  if (action === 'delete') {
    const ids = Array.isArray(value.ids)
      ? value.ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : typeof value.id === 'string' && value.id.trim() !== ''
        ? [value.id]
        : []
    if (ids.length === 0) return undefined
    return { action: 'delete', ids }
  }

  if (action === 'bulk') {
    if (!Array.isArray(value.ids)) return undefined
    const ids = value.ids.filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) return undefined
    return {
      action: 'bulk',
      ids,
      ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
      ...(Array.isArray(value.addTags)
        ? { addTags: value.addTags.filter((tag): tag is string => typeof tag === 'string').map(tag => normalizeTag(tag)) }
        : {}),
      ...(Array.isArray(value.removeTags)
        ? { removeTags: value.removeTags.filter((tag): tag is string => typeof tag === 'string').map(tag => normalizeTag(tag)) }
        : {}),
    }
  }

  if (action === 'rename-tag') {
    if (typeof value.name !== 'string' || typeof value.next !== 'string') return undefined
    return { action: 'rename-tag', name: value.name, next: value.next }
  }

  if (action === 'delete-tag') {
    if (typeof value.name !== 'string') return undefined
    return { action: 'delete-tag', name: value.name }
  }

  return undefined
}

function isTitleSource(value: unknown): value is Note['titleSource'] {
  return value === 'first-line' || value === 'ai' || value === 'image-only' || value === 'manual'
}

function isMetadataState(value: unknown): value is Note['metadataState'] {
  return value === 'pending' || value === 'done' || value === 'failed' || value === 'skipped'
}

export { notesRoot }
export type { NotesSnapshot }
