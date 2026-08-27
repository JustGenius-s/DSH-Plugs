import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { insertComposerReference } from '../../host-adapters/composer'

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

interface ReviewCommentEntry extends FileReviewComment {
  ref: string
}

export interface FileReviewCommentApi {
  insert(sessionId: string, comment: FileReviewComment): boolean
  dispose(): void
}

/**
 * Register a composer reference for file/diff comments. The visible chip is
 * compact; the serializer expands it into the complete review location,
 * request, and selected source when the user sends the conversation turn.
 */
export function createFileReviewCommentApi(ctx: ClientContext): FileReviewCommentApi {
  const entries = new Map<string, ReviewCommentEntry>()
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

  return {
    insert(sessionId, comment) {
      const body = comment.body.trim()
      if (body.length === 0 || comment.path.length === 0) return false
      const ref = mintRef()
      const entry: ReviewCommentEntry = { ...comment, body, ref }
      entries.set(ref, entry)
      const reference: ReferenceInsert = {
        source: FILE_REVIEW_COMMENT_SOURCE,
        ref,
        label: labelFor(entry),
        clipboardText: '@' + labelFor(entry),
      }
      const applied = insertComposerReference(ctx, sessionId, reference)
      if (!applied) entries.delete(ref)
      return applied
    },
    dispose() {
      entries.clear()
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
  const side = comment.side === 'old'
    ? 'original/deleted side'
    : comment.side === 'new'
      ? 'modified/added side'
      : 'file preview'
  const range = comment.startLine === comment.endLine
    ? `line ${comment.endLine}`
    : `lines ${comment.startLine}-${comment.endLine}`
  const source = comment.code.length === 0
    ? '(source unavailable)'
    : comment.code.split('\n').map(line => '    ' + line).join('\n')
  return [
    '',
    `<file_review_comment path="${escapeAttribute(comment.path)}" side="${side}" range="${range}">`,
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
