// Canvas cell renderer — the Web-native equivalent of Warp's grid_renderer.
//
// Paints cell grids (headless xterm buffers used as pure data) onto a single
// <canvas>: one shared surface for the whole transcript, exactly like Warp
// blits every BlockGrid into one GPU scene. Handles palette resolution,
// bold/dim/italic/underline/inverse, wide (CJK) cells, selection highlight,
// and a blinking cursor. No xterm rendering, no per-block surfaces.

import type { IBufferCell, IBufferLine, Terminal } from '@xterm/xterm'

export interface RenderTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  /** 16 base colors: 0-7 normal, 8-15 bright. */
  palette16: string[]
}

// xterm cell color-mode constants (high bits of the packed attribute cell).
const CM_DEFAULT = 0
const CM_16 = 16777216
const CM_256 = 33554432
const CM_RGB = 50331648

/** Build the full 256-entry palette from the 16 theme colors. */
export function buildPalette(palette16: string[]): string[] {
  const out = palette16.slice(0, 16)
  const levels = [0, 95, 135, 175, 215, 255]
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        out.push('rgb(' + r + ',' + g + ',' + b + ')')
      }
    }
  }
  for (let i = 0; i < 24; i += 1) {
    const v = 8 + i * 10
    out.push('rgb(' + v + ',' + v + ',' + v + ')')
  }
  return out
}

function rgbFromPacked(v: number): string {
  return 'rgb(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ')'
}

export interface CellMetrics {
  cellWidth: number
  cellHeight: number
}

/** Measure the monospace grid for the given font. */
export function measureCells(
  ctx: CanvasRenderingContext2D,
  fontFamily: string,
  fontSize: number,
  lineHeightRatio: number,
): CellMetrics {
  ctx.font = fontSize + 'px ' + fontFamily
  const cellWidth = Math.max(1, ctx.measureText('MMMMMMMMMM').width / 10)
  const cellHeight = Math.max(1, Math.round(fontSize * lineHeightRatio))
  return { cellWidth, cellHeight }
}

/** One composed document row the painter can draw. */
export type DocRow =
  | { kind: 'blank' }
  | { kind: 'text'; text: string; bold: boolean }
  | { kind: 'cells'; term: Terminal; row: number }

export interface SelectionRange {
  /** Inclusive start, in composed doc coordinates. */
  startRow: number
  startCol: number
  /** Exclusive end. */
  endRow: number
  endCol: number
}

export interface CursorSpec {
  row: number
  col: number
  visible: boolean
}

export interface PaintOptions {
  ctx: CanvasRenderingContext2D
  theme: RenderTheme
  palette: string[]
  metrics: CellMetrics
  fontFamily: string
  fontSize: number
  /** First composed doc row visible at the top of the canvas. */
  topRow: number
  /** Vertical pixel offset of topRow within its own cell (for smooth scroll). */
  topRowOffsetPx: number
  /** How many doc rows the canvas can show. */
  visibleRows: number
  cols: number
  rows: (row: number) => DocRow | undefined
  selection: SelectionRange | null
  cursor: CursorSpec | null
}

interface StyleState {
  fg: string
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

function resolveCell(
  cell: IBufferCell,
  theme: RenderTheme,
  palette: string[],
): StyleState {
  let fgMode = cell.getFgColorMode()
  let fg = cell.getFgColor()
  let bgMode = cell.getBgColorMode()
  let bg = cell.getBgColor()
  const bold = cell.isBold() !== 0
  const dim = cell.isDim() !== 0
  // Classic xterm behavior: bold + 16-color foreground renders bright.
  if (bold && fgMode === CM_16 && fg < 8) fg += 8
  if (cell.isInverse() !== 0) {
    const tm = fgMode; const tv = fg
    fgMode = bgMode === CM_DEFAULT ? CM_DEFAULT : bgMode; fg = bg
    bgMode = tm === CM_DEFAULT ? CM_DEFAULT : tm; bg = tv
    if (fgMode === CM_DEFAULT) { fgMode = CM_16; fg = 7 } // inverse with default fg -> bg-colored text
  }
  let fgCss: string
  if (fgMode === CM_16) fgCss = palette[fg & 15]
  else if (fgMode === CM_256) fgCss = palette[fg & 255]
  else if (fgMode === CM_RGB) fgCss = rgbFromPacked(fg)
  else fgCss = theme.foreground
  let bgCss: string | null = null
  if (bgMode === CM_16) bgCss = palette[bg & 15]
  else if (bgMode === CM_256) bgCss = palette[bg & 255]
  else if (bgMode === CM_RGB) bgCss = rgbFromPacked(bg)
  return {
    fg: fgCss,
    bg: bgCss,
    bold,
    dim,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
  }
}

function selectionColsForRow(sel: SelectionRange, row: number, cols: number): [number, number] | null {
  if (row < sel.startRow || row > sel.endRow) return null
  const from = row === sel.startRow ? sel.startCol : 0
  const to = row === sel.endRow ? sel.endCol : cols
  if (to <= from) return null
  return [from, to]
}

/** Paint the visible window of the composed document onto the canvas. */
export function paintVisible(opts: PaintOptions): void {
  const { ctx, theme, palette, metrics, fontFamily, fontSize } = opts
  const { cellWidth, cellHeight } = metrics
  const canvas = ctx.canvas
  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.width / dpr
  const cssHeight = canvas.height / dpr

  ctx.save()
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, cssWidth, cssHeight)
  ctx.textBaseline = 'middle'

  for (let v = 0; v < opts.visibleRows; v += 1) {
    const row = opts.topRow + v
    const docRow = opts.rows(row)
    if (docRow === undefined) break
    const y = v * cellHeight - opts.topRowOffsetPx
    const midY = y + cellHeight / 2

    // Pass 1: selection + cell backgrounds.
    if (opts.selection !== null) {
      const sel = selectionColsForRow(opts.selection, row, opts.cols)
      if (sel !== null) {
        ctx.fillStyle = theme.selectionBackground
        ctx.globalAlpha = 0.35
        ctx.fillRect(sel[0] * cellWidth, y, (sel[1] - sel[0]) * cellWidth, cellHeight)
        ctx.globalAlpha = 1
      }
    }
    if (docRow.kind === 'cells') {
      const line: IBufferLine | undefined = docRow.term.buffer.active.getLine(docRow.row)
      if (line !== undefined) {
        for (let x = 0; x < line.length; x += 1) {
          const cell = line.getCell(x)
          if (cell === undefined) break
          const w = Math.max(1, cell.getWidth())
          const style = resolveCell(cell, theme, palette)
          if (style.bg !== null) {
            ctx.fillStyle = style.bg
            ctx.fillRect(x * cellWidth, y, w * cellWidth, cellHeight)
          }
        }
      }
    }

    // Pass 2: text, grouped into same-style runs (split at wide chars).
    if (docRow.kind === 'text') {
      ctx.font = (docRow.bold ? '600 ' : '') + fontSize + 'px ' + fontFamily
      ctx.fillStyle = theme.foreground
      ctx.fillText(docRow.text, 0, midY)
    } else if (docRow.kind === 'cells') {
      const line = docRow.term.buffer.active.getLine(docRow.row)
      if (line !== undefined) {
        // Accumulate consecutive same-style narrow cells into one fillText run.
        // Wide chars and dim/underline cells are painted immediately on their own.
        let runKey: string | null = null
        let runText = ''
        let runCol = 0
        let runCss = theme.foreground
        let runFont = fontSize + 'px ' + fontFamily
        let runAlpha = 1
        const flush = () => {
          if (runText.length === 0) return
          ctx.save()
          if (runAlpha !== 1) ctx.globalAlpha = runAlpha
          ctx.font = runFont
          ctx.fillStyle = runCss
          ctx.fillText(runText, runCol * cellWidth, midY)
          ctx.restore()
          runText = ''
        }
        for (let x = 0; x < line.length; x += 1) {
          const cell = line.getCell(x)
          if (cell === undefined) break
          const w = cell.getWidth()
          if (w === 0) continue // wide-char trailing spacer
          const chars = cell.getChars()
          const text = chars.length > 0 ? chars : ' '
          const style = resolveCell(cell, theme, palette)
          const font =
            (style.bold ? 'bold ' : '') +
            (style.italic ? 'italic ' : '') +
            fontSize + 'px ' + fontFamily
          const alpha = style.dim ? 0.6 : 1
          const key = style.fg + '|' + font + '|' + alpha
          if (key !== runKey || w === 2 || style.underline) {
            flush()
            runKey = key
            runCol = x
            runCss = style.fg
            runFont = font
            runAlpha = alpha
          }
          runText += text
          if (w === 2 || style.underline) {
            flush()
            if (style.underline) {
              ctx.fillStyle = style.fg
              ctx.fillRect(x * cellWidth, y + cellHeight - 2, w * cellWidth, 1)
            }
            runKey = null
          }
        }
        flush()
      }
    }

    // Pass 3: cursor.
    if (opts.cursor !== null && opts.cursor.visible && opts.cursor.row === row) {
      ctx.fillStyle = theme.cursor
      ctx.globalAlpha = 0.85
      ctx.fillRect(opts.cursor.col * cellWidth, y, cellWidth, cellHeight)
      ctx.globalAlpha = 1
      // Redraw the cell under the cursor in the background color.
      if (docRow.kind === 'cells') {
        const line = docRow.term.buffer.active.getLine(docRow.row)
        const cell = line === undefined ? undefined : line.getCell(opts.cursor.col)
        if (cell !== undefined && cell.getChars().length > 0) {
          ctx.font = fontSize + 'px ' + fontFamily
          ctx.fillStyle = theme.background
          ctx.fillText(cell.getChars(), opts.cursor.col * cellWidth, midY)
        }
      }
    }
  }
  ctx.restore()
}

/** Extract plain text for a selection range from the composed document. */
export function extractSelection(
  sel: SelectionRange,
  rows: (row: number) => DocRow | undefined,
  cols: number,
): string {
  const out: string[] = []
  for (let row = sel.startRow; row <= sel.endRow; row += 1) {
    const docRow = rows(row)
    if (docRow === undefined) break
    const from = row === sel.startRow ? sel.startCol : 0
    const to = row === sel.endRow ? sel.endCol : cols
    let line = ''
    if (docRow.kind === 'text') {
      line = docRow.text
    } else if (docRow.kind === 'cells') {
      const l = docRow.term.buffer.active.getLine(docRow.row)
      line = l === undefined ? '' : l.translateToString(true)
    }
    out.push(line.slice(from, to).replace(/\s+$/, ''))
  }
  return out.join('\n')
}