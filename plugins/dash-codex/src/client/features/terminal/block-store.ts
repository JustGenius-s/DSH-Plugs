// Headless per-block output grids — the data layer of the Warp-style terminal.
//
// Aligned with Warp's app/src/terminal/model: each command block owns a
// lightweight cell grid (here a headless xterm.js Terminal used purely as an
// ANSI-parsing cell buffer) instead of a mounted renderer. No DOM, no canvas,
// no per-block viewport or scrollbar. The single mounted master surface reads
// these grids to compose the whole transcript.

import { Terminal } from '@xterm/xterm'

export interface BlockGrid {
  id: string
  term: Terminal
  /** Row count that actually holds content (trailing blanks trimmed). */
  contentRows: number
  /** Bump whenever the grid content changed so the master re-reads it. */
  version: number
  dirty: boolean
}

export interface StoreOptions {
  cols: number
  scrollback: number
}

/** Create a headless grid that never touches the DOM. */
export function createBlockGrid(id: string, opts: StoreOptions, onQueryResponse?: (data: string) => void): BlockGrid {
  const term = new Terminal({
    cols: opts.cols,
    rows: 1, // grown on demand; scrollback retains everything
    scrollback: opts.scrollback,
    allowProposedApi: true,
    convertEol: true,
    // NOT disableStdin: the grid must answer terminal queries (cursor-position
    // ESC[6n, device attributes ESC[>c, ...) via onData, and disableStdin:true
    // suppresses exactly those answers — which is what left vim hanging.
    cursorBlink: false,
  })
  // Full-screen programs (vim & co.) query the terminal (cursor position
  // ESC[6n, device attributes ESC[>c, ...) and block until the terminal
  // answers. xterm produces those answers on onData; forward them to the PTY
  // immediately — binding must happen at creation, because the queries arrive
  // in the very first output chunk, before any alt-screen detection runs.
  if (onQueryResponse !== undefined) {
    term.onData(onQueryResponse)
  }
  return { id, term, contentRows: 0, version: 0, dirty: false }
}

/** Number of leading rows that hold real content (trailing blanks trimmed). */
export function contentRowCount(term: Terminal): number {
  const buf = term.buffer.active
  let last = buf.length - 1
  while (last >= 0) {
    const line = buf.getLine(last)
    if (line !== undefined) {
      const text = line.translateToString(true).trim()
      // zsh prints a lone '%' (or '⏎') marker after output lacking a trailing
      // newline; that marker row is shell chrome, not content.
      if (text.length > 0 && text !== '%' && text !== '⏎') break
    }
    last -= 1
  }
  return Math.max(0, last + 1)
}

/**
 * Append raw PTY output to a block grid, growing the buffer as needed so no
 * line is lost. The grid stays headless; the caller re-reads rows for render.
 */
export function writeToGrid(grid: BlockGrid, data: string, opts: StoreOptions, onWritten?: () => void): void {
  const term = grid.term
  // Grow rows so content never scrolls past the readable window we compose
  // from. xterm keeps everything in scrollback anyway, but a generous rows
  // value keeps cursor-addressing sequences (rare in block output) stable.
  const needed = Math.min(opts.scrollback + 1, Math.max(term.rows, grid.contentRows + 8))
  if (needed !== term.rows) {
    try {
      term.resize(opts.cols, needed)
    } catch {
      // resize during write is non-fatal; scrollback still retains data
    }
  }
  term.write(data, () => {
    grid.contentRows = contentRowCount(term)
    grid.version += 1
    grid.dirty = true
    if (onWritten !== undefined) onWritten()
  })
}

/** Resize every grid to a new column count (e.g. panel width change). */
export function resizeGrid(grid: BlockGrid, cols: number): void {
  try {
    grid.term.resize(cols, grid.term.rows)
  } catch {
    // ignore transient resize failures
  }
  grid.contentRows = contentRowCount(grid.term)
  grid.version += 1
  grid.dirty = true
}

/** Read one row as plain text, right-trimmed. */
export function rowText(grid: BlockGrid, row: number): string {
  const line = grid.term.buffer.active.getLine(row)
  return line === undefined ? '' : line.translateToString(true)
}

export function disposeGrid(grid: BlockGrid): void {
  try {
    grid.term.dispose()
  } catch {
    // already disposed
  }
}
