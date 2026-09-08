import type { HighlightSpan } from './highlight'
import { highlightLines } from './highlight'
import type { FileReviewSide } from './review-comment'

/** A unified-patch row's presentation kind. */
export type DiffRowKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

export interface DiffRow {
  kind: DiffRowKind
  /** Line number on the old side (del/ctx rows only). */
  oldLn?: number
  /** Line number on the new side (add/ctx rows only). */
  newLn?: number
  /** Unchanged source lines omitted before this hunk. */
  unmodifiedLines?: number
  text: string
}

/** Which side of a change a diff comment attaches to (never the file side). */
export type DiffCommentSide = Exclude<FileReviewSide, 'file'>

export interface DiffCommentTarget {
  startIndex: number
  endIndex: number
  side: DiffCommentSide
}

/**
 * Parse a unified patch into render rows. File headers (`diff --git`,
 * `index`, `---`, `+++`, mode lines) are dropped — the panel header already
 * names the file. Hunk headers reset the line-number counters; `\ No newline
 * at end of file` and binary notes render as dimmed note rows.
 */
export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLn = 0
  let newLn = 0
  let seenHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match !== null) {
        const nextOldLn = Number.parseInt(match[1] ?? '0', 10)
        const nextNewLn = Number.parseInt(match[2] ?? '0', 10)
        const oldGap = seenHunk ? nextOldLn - oldLn : nextOldLn - 1
        const newGap = seenHunk ? nextNewLn - newLn : nextNewLn - 1
        const unmodifiedLines = Math.max(0, Math.min(oldGap, newGap))
        if (unmodifiedLines > 0) {
          rows.push({ kind: 'hunk', text: line, unmodifiedLines })
        }
        oldLn = nextOldLn
        newLn = nextNewLn
        seenHunk = true
        continue
      }
      rows.push({ kind: 'hunk', text: line, unmodifiedLines: 0 })
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', newLn, text: line.slice(1) })
      newLn += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'del', oldLn, text: line.slice(1) })
      oldLn += 1
      continue
    }
    if (line.startsWith(' ')) {
      rows.push({ kind: 'ctx', oldLn, newLn, text: line.slice(1) })
      oldLn += 1
      newLn += 1
      continue
    }
    if (line.startsWith('\\') || line.startsWith('Binary files')) {
      rows.push({ kind: 'note', text: line })
      continue
    }
    // Anything else is a file-header/meta line — hidden by design.
  }
  return rows
}

/** The side a row's comment button attaches to, or undefined for meta rows. */
export function commentSideForRow(row: DiffRow): DiffCommentSide | undefined {
  if (row.kind === 'del') return 'old'
  if (row.kind === 'add' || row.kind === 'ctx') return 'new'
  return undefined
}

/** Unified Codex view shows the line number for the side this row belongs to. */
export function unifiedLineNumber(row: DiffRow): number | undefined {
  return row.kind === 'del' ? row.oldLn : row.newLn ?? row.oldLn
}

export function rowLineForSide(
  row: DiffRow,
  side: DiffCommentSide,
): number | undefined {
  return side === 'old' ? row.oldLn : row.newLn
}

/** Widest line number in the patch, for gutter sizing. */
export function maxLineNumber(rows: readonly DiffRow[]): number {
  let maxLn = 0
  for (const row of rows) {
    maxLn = Math.max(maxLn, row.oldLn ?? 0, row.newLn ?? 0)
  }
  return maxLn
}

/** Resolve a selected row range into the line numbers and text a comment carries. */
export function diffCommentInfo(
  rows: readonly DiffRow[],
  target: DiffCommentTarget,
): { startLine: number; endLine: number; code: string } | undefined {
  const selected: Array<{ line: number; text: string }> = []
  for (let index = target.startIndex; index <= target.endIndex; index += 1) {
    const row = rows[index]
    if (row === undefined) continue
    const line = rowLineForSide(row, target.side)
    if (line !== undefined) selected.push({ line, text: row.text })
  }
  if (selected.length === 0) return undefined
  return {
    startLine: selected[0]?.line ?? 0,
    endLine: selected[selected.length - 1]?.line ?? 0,
    code: selected.map(item => item.text).join('\n'),
  }
}

/**
 * Syntax-highlight diff content lines, aligned with `rows` (undefined entry =
 * render plain). Each hunk is rebuilt into its old-side (ctx+del) and new-side
 * (ctx+add) fragments and tokenized separately, so multi-line constructs
 * inside one hunk highlight correctly; constructs spanning a hunk gap (block
 * comments, template literals) are approximate, same as GitHub. Context rows
 * prefer the new-side tokenization.
 */
export function highlightDiffRows(
  rows: readonly DiffRow[],
  lang: string | undefined,
): (HighlightSpan[] | undefined)[] {
  const out: (HighlightSpan[] | undefined)[] = rows.map(() => undefined)
  if (lang === undefined) return out
  let index = 0
  while (index < rows.length) {
    const kind = rows[index]?.kind
    if (kind === 'hunk' || kind === 'note' || kind === undefined) {
      index += 1
      continue
    }
    const start = index
    while (index < rows.length) {
      const k = rows[index]?.kind
      if (k === 'hunk' || k === 'note' || k === undefined) break
      index += 1
    }
    const newSide: number[] = []
    const oldSide: number[] = []
    for (let i = start; i < index; i += 1) {
      const k = rows[i]?.kind
      if (k === 'ctx' || k === 'add') newSide.push(i)
      if (k === 'ctx' || k === 'del') oldSide.push(i)
    }
    const newHl = highlightLines(
      newSide.map((i) => rows[i]?.text ?? '').join('\n'),
      lang,
    )
    const oldHl = highlightLines(
      oldSide.map((i) => rows[i]?.text ?? '').join('\n'),
      lang,
    )
    newSide.forEach((rowIndex, line) => {
      out[rowIndex] = newHl?.[line]
    })
    oldSide.forEach((rowIndex, line) => {
      if (out[rowIndex] === undefined) out[rowIndex] = oldHl?.[line]
    })
  }
  return out
}
