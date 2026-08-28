import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { insertComposerText } from '../../host-adapters/composer'

export type FileReviewSide = 'file' | 'old' | 'new'

export interface FileReviewComment {
  path: string
  side: FileReviewSide
  startLine: number
  endLine: number
  body: string
  code: string
}

export interface FileReviewCommentApi {
  insert(sessionId: string, comment: FileReviewComment): boolean
  dispose(): void
}

/**
 * Append a file/diff review comment to the conversation draft as PLAIN TEXT.
 *
 * DSH has no generic draft-attachment channel yet (images are the only real
 * attachment: `imageIds`); earlier revisions faked an attachment by routing
 * comments through the `@`-reference placeholder, which read as editable text
 * and gained a stray separator space. Until the platform ships custom
 * attachments, the comment is serialized to a readable text block appended to
 * the draft — it still reaches the model on send, without any chip/DOM hack.
 */
export function createFileReviewCommentApi(ctx: ClientContext): FileReviewCommentApi {
  return {
    insert(sessionId, comment) {
      const body = comment.body.trim()
      if (body.length === 0 || comment.path.length === 0) return false
      const text = serializeReviewComment(comment)
      return insertComposerText(ctx, sessionId, text)
    },
    dispose() {},
  }
}

function serializeReviewComment(comment: FileReviewComment): string {
  const name = basename(comment.path)
  const range = comment.startLine === comment.endLine
    ? `L${comment.endLine}`
    : `L${comment.startLine}-${comment.endLine}`
  const side = comment.side === 'old'
    ? '原始'
    : comment.side === 'new'
      ? '修改后'
      : '文件'
  const lines = [
    `[评论] ${name} ${side} ${range}`,
    '',
    comment.body,
  ]
  if (comment.code.trim() !== '') {
    lines.push('', '```', comment.code, '```')
  }
  return lines.join('\n') + '\n'
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}
