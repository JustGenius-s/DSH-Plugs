// Render model: compose every block's headless grid into ONE master surface.
//
// Aligned with Warp's BlockListElement + CellGlyphCache: the whole terminal is
// a single painted surface; blocks are laid out vertically with their prompt
// header and output rows, and the surface scrolls as one. Block chrome
// (context segments, actions) is overlaid by the view at computed row offsets.
//
// Output rows are rebuilt cell-by-cell into SGR sequences so colors and
// attributes survive the re-render onto the master surface.

import type { Terminal } from '@xterm/xterm'
import type { IBufferCell } from '@xterm/xterm'
import type { BlockContext } from '../../../shared/terminal-protocol'
import type { BlockGrid } from './block-store'

export interface ModelBlock {
  id: string
  command: string
  context: BlockContext | null
  startedAt: number
  durationMs: number | null
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
  grid: BlockGrid
}

/** Vertical layout of one composed block, in master-surface rows. */
export interface BlockLayout {
  id: string
  headerRow: number
  commandRow: number
  commandRows: number
  outputRow: number
  outputRows: number
  endRow: number
}

const HEADER_ROWS = 1
const BLOCK_GAP = 1

// xterm cell color-mode constants (high bits of the packed attribute cell).
const CM_16 = 16777216
const CM_256 = 33554432
const CM_RGB = 50331648

const ESC = '['

function wrapCount(text: string, cols: number): number {
  if (text.length === 0) return 1
  return Math.max(1, Math.ceil(text.length / cols))
}

/** Translate one grid row into an SGR-colored string for the master surface. */
function rowToAnsi(grid: BlockGrid, row: number): string {
  const line = grid.term.buffer.active.getLine(row)
  if (line === undefined) return ''
  const width = line.length
  let out = ''
  let fgMode = 0
  let fg = -1
  let bgMode = 0
  let bg = -1
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let inverse = false

  const reset = () => {
    out += ESC + '0m'
    fgMode = 0; fg = -1; bgMode = 0; bg = -1
    bold = dim = italic = underline = inverse = false
  }

  for (let x = 0; x < width; x += 1) {
    const cell: IBufferCell | undefined = line.getCell(x)
    if (cell === undefined) break
    const chars = cell.getChars()
    const cFgMode = cell.getFgColorMode()
    const cFg = cell.getFgColor()
    const cBgMode = cell.getBgColorMode()
    const cBg = cell.getBgColor()
    const cBold = cell.isBold() !== 0
    const cDim = cell.isDim() !== 0
    const cItalic = cell.isItalic() !== 0
    const cUnderline = cell.isUnderline() !== 0
    const cInverse = cell.isInverse() !== 0

    const changed =
      cFgMode !== fgMode || cFg !== fg || cBgMode !== bgMode || cBg !== bg ||
      cBold !== bold || cDim !== dim || cItalic !== italic ||
      cUnderline !== underline || cInverse !== inverse

    if (changed) {
      const sgr: string[] = []
      // Bold + 16-color fg in xterm means the bright variant; emit bright SGR.
      if (cBold !== bold || cDim !== dim) {
        if (cBold) sgr.push('1')
        if (cDim) sgr.push('2')
        if (!cBold && !cDim) sgr.push('22')
      }
      if (cItalic !== italic) sgr.push(cItalic ? '3' : '23')
      if (cUnderline !== underline) sgr.push(cUnderline ? '4' : '24')
      if (cInverse !== inverse) sgr.push(cInverse ? '7' : '27')
      if (cFgMode !== fgMode || cFg !== fg) {
        if (cFgMode === CM_16) {
          const base = cBold ? 90 : 30
          sgr.push(String(cFg < 8 ? base + cFg : base + (cFg % 8)))
        } else if (cFgMode === CM_256) {
          sgr.push('38;5;' + cFg)
        } else if (cFgMode === CM_RGB) {
          sgr.push('38;2;' + ((cFg >> 16) & 255) + ';' + ((cFg >> 8) & 255) + ';' + (cFg & 255))
        } else {
          sgr.push('39')
        }
      }
      if (cBgMode !== bgMode || cBg !== bg) {
        if (cBgMode === CM_16) {
          sgr.push(String(cBg < 8 ? 40 + cBg : 100 + (cBg % 8)))
        } else if (cBgMode === CM_256) {
          sgr.push('48;5;' + cBg)
        } else if (cBgMode === CM_RGB) {
          sgr.push('48;2;' + ((cBg >> 16) & 255) + ';' + ((cBg >> 8) & 255) + ';' + (cBg & 255))
        } else {
          sgr.push('49')
        }
      }
      if (sgr.length > 0) out += ESC + sgr.join(';') + 'm'
      fgMode = cFgMode; fg = cFg; bgMode = cBgMode; bg = cBg
      bold = cBold; dim = cDim; italic = cItalic; underline = cUnderline; inverse = cInverse
    }
    out += chars.length > 0 ? chars : ' '
  }
  if (fgMode !== 0 || bgMode !== 0 || bold || dim || italic || underline || inverse) reset()
  return out
}

/** Total rows one block occupies in the master surface. */
export function blockHeight(block: ModelBlock, cols: number): number {
  const commandRows = block.command.length > 0 ? wrapCount(block.command, cols) : 0
  return HEADER_ROWS + commandRows + block.grid.contentRows + BLOCK_GAP
}

/**
 * Lay out all blocks and repaint the master surface top to bottom. The canvas
 * renderer only repaints the visible viewport, so a full content rewrite is
 * acceptable; block updates bump grid versions that trigger this.
 */
export function renderBlocks(master: Terminal, blocks: ModelBlock[], cols: number): BlockLayout[] {
  const layouts: BlockLayout[] = []
  const lines: string[] = []
  let row = 0

  for (const block of blocks) {
    const headerRow = row
    lines.push('')
    row += HEADER_ROWS

    const commandRow = row
    let commandRows = 0
    if (block.command.length > 0) {
      lines.push(block.command)
      commandRows = wrapCount(block.command, cols)
      row += commandRows
    }

    const outputRow = row
    const outputRows = block.grid.contentRows
    for (let r = 0; r < outputRows; r += 1) {
      lines.push(rowToAnsi(block.grid, r))
    }
    row += outputRows

    layouts.push({ id: block.id, headerRow, commandRow, commandRows, outputRow, outputRows, endRow: row })
    lines.push('')
    row += BLOCK_GAP
  }

  master.reset()
  master.resize(cols, Math.max(row, 1))
  master.write(lines.join('\r\n'))
  return layouts
}
