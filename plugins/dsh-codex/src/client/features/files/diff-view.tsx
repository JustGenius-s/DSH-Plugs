/**
 * One file's unified patch with dual line-number gutters (Codex/Pierre style:
 * indicator left, one active-side line number).
 */
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { IconChevronDownOutline14, IconPlusOutline16 } from '@just-genius/dsh-plugin-ui'
import { InlineReviewCommentEditor } from './review-comment-editor'
import { gutterWidthOf, renderLineText } from './code-text'
import {
  commentSideForRow,
  diffCommentInfo,
  highlightDiffRows,
  maxLineNumber,
  parsePatch,
  rowLineForSide,
  unifiedLineNumber,
  type DiffCommentSide,
  type DiffCommentTarget,
} from './diff-model'
import type { ViewLabels } from './view-labels'
import type { FileReviewComment } from './review-comment'

/** Diff rows shown before a long patch collapses behind an expand row. */
const MAX_DIFF_ROWS = 240

export function FileDiffView(props: {
  patch: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
  /** Light/dark theme pair, so a settings change re-highlights this view. */
  themeKey?: string
  path?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { patch, lang, labels, themeKey = '' } = props
  const rows = useMemo(() => parsePatch(patch), [patch])
  const highlighted = useMemo(() => highlightDiffRows(rows, lang), [rows, lang, themeKey])
  const [expanded, setExpanded] = useState(false)
  const [commentTarget, setCommentTarget] = useState<DiffCommentTarget | null>(null)
  useEffect(() => setCommentTarget(null), [patch, props.path])
  const capped = !expanded && rows.length > MAX_DIFF_ROWS
  const list = capped ? rows.slice(0, MAX_DIFF_ROWS) : rows
  const gutterWidth = gutterWidthOf(maxLineNumber(rows))
  const commentInfo = commentTarget === null ? undefined : diffCommentInfo(rows, commentTarget)

  const beginComment = (
    rowIndex: number,
    side: DiffCommentSide,
    event: ReactMouseEvent,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    setCommentTarget((current) => {
      if (!event.shiftKey || current === null || current.side !== side) {
        return { startIndex: rowIndex, endIndex: rowIndex, side }
      }
      return {
        startIndex: Math.min(current.startIndex, rowIndex),
        endIndex: Math.max(current.endIndex, rowIndex),
        side,
      }
    })
  }

  return (
    <div className="dsh-files-view" data-dsh-codex-retained-scroll="">
      <div className="dsh-files-diff-body">
        {list.map((row, index) => {
          const commentSide = commentSideForRow(row)
          const lineNumber = unifiedLineNumber(row)
          const commentSelected = commentTarget !== null
            && index >= commentTarget.startIndex
            && index <= commentTarget.endIndex
            && rowLineForSide(row, commentTarget.side) !== undefined
          return (
            <div key={index} className="dsh-files-diff-entry">
              <div
                className={
                  'dsh-files-diff-row is-' + row.kind
                  + (commentSelected ? ' is-comment-selected' : '')
                }
                role={row.kind === 'hunk' ? 'separator' : undefined}
                aria-label={row.kind === 'hunk' ? row.text : undefined}
                title={row.kind === 'hunk' ? row.text : undefined}
              >
                <span className="dsh-files-diff-gutter">
                  <span className="dsh-files-diff-mark" aria-hidden />
                  <span
                    className="dsh-files-diff-ln"
                    style={{ width: gutterWidth }}
                  >
                    {lineNumber ?? ''}
                    {commentSide !== undefined
                      && props.path !== undefined
                      && props.onAddComment !== undefined ? (
                      <button
                        type="button"
                        className="dsh-files-comment-add"
                        title={labels.addComment}
                        aria-label={`${labels.addComment}, ${labels.commentLine(
                          commentSide,
                          rowLineForSide(row, commentSide) ?? 0,
                        )}`}
                        onClick={(event) => beginComment(index, commentSide, event)}
                      >
                        <IconPlusOutline16 size={12} />
                      </button>
                      ) : null}
                  </span>
                </span>
                <span className="dsh-files-diff-text">
                  {row.kind === 'hunk' && row.unmodifiedLines !== undefined
                    ? labels.unmodifiedLines(row.unmodifiedLines)
                    : renderLineText(row.text, highlighted[index])}
                </span>
              </div>
              {commentTarget !== null
                && index === commentTarget.endIndex
                && commentInfo !== undefined
                && props.path !== undefined
                && props.onAddComment !== undefined ? (
                  <InlineReviewCommentEditor
                    key={`${commentTarget.side}:${commentTarget.startIndex}:${commentTarget.endIndex}`}
                    label={commentInfo.startLine === commentInfo.endLine
                      ? labels.commentLine(commentTarget.side, commentInfo.endLine)
                      : labels.commentLines(
                          commentTarget.side,
                          commentInfo.startLine,
                          commentInfo.endLine,
                        )}
                    labels={labels}
                    onCancel={() => setCommentTarget(null)}
                    onSubmit={(body) => {
                      const applied = props.onAddComment?.({
                        path: props.path ?? '',
                        side: commentTarget.side,
                        startLine: commentInfo.startLine,
                        endLine: commentInfo.endLine,
                        body,
                        code: commentInfo.code,
                      }) === true
                      if (applied) setCommentTarget(null)
                      return applied
                    }}
                  />
                ) : null}
            </div>
          )
        })}
        {capped ? (
          <div className="dsh-files-expand-slot">
            <ExpandRow
              count={rows.length - MAX_DIFF_ROWS}
              labels={labels}
              onExpand={() => setExpanded(true)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ExpandRow(props: {
  count: number
  labels: ViewLabels
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      className="dsh-files-expand"
      onClick={props.onExpand}
    >
      <span className="dsh-files-expand-control" aria-hidden>
        <IconChevronDownOutline14 size={14} />
      </span>
      <span className="dsh-files-expand-label">
        {props.labels.expand(props.count)}
      </span>
    </button>
  )
}
