/**
 * Self-drawn code and diff surfaces for the files panel.
 *
 * The ui-primitives `CodeBlock`/`DiffBlock` are NOT used here: that package
 * stubs its CSS modules out of the built bundle and ships no stylesheet, so
 * in a plugin bundle those components render unstyled. These views draw with
 * the panel's own CSS (same `--dsw-*` tokens as the git-graph panel), which
 * keeps the files panel visually consistent with the rest of the sidebar.
 */
import { useMemo, useState } from 'react'
import { highlightLines } from './highlight'

/** Lines shown before a long file collapses behind an expand row. */
const MAX_PREVIEW_LINES = 400
/** Diff rows shown before a long patch collapses behind an expand row. */
const MAX_DIFF_ROWS = 240

export interface ViewLabels {
  /** Expand-row label; `{count}` is the hidden row count. */
  expand: (count: number) => string
}

/** One file's contents with a line-number gutter and syntax highlighting. */
export function FileCodeView(props: {
  content: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
}) {
  const { content, lang, labels } = props
  const lines = useMemo(() => splitLines(content), [content])
  const highlighted = useMemo(
    () => highlightLines(content, lang),
    [content, lang],
  )
  const [expanded, setExpanded] = useState(false)
  const capped = !expanded && lines.length > MAX_PREVIEW_LINES
  const visible = capped ? lines.slice(0, MAX_PREVIEW_LINES) : lines
  const gutterWidth = String(lines.length).length
  return (
    <div className="dsh-files-view">
      <div className="dsh-files-code">
        {visible.map((line, index) => (
          <div key={index} className="dsh-files-code-line">
            <span
              className="dsh-files-code-ln"
              style={{ width: gutterWidth + 'ch' }}
            >
              {index + 1}
            </span>
            <span className="dsh-files-code-text">
              {line.length === 0
                ? ' '
                : (highlighted?.[index]?.map((span, spanIndex) => (
                    <span key={spanIndex} style={span.style}>
                      {span.text}
                    </span>
                  )) ?? line)}
            </span>
          </div>
        ))}
        {capped ? (
          <ExpandRow
            count={lines.length - MAX_PREVIEW_LINES}
            labels={labels}
            onExpand={() => setExpanded(true)}
          />
        ) : null}
      </div>
    </div>
  )
}

type DiffRowKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

interface DiffRow {
  kind: DiffRowKind
  /** Line number on the old side (del/ctx rows only). */
  oldLn?: number
  /** Line number on the new side (add/ctx rows only). */
  newLn?: number
  text: string
}

/** One file's unified patch with dual line-number gutters. */
export function FileDiffView(props: { patch: string; labels: ViewLabels }) {
  const { patch, labels } = props
  const rows = useMemo(() => parsePatch(patch), [patch])
  const [expanded, setExpanded] = useState(false)
  const capped = !expanded && rows.length > MAX_DIFF_ROWS
  const visible = capped ? rows.slice(0, MAX_DIFF_ROWS) : rows
  let maxLn = 0
  for (const row of rows) {
    maxLn = Math.max(maxLn, row.oldLn ?? 0, row.newLn ?? 0)
  }
  const gutterWidth = String(Math.max(maxLn, 1)).length
  return (
    <div className="dsh-files-view">
      <div className="dsh-files-diff-body">
        {visible.map((row, index) => (
          <div key={index} className={'dsh-files-diff-row is-' + row.kind}>
            <span
              className="dsh-files-diff-ln"
              style={{ width: gutterWidth + 'ch' }}
            >
              {row.oldLn ?? ''}
            </span>
            <span
              className="dsh-files-diff-ln"
              style={{ width: gutterWidth + 'ch' }}
            >
              {row.newLn ?? ''}
            </span>
            <span className="dsh-files-diff-sign">{signFor(row.kind)}</span>
            <span className="dsh-files-diff-text">
              {row.text.length === 0 ? ' ' : row.text}
            </span>
          </div>
        ))}
        {capped ? (
          <ExpandRow
            count={rows.length - MAX_DIFF_ROWS}
            labels={labels}
            onExpand={() => setExpanded(true)}
          />
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
      {props.labels.expand(props.count)}
    </button>
  )
}

function splitLines(content: string): string[] {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return body.length === 0 ? [] : body.split('\n')
}

/**
 * Parse a unified patch into render rows. File headers (`diff --git`,
 * `index`, `---`, `+++`, mode lines) are dropped — the panel header already
 * names the file. Hunk headers reset the line-number counters; `\ No newline
 * at end of file` and binary notes render as dimmed note rows.
 */
function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLn = 0
  let newLn = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match !== null) {
        oldLn = Number.parseInt(match[1] ?? '0', 10)
        newLn = Number.parseInt(match[2] ?? '0', 10)
      }
      rows.push({ kind: 'hunk', text: line })
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

function signFor(kind: DiffRowKind): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '−'
  return ''
}
