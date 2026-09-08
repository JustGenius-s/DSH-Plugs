// Title/tag generation for one note, called once — when a non-empty card is
// first closed.
//
// The rules come straight from the product contract:
// - exactly one model call, returning a title and up to 3 tags;
// - tags are matched against the tags the user already has first, so
//   "前端 / Frontend / Web 前端" stays one tag instead of three;
// - at most 1 brand-new tag per round;
// - only the note's plain text and the existing tag names go to the model —
//   never an image, a local path, another note, or session context;
// - any failure leaves the note usable: title keeps its first line, tags stay
//   empty, and the failure is recorded for the Settings page to retry.

import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { createUserMessage, type StreamChunk } from '@just-genius/dsh-plugin-runtime/host'
import {
  MAX_AI_TAGS,
  MAX_NEW_AI_TAGS,
  dedupeTags,
  isTextless,
  metadataTextOf,
  normalizeTag,
  truncate,
  type MetadataOutcome,
  type Note,
} from './shared.ts'

const TIMEOUT_MS = 45_000

const SYSTEM_PROMPT = [
  'You label a short sticky note.',
  'Reply with JSON only: {"title":"...","tags":["..."]}.',
  `Title: at most 40 characters, specific, no quotes, no trailing period, same language as the note.`,
  `Tags: at most ${String(MAX_AI_TAGS)}. Reuse a name from the existing tag list whenever one fits; `
  + `invent at most ${String(MAX_NEW_AI_TAGS)} new tag. New tags are lowercase, 1-3 words, no '#'.`,
  'If the note has no readable text, return an empty tags array.',
].join(' ')

/**
 * Generate and persist metadata for one note.
 *
 * Host-side, so the model credentials and the provider registry stay in the
 * Node half; the browser never sees a key.
 *
 * @param ctx - host context; reads `llm` and `agentDefaultModel` on demand.
 * @param note - the note to label, already persisted.
 * @param existingTags - every tag in the library, for reuse.
 * @param selection - override provider/model; defaults to the harness default.
 * @param force - re-generate even when a title was hand-edited.
 * @returns the updated note, or a `needs-confirm` ask when `force` would
 *   overwrite a manual title.
 */
export async function generateMetadata(
  ctx: Context,
  note: Note,
  existingTags: readonly string[],
  selection?: { provider: string; model: string },
  force = false,
): Promise<MetadataOutcome> {
  if (isTextless(note.body)) {
    return { kind: 'skipped', note: markSkipped(note, 'image only') }
  }
  if (force !== true && note.titleSource === 'manual') {
    return { kind: 'needs-confirm', note }
  }

  const text = metadataTextOf(note.body)
  if (text === '') {
    return { kind: 'skipped', note: markSkipped(note, 'no text') }
  }

  const resolved = selection ?? defaultSelection(ctx)
  if (resolved === undefined) {
    return { kind: 'failed', note: markFailed(note, 'no model is configured') }
  }

  try {
    const raw = await callModel(ctx, resolved, text, existingTags)
    const parsed = parseMetadata(raw)
    if (parsed === null) {
      return { kind: 'failed', note: markFailed(note, 'the model returned no usable label') }
    }
    const tags = pickTags(parsed.tags, existingTags)
    return {
      kind: 'generated',
      note: {
        ...note,
        title: parsed.title === '' ? note.title : truncate(parsed.title, 80),
        titleSource: parsed.title === '' ? note.titleSource : 'ai',
        tags,
        metadataAttempted: true,
        metadataState: 'done',
        metadataError: null,
      },
    }
  } catch (error) {
    return { kind: 'failed', note: markFailed(note, error instanceof Error ? error.message : String(error)) }
  }
}

function markSkipped(note: Note, reason: string): Note {
  return {
    ...note,
    metadataAttempted: true,
    metadataState: 'skipped',
    metadataError: reason,
  }
}

function markFailed(note: Note, message: string): Note {
  return {
    ...note,
    metadataAttempted: true,
    metadataState: 'failed',
    metadataError: truncate(message, 240),
  }
}

/** The harness default model, or `undefined` when none is configured. */
function defaultSelection(ctx: Context): { provider: string; model: string } | undefined {
  const llm = ctx.get('llm')
  const defaults = ctx.get('agentDefaultModel')
  if (llm === undefined || defaults === undefined) return undefined
  const selection = defaults.currentSelection() as { provider?: unknown; model?: unknown }
  if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return undefined
  if (selection.provider === '' || selection.model === '') return undefined
  return { provider: selection.provider, model: selection.model }
}

async function callModel(
  ctx: Context,
  selection: { provider: string; model: string },
  text: string,
  existingTags: readonly string[],
): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('no model is configured')
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: SYSTEM_PROMPT,
      messages: [createUserMessage({
        content: [{ type: 'text', text: userPrompt(text, existingTags) }],
        source: { kind: 'user' },
      })],
      maxTokens: 512,
      signal: abort.signal,
    })
    return await collectText(stream)
  } finally {
    clearTimeout(timer)
  }
}

function userPrompt(text: string, existingTags: readonly string[]): string {
  const parts = [`Note:\n${text}`]
  if (existingTags.length > 0) parts.push(`Existing tags: ${existingTags.join(', ')}`)
  return parts.join('\n\n')
}

/**
 * Read the visible text of one model stream.
 *
 * `llm.stream` normalizes provider failures into a terminal `finish` chunk, so
 * consuming only deltas would silently accept a failed call.
 */
async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      text += chunk.block.text
      continue
    }
    if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      throw new Error(chunk.reason.failure.message)
    }
  }
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (cleaned === '') throw new Error('the model returned an empty message')
  return cleaned
}

interface ParsedMetadata {
  title: string
  tags: string[]
}

/** Parse the model's JSON reply, tolerating a code fence or a leading sentence. */
export function parseMetadata(raw: string): ParsedMetadata | null {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let value: unknown
  try {
    value = JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim().replace(/\s+/g, ' ') : ''
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  if (title === '' && tags.length === 0) return null
  return { title: truncate(title, 80), tags: dedupeTags(tags).slice(0, MAX_AI_TAGS) }
}

/**
 * Choose the final tags: reuse first, then at most one new tag.
 *
 * @param suggested - tags the model proposed.
 * @param existing - every tag already in the library.
 */
export function pickTags(suggested: readonly string[], existing: readonly string[]): string[] {
  const known = new Map(existing.map(tag => [tag.toLowerCase(), tag]))
  const out: string[] = []
  let invented = 0

  for (const raw of suggested) {
    if (out.length >= MAX_AI_TAGS) break
    const tag = normalizeTag(raw).replace(/^#/, '')
    if (tag === '') continue
    const reused = known.get(tag.toLowerCase())
    if (reused !== undefined) {
      if (!out.includes(reused)) out.push(reused)
      continue
    }
    if (invented >= MAX_NEW_AI_TAGS) continue
    if (out.some(kept => kept.toLowerCase() === tag.toLowerCase())) continue
    invented += 1
    out.push(tag)
  }

  return dedupeTags(out).slice(0, MAX_AI_TAGS)
}
