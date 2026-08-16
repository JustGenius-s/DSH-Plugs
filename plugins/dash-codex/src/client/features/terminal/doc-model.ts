// Document model: flatten all command blocks into one linear sequence of
// rows that the canvas painter draws and the selection maps back to text.
//
// Mirrors how Warp lays out a BlockList vertically into a single scrollable
// document: each block contributes a prompt header row, its command row(s),
// and its output grid rows, separated by a gap. Block chrome is overlaid by
// the view using the per-block row ranges computed here.

import type { BlockContext } from '../../../shared/terminal-protocol'
import type { BlockGrid } from './block-store'
import type { DocRow } from './cell-render'

export interface DocBlock {
  id: string
  command: string
  context: BlockContext | null
  startedAt: number
  durationMs: number | null
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
  grid: BlockGrid
}

/** Row span one block occupies in the composed document. */
export interface DocBlockRange {
  id: string
  headerRow: number
  commandRow: number
  outputRow: number
  endRow: number
}

// One row for the border gap, one row for the status content.
const HEADER_ROWS = 2
// Vertical breathing room between a block's status line, its command line and
// its output rows, like Warp's block padding (padding_top / command_padding /
// padding_middle).
const HEADER_TO_COMMAND_GAP = 1
const COMMAND_TO_OUTPUT_GAP = 1
const BLOCK_GAP = 1

function wrapCount(text: string, cols: number): number {
  if (text.length === 0) return 0
  return Math.max(1, Math.ceil(text.length / cols))
}

/**
 * Leading output rows that merely echo the submitted command (prompt theme
 * glyph + the command text the shell readline redrew) are dropped: Warp keeps
 * the command in its own header grid and the output grid starts at real
 * output. We detect the echo by finding the command text at the tail of the
 * first non-empty output row and skip every row up to and including it.
 */
function echoRowsToSkip(block: DocBlock): number {
  const command = block.command.trim()
  if (command.length === 0) return 0
  const grid = block.grid
  const limit = Math.min(grid.contentRows, 3)
  for (let r = 0; r < limit; r += 1) {
    const line = grid.term.buffer.active.getLine(r)
    if (line === undefined) continue
    const text = line.translateToString(true).trim()
    if (text.length === 0) continue
    // The echo row ends with the command (prompt prefix precedes it).
    if (text === command || text.endsWith(command)) return r + 1
    // First non-empty row is not an echo; real output starts here.
    return 0
  }
  return 0
}

export interface ComposedDoc {
  totalRows: number
  ranges: DocBlockRange[]
  /** Resolve a composed doc row to a paintable/extractable row. */
  rowAt: (row: number) => DocRow | undefined
}

/** Compose all blocks into the linear document the painter walks. */
export function composeDoc(blocks: DocBlock[], cols: number): ComposedDoc {
  const ranges: DocBlockRange[] = []
  // Precompute each block's row span.
  let cursor = 0
  const echoSkip = new Map<string, number>()
  for (const block of blocks) {
    const skip = echoRowsToSkip(block)
    echoSkip.set(block.id, skip)
    const headerRow = cursor
    cursor += HEADER_ROWS
    cursor += HEADER_TO_COMMAND_GAP
    const commandRow = cursor
    const commandRows = wrapCount(block.command, cols)
    cursor += commandRows
    if (commandRows > 0) cursor += COMMAND_TO_OUTPUT_GAP
    const outputRow = cursor
    cursor += Math.max(0, block.grid.contentRows - skip)
    ranges.push({ id: block.id, headerRow, commandRow, outputRow, endRow: cursor })
    cursor += BLOCK_GAP
  }
  const totalRows = cursor

  const rowAt = (row: number): DocRow | undefined => {
    if (row < 0 || row >= totalRows) return undefined
    // Linear scan is fine for typical block counts; blocks are few.
    for (let i = 0; i < blocks.length; i += 1) {
      const range = ranges[i]
      if (row < range.headerRow || row >= range.endRow + BLOCK_GAP) continue
      const block = blocks[i]
      if (row === range.headerRow) {
        return { kind: 'blank' } // header chrome is overlaid by the view
      }
      if (row >= range.commandRow && row < range.outputRow) {
        // Command rows: rendered inline so selection/copy includes them.
        const idx = row - range.commandRow
        const start = idx * cols
        const slice = block.command.slice(start, start + cols)
        return { kind: 'text', text: slice, bold: true }
      }
      if (row >= range.outputRow && row < range.endRow) {
        const skip = echoSkip.get(block.id) ?? 0
        return { kind: 'cells', term: block.grid.term, row: row - range.outputRow + skip }
      }
      return { kind: 'blank' } // block gap
    }
    return undefined
  }

  return { totalRows, ranges, rowAt }
}