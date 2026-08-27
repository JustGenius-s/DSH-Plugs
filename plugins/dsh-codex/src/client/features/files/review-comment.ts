import { useMemo, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CodexKey } from '../../locales'
import { insertComposerReference } from '../../host-adapters/composer'
import { registerFileReviewCommentUi } from './review-comment-ui'

export const FILE_REVIEW_COMMENT_SOURCE = 'file-review-comment'

export type FileReviewSide = 'file' | 'old' | 'new'

export interface FileReviewComment {
  path: string
  side: FileReviewSide
  startLine: number
  endLine: number
  body: string
  code: string
}

export interface ReviewCommentEntry extends FileReviewComment {
  ref: string
  sessionId: string
}

export interface FileReviewCommentApi {
  insert(sessionId: string, comment: FileReviewComment): boolean
  /** Comments for one session filtered by file path (diff/preview inline pins). */
  list(sessionId: string, path: string): ReviewCommentEntry[]
  /** Subscribe to list changes (insert/remove); returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void
  /** Monotonic version for useSyncExternalStore snapshots. */
  getVersion(): number
  dispose(): void
}

/** Minimal view of the review-comment API the code/diff surfaces consume. */
export interface ReviewCommentSource {
  list(path: string): ReviewCommentEntry[]
  subscribe(listener: () => void): () => void
  getVersion(): number
}

/**
 * Live review comments for one file path, stable across renders so
 * `useSyncExternalStore` re-subscribes only when the source/path changes.
 */
export function useReviewComments(
  source: ReviewCommentSource | undefined,
  path: string | undefined,
): ReviewCommentEntry[] {
  // Snapshot is the monotonic VERSION (a number), not the list itself:
  // list() allocates a fresh array on every call and `useSyncExternalStore`
  // compares snapshots with Object.is, so returning the array here would
  // re-render forever. The version is stable between emits, and the list is
  // derived once per version below.
  const subscribe = useMemo(
    () => source?.subscribe ?? (() => () => {}),
    [source],
  )
  const getVersion = useMemo(
    () => (source === undefined ? () => 0 : source.getVersion),
    [source],
  )
  const version = useSyncExternalStore(subscribe, getVersion, getVersion)
  return useMemo(
    () => (source === undefined || path === undefined ? [] : source.list(path)),
    [source, path, version],
  )
}

/**
 * Register a composer reference for file/diff comments. The visible chip is
 * compact; the serializer expands it into the complete review location,
 * request, and selected source when the user sends the conversation turn.
 */
export function createFileReviewCommentApi(
  ctx: ClientContext,
  t: (key: CodexKey) => string,
): FileReviewCommentApi {
  const entries = new Map<string, ReviewCommentEntry>()
  const listeners = new Set<() => void>()
  let version = 0
  const emit = (): void => {
    version += 1
    for (const listener of listeners) listener()
  }
  const mintRef = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return FILE_REVIEW_COMMENT_SOURCE + ':' + crypto.randomUUID()
    }
    return FILE_REVIEW_COMMENT_SOURCE + ':' + Date.now().toString(36)
      + Math.random().toString(36).slice(2)
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: FILE_REVIEW_COMMENT_SOURCE,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText(ref: string): string {
        const entry = entries.get(ref)
        return entry === undefined ? '' : labelFor(entry)
      },
      serialize(ref: string, _signal: AbortSignal): Promise<string> {
        const entry = entries.get(ref)
        if (entry === undefined) {
          return Promise.reject(new Error(`file review comment "${ref}" is no longer available`))
        }
        return Promise.resolve(serializeReviewComment(entry))
      },
    },
  }
  const disposeSource = ctx.inputTriggers.registerSource(source)
  const disposeUi = registerFileReviewCommentUi(ctx, {
    get(ref) {
      return entries.get(ref)
    },
    remove(ref) {
      const entry = entries.get(ref)
      if (entry === undefined) return
      entries.delete(ref)
      emit()
    },
    all(sessionId) {
      return [...entries.values()].filter(entry => entry.sessionId === sessionId)
    },
  }, t)

  return {
    insert(sessionId, comment) {
      const body = comment.body.trim()
      if (body.length === 0 || comment.path.length === 0) return false
      const ref = mintRef()
      const entry: ReviewCommentEntry = { ...comment, body, ref, sessionId }
      entries.set(ref, entry)
      const label = labelFor(comment)
      const reference: ReferenceInsert = {
        source: FILE_REVIEW_COMMENT_SOURCE,
        ref,
        // The occurrence's visible chip in the draft: `@<file>:<lines>` —
        // the same shape as an @file reference, so deleting/editing it reads
        // as ordinary text and the machine's trailing separator space is the
        // expected @mention gap, not a stray invisible marker.
        label,
        clipboardText: `@${label}`,
      }
      const applied = insertComposerReference(ctx, sessionId, reference)
      if (applied) emit()
      else entries.delete(ref)
      return applied
    },
    list(sessionId, path) {
      return [...entries.values()]
        .filter(entry => entry.sessionId === sessionId && entry.path === path)
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getVersion() {
      return version
    },
    dispose() {
      disposeUi()
      entries.clear()
      listeners.clear()
      disposeSource()
    },
  }
}

function labelFor(comment: Pick<FileReviewComment, 'path' | 'startLine' | 'endLine'>): string {
  const slash = comment.path.lastIndexOf('/')
  const file = slash === -1 ? comment.path : comment.path.slice(slash + 1)
  const lines = comment.startLine === comment.endLine
    ? String(comment.endLine)
    : `${comment.startLine}-${comment.endLine}`
  return `${file}:${lines}`
}

function serializeReviewComment(comment: FileReviewComment): string {
  const range = comment.startLine === comment.endLine
    ? `line ${comment.endLine}`
    : `lines ${comment.startLine}-${comment.endLine}`
  const source = comment.code.length === 0
    ? '(source unavailable)'
    : comment.code.split('\n').map(line => '    ' + line).join('\n')
  return [
    '',
    `<file_review_comment path="${escapeAttribute(comment.path)}" side="${comment.side}" range="${range}" start_line="${comment.startLine}" end_line="${comment.endLine}">`,
    comment.body,
    '',
    'Selected source:',
    source,
    '</file_review_comment>',
    '',
  ].join('\n')
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
