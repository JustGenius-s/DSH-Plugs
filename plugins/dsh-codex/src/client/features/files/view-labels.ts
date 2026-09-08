import type { FileReviewSide } from './review-comment'

/** Copy for the code and diff views, supplied by the panel's locale binding. */
export interface ViewLabels {
  /** Expand-row label; `{count}` is the hidden row count. */
  expand: (count: number) => string
  unmodifiedLines: (count: number) => string
  findPlaceholder: string
  findNoResults: string
  findInvalidRegex: string
  /** `{current}` / `{total}` — 1-based current index. */
  findMatchCount: (current: number, total: number) => string
  findPrev: string
  findNext: string
  findClose: string
  findMatchCase: string
  findWholeWord: string
  findRegex: string
  addComment: string
  commentPlaceholder: string
  commentCancel: string
  commentSubmit: string
  commentFailed: string
  commentAuthor: string
  commentLine: (side: FileReviewSide, line: number) => string
  commentLines: (side: FileReviewSide, start: number, end: number) => string
}
