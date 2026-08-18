// Warp-style terminal view for DSH, aligned with the real Warp architecture.
//
// Each command block owns a lightweight headless grid (block-store.ts) — pure
// ANSI-parsed cell data, no DOM/canvas. doc-model.ts flattens every block into
// one linear document, and a single <canvas> paints the visible window via
// cell-render.ts — one shared surface, one scrollbar, one selection model.
//
// Full-screen programs (vim/less/htop) use a dedicated alternate-buffer xterm
// with raw keystroke forwarding; the canvas switches to that surface while
// active, matching Warp's AltScreen.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import type {
  BlockContext,
  ClientMessage,
  ServerMessage,
  TerminalCompletionCandidate,
} from '../../../shared/terminal-protocol'
import type { TerminalShell } from '../../../shared/config'
import { ensureWarpTerminalStyles } from './styles'
import { createBlockGrid, writeToGrid, disposeGrid, resizeGrid, type StoreOptions, type BlockGrid } from './block-store'
import { composeDoc, type DocBlock, type ComposedDoc } from './doc-model'
import { buildPalette, measureCells, paintVisible, extractSelection, type RenderTheme, type CellMetrics, type SelectionRange } from './cell-render'

ensureWarpTerminalStyles()

const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const LINE_HEIGHT = 1.2

const THEME: RenderTheme = {
  background: '#151517',
  foreground: '#e6e6e8',
  cursor: '#e6e6e8',
  selectionBackground: '#4176e6',
  palette16: [
    '#1e1e22', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
    '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
  ],
}
const PALETTE = buildPalette(THEME.palette16)

interface Block {
  id: string
  command: string
  context: BlockContext | null
  startedAt: number
  durationMs: number | null
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
}

interface CompletionMenu {
  start: number
  end: number
  candidates: TerminalCompletionCandidate[]
  selectedIndex: number
}

type CompletionIntent = 'suggest' | 'tab'

interface CompletionRequest {
  requestId: number
  input: string
  cursor: number
  intent: CompletionIntent
}

const KIND_LABEL: Record<TerminalCompletionCandidate['kind'], 'completion.command' | 'completion.file' | 'completion.directory' | 'completion.flag' | 'completion.subcommand' | 'completion.variable' | 'completion.history'> = {
  command: 'completion.command',
  file: 'completion.file',
  directory: 'completion.directory',
  flag: 'completion.flag',
  subcommand: 'completion.subcommand',
  variable: 'completion.variable',
  history: 'completion.history',
}

const MAX_HISTORY_ENTRIES = 2000

let blockCounter = 0
function newBlockId(): string {
  blockCounter += 1
  return 'b' + Date.now().toString(36) + '-' + blockCounter
}

function buildWsUrl(cwd: string | undefined, shell: TerminalShell): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams()
  if (cwd) query.set('cwd', cwd)
  if (shell !== 'auto') query.set('shell', shell)
  query.set('rows', '30')
  query.set('cols', '100')
  return proto + '//' + window.location.host + '/dsh-codex/terminal/ws?' + query.toString()
}

function displayPath(cwd: string): string {
  const home = '/Users/'
  if (cwd.startsWith(home)) {
    const rest = cwd.slice(home.length)
    const slash = rest.indexOf('/')
    if (slash !== -1) return '~' + rest.slice(slash)
  }
  return cwd
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000
  const rounded = seconds < 1 ? Math.round(seconds * 1000) / 1000 : Math.round(seconds * 100) / 100
  return '(' + rounded + 's)'
}

const ANSI_SEQUENCE = /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-2]|\x1b[=>#][0-9]?|\x1b[@-_]/g
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

/** Whether a PTY chunk carries printable text once escape sequences and control characters are ignored. */
function hasVisibleContent(text: string): boolean {
  return text.replace(ANSI_SEQUENCE, '').replace(CONTROL_CHARS, '').length > 0
}

function HeaderSegments({ block }: { block: Block }) {
  const ctx = block.context
  const nodes: ReactNode[] = []
  if (ctx !== null) {
    if (ctx.nodeVersion !== undefined) nodes.push(<span key="v" className="dsh-warp-seg-version">{ctx.nodeVersion}</span>)
    nodes.push(<span key="cwd" className="dsh-warp-seg-cwd">{displayPath(ctx.cwd)}</span>)
    if (ctx.branch !== undefined) {
      nodes.push(<span key="branch" className="dsh-warp-seg-branch">git:({ctx.branch})</span>)
      const files = ctx.files ?? 0
      const adds = ctx.adds ?? 0
      const dels = ctx.dels ?? 0
      if (files > 0 || adds > 0 || dels > 0) {
        nodes.push(
          <span key="git" className="dsh-warp-seg-git">
            <span className="dsh-warp-seg-files">{files}</span>
            {' • '}
            <span className="dsh-warp-seg-adds">+{adds}</span>{' '}
            <span className="dsh-warp-seg-dels">-{dels}</span>
          </span>,
        )
      }
    }
  }
  if (block.durationMs !== null) nodes.push(<span key="d" className="dsh-warp-seg-duration">{formatDuration(block.durationMs)}</span>)
  const out: ReactNode[] = []
  nodes.forEach((node, index) => {
    if (index > 0) out.push(' ')
    out.push(node)
  })
  return <>{out}</>
}

function contextChips(ctx: BlockContext | null): { key: string; node: ReactNode }[] {
  if (ctx === null) return []
  const chips: { key: string; node: ReactNode }[] = []
  if (ctx.nodeVersion !== undefined) chips.push({ key: 'v', node: <span className="dsh-warp-seg-version">{ctx.nodeVersion}</span> })
  chips.push({ key: 'cwd', node: <span className="dsh-warp-seg-cwd">{displayPath(ctx.cwd)}</span> })
  if (ctx.branch !== undefined) {
    chips.push({ key: 'branch', node: <span className="dsh-warp-seg-branch">{ctx.branch}</span> })
    const files = ctx.files ?? 0
    const adds = ctx.adds ?? 0
    const dels = ctx.dels ?? 0
    if (files > 0 || adds > 0 || dels > 0) {
      chips.push({
        key: 'git',
        node: (
          <>
            <span className="dsh-warp-seg-files">{files}</span>
            {' • '}
            <span className="dsh-warp-seg-adds">+{adds}</span>{' '}
            <span className="dsh-warp-seg-dels">-{dels}</span>
          </>
        ),
      })
    }
  }
  return chips
}
export interface WarpTerminalViewProps {
  sessionId: string
  cwd?: string
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  t: (key: string) => string
}

export function WarpTerminalView(props: WarpTerminalViewProps) {
  const { sessionId, cwd, terminalShell, terminalScrollback, terminalFontSize, t } = props
  const sessionCwd = cwd

  const [blocks, setBlocks] = useState<Block[]>([])
  const [draft, setDraft] = useState('')
  const [completionMenu, setCompletionMenu] = useState<CompletionMenu | null>(null)
  const [ghost, setGhost] = useState('')
  const [currentContext, setCurrentContext] = useState<BlockContext | null>(null)
  const [connState, setConnState] = useState<'connecting' | 'ready' | 'disconnected'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [reconnectToken, setReconnectToken] = useState(0)
  const [altActive, setAltActive] = useState(false)
  const [doc, setDoc] = useState<ComposedDoc | null>(null)
  const [metrics, setMetrics] = useState<CellMetrics>({ cellWidth: 8, cellHeight: 14 })
  const [scrollTop, setScrollTop] = useState(0)
  const selectionRef = useRef<SelectionRange | null>(null)
  const [cursorVisible, setCursorVisible] = useState(true)
  const terminalShellRef = useRef<TerminalShell>(terminalShell)
  const terminalScrollbackRef = useRef(terminalScrollback)
  const terminalFontSizeRef = useRef(terminalFontSize)
  const [viewHeight, setViewHeight] = useState(600)

  const wsRef = useRef<WebSocket | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef<number | null>(null)
  const historyScratchRef = useRef('')
  const completionRequestIdRef = useRef(0)
  const completionRequestRef = useRef<CompletionRequest | null>(null)
  const completionMenuRef = useRef<CompletionMenu | null>(null)
  const ghostRef = useRef('')
  const gridsRef = useRef<Map<string, BlockGrid>>(new Map())
  const altTermRef = useRef<Terminal | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const runningIdRef = useRef<string | null>(null)
  const startedAtRef = useRef<Map<string, number>>(new Map())
  const currentContextRef = useRef<BlockContext | null>(null)
  const blocksRef = useRef<Block[]>([])
  const colsRef = useRef(100)
  const altActiveRef = useRef(false)
  const docRef = useRef<ComposedDoc | null>(null)
  const metricsRef = useRef<CellMetrics>({ cellWidth: 8, cellHeight: 14 })
  const stickToBottomRef = useRef(true)
  const dragRef = useRef<{ startRow: number; startCol: number } | null>(null)
  const paintRafRef = useRef(0)
  const overlayLayerRef = useRef<HTMLDivElement | null>(null)
  const scrollTopRef = useRef(0)
  const sendResizeRef = useRef(() => {})
  const lastSentDimsRef = useRef('')
  const termcapBufferRef = useRef('')
  const oscQueryBufferRef = useRef('')
  const handleServerMessageRef = useRef((m: ServerMessage) => { void m })
  const lastSessionKeyRef = useRef('')
  const readySeenRef = useRef(false)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef(0)
  const eraseScrollbackBufRef = useRef('')
  // Clearing commands (`clear`, or ED 3 in the output stream) wipe blocks
  // whose block-end is still in flight. Count them so back-to-back clears
  // each swallow exactly one block-end instead of one boolean being consumed
  // by the first marker while the second clear's marker is still coming.
  const pendingClearsRef = useRef(0)
  // Until a clearing command's block-end arrives, its output is only echo and
  // erase sequences: drop everything for an exact `clear`, or only chunks
  // without visible text after a stream ED 3 (so `clear; ls` keeps ls output).
  const clearDropModeRef = useRef<'all' | 'blank' | null>(null)
  const editorBlockRef = useRef<HTMLDivElement | null>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  // While a real command block is in flight the editor hides (Warp shows the
  // next input only once the command finishes). Anonymous output blocks —
  // e.g. background-job output with no command of their own — keep it visible.
  const runningBlock = runningId === null ? undefined : blocks.find((block) => block.id === runningId)
  const editorHidden = altActive || (runningBlock !== undefined && runningBlock.command !== '')
  const editorWasHiddenRef = useRef(false)

  blocksRef.current = blocks
  draftRef.current = draft
  ghostRef.current = ghost
  completionMenuRef.current = completionMenu
  docRef.current = doc
  metricsRef.current = metrics
  altActiveRef.current = altActive
  terminalShellRef.current = terminalShell
  terminalScrollbackRef.current = terminalScrollback
  terminalFontSizeRef.current = terminalFontSize

  const storeOpts = (): StoreOptions => ({ cols: colsRef.current, scrollback: terminalScrollbackRef.current })

  // Tell the host the real panel dimensions so the PTY (and full-screen
  // programs like vim) lay out to what we actually render, not the spawn-time
  // placeholder. Sent on ready and whenever the panel is measured again.
  const sendResize = useCallback(() => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const scrollEl = scrollRef.current
    const m = metricsRef.current
    // Single source of truth: render with colsRef (measure's value), and tell
    // the PTY the SAME cols, so vim's layout matches exactly what we paint.
    const cols = Math.max(20, colsRef.current)
    const rows = Math.max(5, Math.floor((scrollEl ? scrollEl.clientHeight : 600) / m.cellHeight))
    const key = cols + 'x' + rows
    if (lastSentDimsRef.current === key) return
    lastSentDimsRef.current = key
    const message: ClientMessage = { type: 'resize', cols, rows }
    ws.send(JSON.stringify(message))
  }, [])
  sendResizeRef.current = sendResize

  // Forward terminal query answers (cursor position, device attributes, ...)
  // from any grid back to the PTY. Bound at grid creation so the very first
  // query a full-screen program sends is answered before it can block.
  const forwardQueryResponse = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = { type: 'input', data }
    ws.send(JSON.stringify(message))
  }, [])

  const newGrid = useCallback((id: string): BlockGrid => {
    return createBlockGrid(id, { cols: colsRef.current, scrollback: terminalScrollbackRef.current }, forwardQueryResponse)
  }, [forwardQueryResponse])

  const rebuildDoc = useCallback(() => {
    const model: DocBlock[] = blocksRef.current.map((block) => {
      let grid = gridsRef.current.get(block.id)
      if (grid === undefined) {
        grid = newGrid(block.id)
        gridsRef.current.set(block.id, grid)
      }
      return { ...block, grid }
    })
    setDoc(composeDoc(model, colsRef.current))
  }, [])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const d = docRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const m = metricsRef.current
    const dpr = window.devicePixelRatio || 1
    const cssWidth = scrollRef.current ? scrollRef.current.clientWidth : canvas.clientWidth
    const cssHeight = scrollRef.current ? scrollRef.current.clientHeight : canvas.clientHeight
    if (cssWidth <= 0 || cssHeight <= 0) return
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const visibleRows = Math.ceil(cssHeight / m.cellHeight) + 1
    const st = scrollRef.current ? scrollRef.current.scrollTop : 0
    const topRow = Math.floor(st / m.cellHeight)
    const topRowOffsetPx = st % m.cellHeight

    if (altActiveRef.current && altTermRef.current !== null) {
      const term = altTermRef.current
      paintVisible({
        ctx, theme: THEME, palette: PALETTE, metrics: m, fontFamily: FONT_STACK, fontSize: terminalFontSizeRef.current,
        topRow: 0, topRowOffsetPx: 0, visibleRows, cols: colsRef.current,
        rows: (row) => (row < term.rows ? { kind: 'cells', term, row } : undefined),
        selection: null,
        cursor: { row: term.buffer.active.cursorY, col: term.buffer.active.cursorX, visible: cursorVisible },
      })
      return
    }

    if (d === null) return
    paintVisible({
      ctx, theme: THEME, palette: PALETTE, metrics: m, fontFamily: FONT_STACK, fontSize: terminalFontSizeRef.current,
      topRow, topRowOffsetPx, visibleRows, cols: colsRef.current,
      rows: d.rowAt,
      selection: selectionRef.current,
      cursor: null,
    })
  }, [cursorVisible, terminalFontSize])

  const schedulePaint = useCallback(() => {
    cancelAnimationFrame(paintRafRef.current)
    paintRafRef.current = requestAnimationFrame(() => {
      // Sync the overlay layer in the SAME frame as the canvas repaint so the
      // status rows and the painted content never drift by a frame (the drift
      // is what made headers wobble while scrolling).
      const layer = overlayLayerRef.current
      if (layer !== null) layer.style.transform = 'translateY(' + (-scrollTopRef.current) + 'px)'
      paint()
    })
  }, [paint])
  // xterm.js answers cursor-position / device-attribute queries but NOT
  // XTGETTCAP (DCS +q termcap queries). vim 9.1 issues those at startup; with
  // no answer it assumes a dumb terminal and stops echoing typed characters.
  // Intercept the queries in the PTY stream and answer with xterm values.
  const XTGETTCAP_ANSWERS: Record<string, string> = {
    '436f': '323536',   // Co -> 256 colors
    '6b75': '1b4f41',   // ku -> ESC O A (up)
    '6b64': '1b4f42',   // kd -> ESC O B (down)
    '6b72': '1b4f43',   // kr -> ESC O C (right)
    '6b6c': '1b4f44',       // kl -> ESC O D (left)
    '2332': '1b5b313b3248', // #2 -> ESC [ 1 ; 2 H
    '2334': '1b5b313b3244', // #4 -> ESC [ 1 ; 2 D
    '2569': '1b5b313b3243', // %i -> ESC [ 1 ; 2 C
    '6b34': '1b4f53',       // k4 -> ESC O S
    '6b35': '1b5b31357e',   // k5 -> ESC [ 1 5 ~
    '6b32': '1b4f51',       // k2 -> ESC O Q
    '6b33': '1b4f52',       // k3 -> ESC O R
    '6b36': '1b5b31377e',   // k6 -> ESC [ 1 7 ~
    '2a37': '1b5b313b3246', // *7 -> ESC [ 1 ; 2 F
    '4631': '1b5b32337e',   // F1 -> ESC [ 2 3 ~
    '4632': '1b5b32347e',   // F2 -> ESC [ 2 4 ~
  }
  const answerTermcapQueries = (text: string): void => {
    const DCSQ = '\x1bP+q'
    const ST = '\x1b\\'
    const pending = termcapBufferRef.current + text
    let idx = 0

    for (;;) {
      const start = pending.indexOf(DCSQ, idx)
      if (start === -1) {
        // Preserve only a suffix which could start DCSQ. PTY chunks routinely
        // split ESC P + q across WebSocket message boundaries.
        termcapBufferRef.current = ''
        const max = Math.min(DCSQ.length - 1, pending.length)
        for (let len = max; len > 0; len -= 1) {
          const suffix = pending.slice(pending.length - len)
          if (DCSQ.startsWith(suffix)) {
            termcapBufferRef.current = suffix
            break
          }
        }
        return
      }

      const end = pending.indexOf(ST, start + DCSQ.length)
      const nextStart = pending.indexOf(DCSQ, start + DCSQ.length)
      if (nextStart !== -1 && (end === -1 || nextStart < end)) {
        // A stale partial prefix can be followed by a fresh query in the next
        // PTY chunk. Restart at the newer DCS instead of swallowing both.
        idx = nextStart
        continue
      }
      if (end === -1) {
        termcapBufferRef.current = pending.slice(start)
        return
      }

      const hexQuery = pending.slice(start + DCSQ.length, end).toLowerCase()
      if (!/^[0-9a-f]+$/.test(hexQuery)) {
        idx = end + ST.length
        continue
      }
      const valueHex = XTGETTCAP_ANSWERS[hexQuery]
      const payload = valueHex === undefined
        ? '\x1bP0+r' + hexQuery + ST
        : '\x1bP1+r' + hexQuery + '=' + valueHex + ST
      const ws = wsRef.current
      const open = ws !== null && ws.readyState === WebSocket.OPEN
      if (open) {
        const message: ClientMessage = { type: 'input', data: payload }
        ws.send(JSON.stringify(message))
      }
      idx = end + ST.length
    }
  }
  // Vim also queries foreground/background colors through OSC 10/11. A
  // headless xterm has no DOM renderer, so it does not answer those queries;
  // reply directly or Vim can remain in its terminal-capability wait state.
  const answerOscQueries = (text: string): void => {
    const BEL = '\x07'
    const ST = '\x1b\\'
    const queries = [
      { token: '\x1b]10;?' + BEL, reply: '\x1b]10;rgb:e6e6/e6e6/e8e8' + ST },
      { token: '\x1b]11;?' + BEL, reply: '\x1b]11;rgb:1515/1515/1717' + ST },
      { token: '\x1b]12;?' + BEL, reply: '\x1b]12;rgb:e6e6/e6e6/e8e8' + ST },
      { token: '\x1b]10;?' + ST, reply: '\x1b]10;rgb:e6e6/e6e6/e8e8' + ST },
      { token: '\x1b]11;?' + ST, reply: '\x1b]11;rgb:1515/1515/1717' + ST },
      { token: '\x1b]12;?' + ST, reply: '\x1b]12;rgb:e6e6/e6e6/e8e8' + ST },
    ]
    let pending = oscQueryBufferRef.current + text
    for (;;) {
      let hit: { index: number; token: string; reply: string } | null = null
      for (const query of queries) {
        const index = pending.indexOf(query.token)
        if (index !== -1 && (hit === null || index < hit.index)) hit = { index, ...query }
      }
      if (hit === null) break
      const ws = wsRef.current
      const open = ws !== null && ws.readyState === WebSocket.OPEN
      if (open) ws.send(JSON.stringify({ type: 'input', data: hit.reply } satisfies ClientMessage))
      pending = pending.slice(hit.index + hit.token.length)
    }
    oscQueryBufferRef.current = ''
    const max = Math.max(...queries.map((query) => query.token.length)) - 1
    for (let len = Math.min(max, pending.length); len > 0; len -= 1) {
      const suffix = pending.slice(pending.length - len)
      if (queries.some((query) => query.token.startsWith(suffix))) {
        oscQueryBufferRef.current = suffix
        break
      }
    }
  }
  // `clear` must wipe the whole transcript, not just the running block's
  // grid: in the block model the "scrollback" IS the earlier blocks. Two
  // entry points share this reset — the runDraft command check (covers
  // terminfo entries whose clear is only H+ED2) and the ED 3 interception
  // below (covers tput/printf and modern ncurses clear, which appends 3J).
  const clearTranscript = useCallback(() => {
    const running = runningIdRef.current
    // A command block is in flight when its command text is set; a prompt
    // block (anonymous, command '') has no block-end coming.
    const inFlight = running !== null
      && (blocksRef.current.find((block) => block.id === running)?.command ?? '') !== ''
    for (const grid of gridsRef.current.values()) disposeGrid(grid)
    gridsRef.current.clear()
    startedAtRef.current.clear()
    blocksRef.current = []
    setBlocks([])
    selectionRef.current = null
    runningIdRef.current = null
    setRunningId(null)
    // The in-flight command's block no longer exists: swallow its block-end,
    // and drop its remaining output (echo, erase sequences) instead of
    // collecting it into a leftover anonymous block with a header.
    if (inFlight) {
      pendingClearsRef.current += 1
      if (clearDropModeRef.current !== 'all') clearDropModeRef.current = 'blank'
    }
    eraseScrollbackBufRef.current = ''
    stickToBottomRef.current = true
    rebuildDoc()
    schedulePaint()
  }, [rebuildDoc, schedulePaint])

  const appendOutput = useCallback((text: string) => {
    answerTermcapQueries(text)
    answerOscQueries(text)
    if (altActiveRef.current && altTermRef.current !== null) {
      const term = altTermRef.current
      term.write(text, () => {
        if (term.buffer.active.type !== 'alternate') {
          altTermRef.current = null
          setAltActive(false)
          schedulePaint()
          return
        }
        schedulePaint()
      })
      return
    }

    // An exact `clear` command's whole output burst is echo + erase sequences.
    if (clearDropModeRef.current === 'all') return
    let pending = eraseScrollbackBufRef.current + text
    eraseScrollbackBufRef.current = ''
    const eraseIndex = pending.lastIndexOf('\x1b[3J')
    if (eraseIndex !== -1) {
      // ED 3 erases the scrollback — which in the block model IS the earlier
      // blocks. Bytes before it belonged to blocks that no longer exist; only
      // the tail can be new content (e.g. ls output in `clear; ls`). ED 2 is
      // deliberately left through: full-screen redrawers like watch rely on
      // it for in-place repaints.
      clearTranscript()
      pending = pending.slice(eraseIndex + '\x1b[3J'.length)
    }
    // A trailing partial prefix is held for the next chunk, since PTY writes
    // can split the sequence anywhere.
    for (const prefix of ['\x1b[3', '\x1b[', '\x1b']) {
      if (pending.endsWith(prefix)) {
        eraseScrollbackBufRef.current = prefix
        pending = pending.slice(0, -prefix.length)
        break
      }
    }
    if (pending.length === 0) return
    if (clearDropModeRef.current === 'blank' && !hasVisibleContent(pending)) return
    const output = pending

    let targetId = runningIdRef.current
    if (targetId === null) {
      targetId = newBlockId()
      const block: Block = {
        id: targetId,
        command: '',
        context: currentContextRef.current,
        startedAt: Date.now(),
        durationMs: null,
        status: 'running',
        exitCode: null,
      }
      setBlocks((prev) => [...prev, block])
      runningIdRef.current = targetId
      setRunningId(targetId)
    }
    let grid = gridsRef.current.get(targetId)
    if (grid === undefined) {
      grid = newGrid(targetId)
      gridsRef.current.set(targetId, grid)
    }
    // write() is async — detect the alt screen only after it completes,
    // otherwise the buffer type is still 'normal' and vim/less never register.
    writeToGrid(grid, output, storeOpts(), () => {
      const bufType = grid.term.buffer.active.type
      if (bufType === 'alternate' && !altActiveRef.current) {
        altTermRef.current = grid.term
        // (Query answers are already wired: newGrid bound term.onData at
        // creation, so vim's startup queries were answered before we even
        // detected the alt screen here.)
        // The output grid grew to fit streamed lines (only ~contentRows+8).
        // A full-screen program needs the real viewport height, so resize the
        // terminal to fill the panel before handing it the surface.
        const vpH = scrollRef.current ? scrollRef.current.clientHeight : 600
        const rows = Math.max(5, Math.floor(vpH / metricsRef.current.cellHeight))
        try { grid.term.resize(colsRef.current, rows) } catch { /* ignore */ }
        setAltActive(true)
      }
      rebuildDoc()
      schedulePaint()
    })
  }, [rebuildDoc, schedulePaint, clearTranscript])

  const setDraftWithCaret = useCallback((value: string, caret: number, focus = false) => {
    draftRef.current = value
    setDraft(value)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea === null) return
      if (focus) textarea.focus()
      if (focus || document.activeElement === textarea) textarea.setSelectionRange(caret, caret)
    })
  }, [])

  const refreshHistoryGhost = useCallback((input: string) => {
    const hint = historyGhost(historyRef.current, input)
    setGhost(hint ?? '')
  }, [])

  const requestCompletion = useCallback((cursor: number, intent: CompletionIntent) => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    if (runningIdRef.current !== null || altActiveRef.current) return
    const input = draftRef.current
    if (intent === 'suggest') {
      refreshHistoryGhost(input)
      return
    }
    const requestId = completionRequestIdRef.current + 1
    completionRequestIdRef.current = requestId
    completionRequestRef.current = { requestId, input, cursor, intent }
    const message: ClientMessage = { type: 'complete', requestId, input, cursor }
    ws.send(JSON.stringify(message))
  }, [refreshHistoryGhost])

  const acceptGhost = useCallback(() => {
    const hint = ghostRef.current
    if (hint.length === 0) return false
    const next = draftRef.current + hint
    setDraftWithCaret(next, next.length, true)
    setGhost('')
    setCompletionMenu(null)
    completionRequestRef.current = null
    return true
  }, [setDraftWithCaret])

  const acceptGhostWord = useCallback(() => {
    const hint = ghostRef.current
    if (hint.length === 0) return false
    const chunk = hint.match(/^\s*\S+/)?.[0] ?? hint
    const next = draftRef.current + chunk
    setDraftWithCaret(next, next.length, true)
    setGhost(hint.slice(chunk.length))
    return true
  }, [setDraftWithCaret])

  const applyCompletionCandidate = useCallback((index: number) => {
    const menu = completionMenu
    if (menu === null) return
    const candidate = menu.candidates[index]
    if (candidate === undefined) return
    const current = draftRef.current
    const next = current.slice(0, menu.start) + candidate.replacement + current.slice(menu.end)
    setDraftWithCaret(next, menu.start + candidate.replacement.length, true)
    completionRequestRef.current = null
    setCompletionMenu(null)
    refreshHistoryGhost(next)
  }, [completionMenu, refreshHistoryGhost, setDraftWithCaret])

  const openHistoryMenu = useCallback((input: string) => {
    const matches = historyPrefixMatches(historyRef.current, input)
    if (matches.length === 0) return false
    setCompletionMenu({
      start: 0,
      end: input.length,
      selectedIndex: 0,
      candidates: matches.map((command) => ({
        label: command,
        replacement: command,
        kind: 'history',
      })),
    })
    const firstLonger = matches.find((command) => command.length > input.length)
    setGhost(firstLonger === undefined ? '' : firstLonger.slice(input.length))
    return true
  }, [])

  const navigateHistory = useCallback((direction: -1 | 1) => {
    const history = historyRef.current
    if (history.length === 0) return
    let index = historyIndexRef.current
    if (direction < 0) {
      if (index === null) {
        historyScratchRef.current = draftRef.current
        index = history.length - 1
      } else {
        index = Math.max(0, index - 1)
      }
    } else {
      if (index === null) return
      if (index >= history.length - 1) {
        historyIndexRef.current = null
        setCompletionMenu(null)
        setGhost('')
        completionRequestRef.current = null
        setDraftWithCaret(historyScratchRef.current, historyScratchRef.current.length)
        return
      }
      index += 1
    }
    historyIndexRef.current = index
    const value = history[index]
    setCompletionMenu(null)
    setGhost('')
    completionRequestRef.current = null
    setDraftWithCaret(value, value.length)
  }, [setDraftWithCaret])

  const completeRunning = useCallback((exitCode: number) => {
    if (pendingClearsRef.current > 0) {
      pendingClearsRef.current -= 1
      if (pendingClearsRef.current === 0) clearDropModeRef.current = null
      eraseScrollbackBufRef.current = ''
      // A pure clear leaves no block to complete. A `clear; ls` style command
      // may have accumulated post-clear output in a fresh block, which then
      // inherits the cleared command's block-end.
      if (runningIdRef.current === null) return
    }
    const targetId = runningIdRef.current
    if (targetId === null) return
    const startedAt = startedAtRef.current.get(targetId)
    const durationMs = startedAt === undefined ? null : Date.now() - startedAt
    const status: Block['status'] = exitCode === 0 ? 'completed' : 'failed'
    setBlocks((prev) => prev.map((block) => (block.id === targetId ? { ...block, status, exitCode, durationMs } : block)))
    runningIdRef.current = null
    setRunningId(null)
    rebuildDoc()
    schedulePaint()
  }, [rebuildDoc, schedulePaint])

  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'ready':
        readySeenRef.current = true
        retryCountRef.current = 0
        setConnState('ready')
        setError(null)
        requestAnimationFrame(() => sendResizeRef.current())
        break
      case 'context':
        currentContextRef.current = message.context
        setCurrentContext(message.context)
        break
      case 'history': {
        historyRef.current = mergeHistory(message.commands, historyRef.current)
        refreshHistoryGhost(draftRef.current)
        break
      }
      case 'completion': {
        const request = completionRequestRef.current
        if (request === null || request.requestId !== message.requestId || draftRef.current !== request.input) break
        completionRequestRef.current = null
        const start = Math.max(0, Math.min(draftRef.current.length, message.start))
        const end = Math.max(start, Math.min(draftRef.current.length, message.end))
        if (request.intent === 'suggest') {
          refreshHistoryGhost(draftRef.current)
          break
        }
        if (message.candidates.length === 0) {
          setCompletionMenu(null)
          refreshHistoryGhost(draftRef.current)
          break
        }
        const currentToken = draftRef.current.slice(start, end)
        const next = draftRef.current.slice(0, start) + message.replacement + draftRef.current.slice(end)
        if (message.candidates.length === 1) {
          setDraftWithCaret(next, start + message.replacement.length)
          setCompletionMenu(null)
          refreshHistoryGhost(next)
          break
        }
        if (message.replacement.length > currentToken.length) {
          setDraftWithCaret(next, start + message.replacement.length)
          setCompletionMenu({
            start,
            end: start + message.replacement.length,
            candidates: message.candidates,
            selectedIndex: 0,
          })
        } else {
          setCompletionMenu({ start, end, candidates: message.candidates, selectedIndex: 0 })
        }
        setGhost('')
        break
      }
      case 'output':
        appendOutput(message.text)
        break
      case 'block-end':
        completeRunning(message.exitCode)
        break
      case 'exit': {
        const targetId = runningIdRef.current
        if (targetId !== null) {
          const status: Block['status'] = message.exitCode === 0 ? 'completed' : 'killed'
          setBlocks((prev) => prev.map((block) => (block.id === targetId ? { ...block, status, exitCode: message.exitCode ?? block.exitCode } : block)))
          runningIdRef.current = null
          setRunningId(null)
        }
        setConnState('disconnected')
        break
      }
      case 'error':
        setError(message.message)
        setConnState('disconnected')
        break
    }
  }, [appendOutput, completeRunning, refreshHistoryGhost, setDraftWithCaret])

  // Stabilize the WS handler: it transitively depends on cursorVisible (blink),
  // which would otherwise reconnect the socket every 530ms and kill the PTY.
  handleServerMessageRef.current = handleServerMessage

  useEffect(() => {
    const canvas = canvasRef.current
    const scrollEl = scrollRef.current
    if (canvas === null || scrollEl === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const measure = () => {
      // Hidden keep-alive panes report zero dimensions. Preserve their last
      // grid/PTY size until the pane becomes visible again.
      const vpHeight = scrollEl.clientHeight
      const vpWidth = scrollEl.clientWidth
      if (vpHeight <= 0 || vpWidth <= 0) return
      const m = measureCells(ctx, FONT_STACK, terminalFontSizeRef.current, LINE_HEIGHT)
      metricsRef.current = m
      setMetrics(m)
      // The viewport height comes from the scroll container (a stable,
      // flex-determined size), NOT from the canvas — the canvas height is set
      // from viewHeight, so reading it back here would create a feedback loop
      // that collapses the visible area.
      setViewHeight(vpHeight)
      const cols = Math.max(20, Math.floor(vpWidth / m.cellWidth))
      if (cols !== colsRef.current) {
        colsRef.current = cols
        for (const grid of gridsRef.current.values()) resizeGrid(grid, cols)
        if (altTermRef.current !== null) {
          try { altTermRef.current.resize(cols, Math.max(5, Math.floor(vpHeight / m.cellHeight))) } catch { /* ignore */ }
        }
      }
      rebuildDoc()
      schedulePaint()
      sendResizeRef.current()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollEl)
    return () => observer.disconnect()
  }, [rebuildDoc, schedulePaint, terminalFontSize])

  useEffect(() => {
    if (!altActive) return
    const id = window.setInterval(() => setCursorVisible((v) => !v), 530)
    return () => window.clearInterval(id)
  }, [altActive])

  useEffect(() => {
    if (altActive) schedulePaint()
  }, [cursorVisible, altActive, schedulePaint])

  // cwd only seeds a newly mounted session. A later cwd update reflects the
  // shell already running in that PTY and must not reconnect it.
  useEffect(() => {
    setConnState('connecting')
    setError(null)
    setRunningId(null)
    runningIdRef.current = null
    startedAtRef.current.clear()
    eraseScrollbackBufRef.current = ''
    pendingClearsRef.current = 0
    clearDropModeRef.current = null
    window.clearTimeout(retryTimerRef.current)
    const sessionKey = sessionId
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey
      readySeenRef.current = false
      retryCountRef.current = 0
    }
    let disposed = false
    const ws = new WebSocket(buildWsUrl(sessionCwd, terminalShellRef.current))
    wsRef.current = ws
    ws.onmessage = (event) => {
      if (disposed) return
      try {
        handleServerMessageRef.current(JSON.parse(String(event.data)) as ServerMessage)
      } catch (parseError) {
        console.warn('[warp-terminal] dropped malformed host message', parseError)
      }
    }
    ws.onclose = () => {
      if (disposed) return
      setConnState('disconnected')
      setRunningId(null)
      runningIdRef.current = null
      // Intermittent host spawn failures (e.g. macOS node-pty 'posix_spawnp
      // failed') recover on retry. If we never reached 'ready', auto-reconnect
      // with backoff instead of leaving the panel dead until a manual click.
      if (!readySeenRef.current && retryCountRef.current < 3) {
        const attempt = retryCountRef.current
        retryCountRef.current = attempt + 1
        const delay = 400 * Math.pow(2, attempt)
        retryTimerRef.current = window.setTimeout(() => {
          if (!disposed) setReconnectToken((token) => token + 1)
        }, delay)
      }
    }
    ws.onerror = () => { ws.close() }
    return () => {
      disposed = true
      window.clearTimeout(retryTimerRef.current)
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      ws.close()
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [sessionId, reconnectToken])
  const runDraft = useCallback(() => {
    const command = draft
    if (command.trim().length === 0) return
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const running = runningIdRef.current
    if (running !== null) {
      setBlocks((prev) => prev.map((block) => (block.id === running ? { ...block, command: block.command + '\n' + command } : block)))
      draftRef.current = ''
      setDraft('')
      setCompletionMenu(null)
      setGhost('')
      completionRequestRef.current = null
      const message: ClientMessage = { type: 'input', data: command + '\n' }
      ws.send(JSON.stringify(message))
      rebuildDoc()
      schedulePaint()
      return
    }
    const history = historyRef.current
    if (history[history.length - 1] !== command) history.push(command)
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.splice(0, history.length - MAX_HISTORY_ENTRIES)
    }
    historyIndexRef.current = null
    historyScratchRef.current = ''
    setCompletionMenu(null)
    setGhost('')
    completionRequestRef.current = null
    // `clear` leaves no block of its own: the transcript resets, and the
    // command's whole output burst (echo + erase sequences) plus the
    // block-end it still produces are swallowed. Covers terminfo entries
    // whose clear is only H+ED2 (no ED 3 for the stream interception).
    if (command.trim() === 'clear') {
      clearTranscript()
      pendingClearsRef.current += 1
      clearDropModeRef.current = 'all'
    } else {
      // A stale pending clear (a lost block-end) must not eat this command's
      // output or its block-end.
      pendingClearsRef.current = 0
      clearDropModeRef.current = null
      const id = newBlockId()
      startedAtRef.current.set(id, Date.now())
      const block: Block = {
        id,
        command,
        context: currentContextRef.current,
        startedAt: Date.now(),
        durationMs: null,
        status: 'running',
        exitCode: null,
      }
      setBlocks((prev) => [...prev, block])
      gridsRef.current.set(id, newGrid(id))
      runningIdRef.current = id
      setRunningId(id)
    }
    draftRef.current = ''
    setDraft('')
    const message: ClientMessage = { type: 'input', data: command + '\n' }
    ws.send(JSON.stringify(message))
    rebuildDoc()
    schedulePaint()
  }, [draft, rebuildDoc, schedulePaint, clearTranscript])

  const killRunning = useCallback(() => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = { type: 'signal', signal: 'SIGINT' }
    ws.send(JSON.stringify(message))
  }, [])

  const rerun = useCallback((command: string) => setDraft(command), [])
  const copyCommand = useCallback(async (command: string) => {
    try { await navigator.clipboard.writeText(command) } catch { /* clipboard unavailable */ }
  }, [])

  // Full-screen programs (vim/less/htop) need raw keystrokes. Listen globally
  // while the alt screen is active — the canvas never holds keyboard focus (the
  // command textarea does), so a canvas onKeyDown would never fire.
  useEffect(() => {
    if (!altActive) return
    const onKey = (event: KeyboardEvent) => {
      const ws = wsRef.current
      const open = ws !== null && ws.readyState === WebSocket.OPEN
      const data = keyToBytes(event)
      if (!open) return
      if (data === null) return
      event.preventDefault()
      event.stopPropagation()
      const message: ClientMessage = { type: 'input', data }
      ws.send(JSON.stringify(message))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [altActive])

  // While the editor is hidden (command running), keystrokes land on the
  // focused scroll surface and go straight to the PTY, like a normal
  // terminal — so interactive commands (read, sudo, ssh) still get stdin.
  // Cmd/Ctrl+C with an active selection stays "copy", not SIGINT.
  const onScrollKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (altActiveRef.current || runningIdRef.current === null) return
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && key === 'c' && selectionRef.current !== null) return
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const data = keyToBytes(event.nativeEvent)
    if (data === null) return
    event.preventDefault()
    const message: ClientMessage = { type: 'input', data }
    ws.send(JSON.stringify(message))
  }, [])

  // Paste with the editor hidden targets the scroll surface (never an
  // editable element), so forward the clipboard text as stdin here.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (runningIdRef.current === null || altActiveRef.current) return
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (text.length === 0) return
      const ws = wsRef.current
      if (ws === null || ws.readyState !== WebSocket.OPEN) return
      event.preventDefault()
      const message: ClientMessage = { type: 'input', data: text }
      ws.send(JSON.stringify(message))
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const pointToCell = useCallback((clientX: number, clientY: number): { row: number; col: number } => {
    const canvas = canvasRef.current
    const m = metricsRef.current
    const rect = canvas === null ? { left: 0, top: 0 } : canvas.getBoundingClientRect()
    const scroll = scrollRef.current ? scrollRef.current.scrollTop : 0
    const col = Math.max(0, Math.floor((clientX - rect.left) / m.cellWidth))
    const row = Math.max(0, Math.floor((clientY - rect.top + scroll) / m.cellHeight))
    return { row, col }
  }, [])

  const onMouseDown = useCallback((event: ReactMouseEvent) => {
    if (altActiveRef.current) return
    if (event.button !== 0) return
    const cell = pointToCell(event.clientX, event.clientY)
    dragRef.current = { startRow: cell.row, startCol: cell.col }
    selectionRef.current = null
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (d === null) return
      const cur = pointToCell(ev.clientX, ev.clientY)
      const a = { row: d.startRow, col: d.startCol }
      const b = cur
      const forward = b.row > a.row || (b.row === a.row && b.col >= a.col)
      const s = forward ? a : b
      const e = forward ? b : a
      // Drive the highlight straight off the ref + a single paint per frame.
      // No React state churn on every mousemove (that was the flicker).
      selectionRef.current = { startRow: s.row, startCol: s.col, endRow: e.row, endCol: e.col }
      schedulePaint()
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      schedulePaint()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pointToCell, schedulePaint])

  const copySelection = useCallback(async (): Promise<boolean> => {
    const d = docRef.current
    const sel = selectionRef.current
    if (d === null || sel === null) return false
    const text = extractSelection(sel, d.rowAt, colsRef.current)
    if (text.length === 0) return false
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
    return true
  }, [])

  // Copy on Cmd/Ctrl+C when there is a selection (then clear it). Without a
  // selection the key falls through so Ctrl+C still reaches a running command.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        if (selectionRef.current === null) return
        event.preventDefault()
        void copySelection().then(() => {
          selectionRef.current = null
          schedulePaint()
        })
      } else if (event.key === 'Escape' && selectionRef.current !== null) {
        selectionRef.current = null
        schedulePaint()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copySelection, schedulePaint])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === null) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    scrollTopRef.current = el.scrollTop
    setScrollTop(el.scrollTop)
    schedulePaint()
  }, [schedulePaint])

  // The editor rides the document as its last block, so its height is part of
  // the scrollable extent. Measured (not computed from draftRows) because the
  // chips row wraps and the textarea caps at 8 rows. Hidden while a command
  // runs — then it contributes nothing.
  useEffect(() => {
    const el = editorBlockRef.current
    if (el === null) {
      setEditorHeight(0)
      return
    }
    const update = () => setEditorHeight(el.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [editorHidden])

  // Focus follows the editor: while it is hidden the scroll surface receives
  // keystrokes (forwarded to the PTY); when the command finishes and the
  // editor returns, focus moves back so typing resumes immediately.
  useEffect(() => {
    if (editorHidden) {
      editorWasHiddenRef.current = true
      scrollRef.current?.focus()
      return
    }
    if (!editorWasHiddenRef.current) return
    editorWasHiddenRef.current = false
    textareaRef.current?.focus()
  }, [editorHidden])

  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [doc, blocks.length, editorHeight])

  const draftRows = Math.min(8, Math.max(1, draft.split('\n').length))
  const chips = contextChips(currentContext)

  const totalHeight = (doc?.totalRows ?? 0) * metrics.cellHeight
  const rangeById = new Map((doc?.ranges ?? []).map((r) => [r.id, r]))
  const viewportTop = scrollTop
  const viewportBottom = scrollTop + viewHeight
  // The editor's on-screen position decides the completion menu's direction:
  // downward while the editor sits high, upward once it nears the bottom edge.
  // Computed at render (not in an effect) so the menu never flashes open in
  // the wrong direction for a frame.
  const menuUp = (() => {
    if (completionMenu === null) return false
    const block = editorBlockRef.current
    const scroll = scrollRef.current
    if (block === null || scroll === null) return false
    return block.getBoundingClientRect().bottom + 200 > scroll.getBoundingClientRect().bottom
  })()
  return (
    <div className="dsh-warp-terminal">
      {connState === 'disconnected' && (
        <div className="dsh-warp-terminal-banner">
          <span className="dsh-warp-terminal-error">{error ?? t('status.disconnected')}</span>
          <button type="button" className="dsh-warp-terminal-reconnect" onClick={() => { readySeenRef.current = false; retryCountRef.current = 0; setReconnectToken((token) => token + 1) }}>
            {t('reconnect')}
          </button>
        </div>
      )}

      <div className="dsh-warp-terminal-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={-1} onKeyDown={onScrollKeyDown}>
        <div className="dsh-warp-terminal-doc" style={{ height: totalHeight + editorHeight }}>
          <div className="dsh-warp-terminal-viewport" style={{ height: viewHeight }}>
            <canvas
              ref={canvasRef}
              className="dsh-warp-canvas"
              onMouseDown={onMouseDown}
            />

            <div className="dsh-warp-overlay-layer" ref={overlayLayerRef}>
            {!altActive && blocks.map((block) => {
              const range = rangeById.get(block.id)
              if (range === undefined) return null
              // Overlays use document coordinates; the layer itself is shifted
              // by -scrollTop (transform) in the same frame as the canvas.
              const top = range.headerRow * metrics.cellHeight
              const height = Math.max(metrics.cellHeight, (range.endRow - range.headerRow) * metrics.cellHeight)
              if (top + height < scrollTop - 200 || top > scrollTop + viewHeight + 200) return null
              const isRunning = block.status === 'running'
              const hasHeader = block.context !== null || block.durationMs !== null
              return (
                <div
                  key={block.id}
                  className={[
                    'dsh-warp-block-overlay',
                    isRunning ? 'dsh-warp-block-running' : '',
                    block.status === 'failed' ? 'dsh-warp-block-failed' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ top, height }}
                >
                <div className="dsh-warp-block-chrome">
                  {hasHeader && (
                    <div className="dsh-warp-terminal-prompt-line">
                      <HeaderSegments block={block} />
                    </div>
                  )}
                  <div className="dsh-warp-terminal-block-actions">
                    <button type="button" className="dsh-warp-terminal-iconbtn" title={t('block.copy')} aria-label={t('block.copy')} onClick={() => void copyCommand(block.command)}>⧉</button>
                    <button type="button" className="dsh-warp-terminal-iconbtn" title={t('block.rerun')} aria-label={t('block.rerun')} onClick={() => rerun(block.command)}>↻</button>
                    {isRunning && (
                      <button type="button" className="dsh-warp-terminal-iconbtn dsh-warp-terminal-iconbtn-kill" title={t('editor.kill')} aria-label={t('editor.kill')} onClick={killRunning}>■</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
            </div>
          </div>

      {!editorHidden && (
      <div
        ref={editorBlockRef}
        className="dsh-warp-terminal-block dsh-warp-terminal-block-editing"
        style={{ top: totalHeight }}
      >
        {chips.length > 0 && (
          <div className="dsh-warp-terminal-chips">
            {chips.map((chip) => (<span key={chip.key} className="dsh-warp-terminal-chip">{chip.node}</span>))}
          </div>
        )}
        <div className="dsh-warp-terminal-editor-wrap">
          {ghost.length > 0 && (
            <div className="dsh-warp-terminal-ghost" aria-hidden="true">
              <span>{draft}</span>
              <span className="dsh-warp-terminal-ghost-hint">{ghost}</span>
              <span className="dsh-warp-terminal-ghost-accept">{t('editor.acceptHint')}</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="dsh-warp-terminal-command-textarea"
            placeholder={ghost.length > 0 ? '' : t('editor.placeholder')}
            value={draft}
            rows={draftRows}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={connState !== 'ready' || altActive}
            onChange={(event) => {
              const value = event.target.value
              draftRef.current = value
              historyIndexRef.current = null
              setDraft(value)
              if (value.trim().length === 0) {
                completionRequestRef.current = null
                setCompletionMenu(null)
                setGhost('')
                return
              }
              const menu = completionMenuRef.current
              if (menu !== null && menu.candidates[0]?.kind === 'history') {
                if (!openHistoryMenu(value)) {
                  setCompletionMenu(null)
                  refreshHistoryGhost(value)
                }
                return
              }
              setCompletionMenu(null)
              refreshHistoryGhost(value)
            }}
            onKeyDown={(event) => {
              const native = event.nativeEvent as { isComposing?: boolean; keyCode?: number }
              if (native.isComposing === true || native.keyCode === 229) return
              const textarea = event.currentTarget
              const value = textarea.value
              const cursor = textarea.selectionStart
              const running = runningIdRef.current !== null

              if (completionMenu !== null) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  setCompletionMenu((menu) => {
                    if (menu === null) return null
                    const count = menu.candidates.length
                    const selected = (menu.selectedIndex + step + count) % count
                    const candidate = menu.candidates[selected]
                    if (candidate?.kind === 'history') {
                      const typed = draftRef.current
                      setGhost(
                        candidate.replacement.startsWith(typed) && candidate.replacement.length > typed.length
                          ? candidate.replacement.slice(typed.length)
                          : '',
                      )
                    }
                    return { ...menu, selectedIndex: selected }
                  })
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setCompletionMenu(null)
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const selected = completionMenu.selectedIndex >= 0 ? completionMenu.selectedIndex : 0
                  applyCompletionCandidate(selected)
                  return
                }
              }

              if (event.key === 'Tab') {
                event.preventDefault()
                if (running) {
                  const data = keyToBytes(event.nativeEvent as KeyboardEvent)
                  const ws = wsRef.current
                  if (data !== null && ws !== null && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage))
                  }
                } else {
                  requestCompletion(cursor, 'tab')
                }
                return
              }

              if (event.key === 'ArrowRight' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                if (!running && ghostRef.current.length > 0 && cursor === value.length) {
                  event.preventDefault()
                  acceptGhost()
                  return
                }
              }

              if (event.key === 'Escape' && !running && (ghostRef.current.length > 0 || completionMenu !== null)) {
                event.preventDefault()
                setGhost('')
                setCompletionMenu(null)
                completionRequestRef.current = null
                return
              }

              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                const direction = event.key === 'ArrowUp' ? -1 : 1
                if (running) {
                  event.preventDefault()
                  const data = keyToBytes(event.nativeEvent as KeyboardEvent)
                  const ws = wsRef.current
                  if (data !== null && ws !== null && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage))
                  }
                  return
                }
                if (!event.shiftKey && !event.altKey && !event.metaKey &&
                  historyRef.current.length > 0 && historyNavigationAllowed(value, cursor, direction)) {
                  event.preventDefault()
                  if (direction < 0 && value.trim().length > 0 && openHistoryMenu(value)) return
                  navigateHistory(direction as -1 | 1)
                  return
                }
              }

              const control = event.ctrlKey && !event.metaKey && !event.altKey
              const key = event.key.toLowerCase()
              if (control && (key === 'p' || key === 'n') && !running) {
                event.preventDefault()
                navigateHistory(key === 'p' ? -1 : 1)
                return
              }
              if (control && key === 'c' && textarea.selectionStart === textarea.selectionEnd) {
                event.preventDefault()
                if (running) {
                  killRunning()
                }
                draftRef.current = ''
                setDraft('')
                setGhost('')
                setCompletionMenu(null)
                return
              }
              if (control && ['a', 'e', 'u', 'k', 'w'].includes(key)) {
                event.preventDefault()
                const bounds = lineBounds(value, cursor)
                if (key === 'a') {
                  setDraftWithCaret(value, bounds.start)
                } else if (key === 'e') {
                  setDraftWithCaret(value, bounds.end)
                } else if (key === 'u') {
                  const next = value.slice(0, bounds.start) + value.slice(cursor)
                  setDraftWithCaret(next, bounds.start)
                } else if (key === 'k') {
                  const next = value.slice(0, cursor) + value.slice(bounds.end)
                  setDraftWithCaret(next, cursor)
                } else {
                  const before = value.slice(bounds.start, cursor).replace(/\s+$/, '').replace(/\S+$/, '')
                  const next = value.slice(0, bounds.start) + before + value.slice(cursor)
                  setDraftWithCaret(next, bounds.start + before.length)
                }
                return
              }
              if (event.altKey && event.key === 'ArrowRight' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                if (!running && ghostRef.current.length > 0 && cursor === value.length) {
                  event.preventDefault()
                  acceptGhostWord()
                  return
                }
              }
              if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                event.preventDefault()
                const next = wordCaret(value, cursor, event.key === 'ArrowLeft' ? -1 : 1)
                setDraftWithCaret(value, next)
                return
              }
              if (event.key === 'Enter' && event.shiftKey === false) {
                event.preventDefault()
                runDraft()
                return
              }
              if (running && event.key === 'Escape') {
                event.preventDefault()
                killRunning()
                draftRef.current = ''
                setDraft('')
                setGhost('')
              }
            }}
          />
          {completionMenu !== null && (
            <div className={'dsh-warp-terminal-completion-menu' + (menuUp ? ' dsh-warp-terminal-completion-menu-up' : '')} role="listbox">
              {visibleCompletionRows(completionMenu).map((row) => (
                <button
                  key={row.candidate.label + ':' + row.candidate.kind + ':' + String(row.index)}
                  type="button"
                  className={'dsh-warp-terminal-completion-option' + (row.index === completionMenu.selectedIndex ? ' is-selected' : '')}
                  role="option"
                  aria-selected={row.index === completionMenu.selectedIndex}
                  ref={(node) => {
                    if (row.index === completionMenu.selectedIndex) node?.scrollIntoView({ block: 'nearest' })
                  }}
                  onMouseDown={(mouseEvent) => {
                    mouseEvent.preventDefault()
                    applyCompletionCandidate(row.index)
                  }}
                >
                  <span className="dsh-warp-terminal-completion-label">{row.candidate.label}</span>
                  <span className="dsh-warp-terminal-completion-meta">
                    {row.candidate.description !== undefined && row.candidate.description.length > 0 && (
                      <span className="dsh-warp-terminal-completion-desc">{row.candidate.description}</span>
                    )}
                    <span className="dsh-warp-terminal-completion-kind">{t(KIND_LABEL[row.candidate.kind])}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
        </div>
      </div>
    </div>
  )
}

const COMPLETION_MENU_ROWS = 12

function visibleCompletionRows(menu: CompletionMenu): Array<{ index: number; candidate: TerminalCompletionCandidate }> {
  const count = menu.candidates.length
  const windowSize = Math.min(COMPLETION_MENU_ROWS, count)
  const selected = Math.max(0, Math.min(menu.selectedIndex, count - 1))
  const start = count <= windowSize ? 0 : Math.max(0, Math.min(selected - 2, count - windowSize))
  return menu.candidates.slice(start, start + windowSize).map((candidate, offset) => ({
    index: start + offset,
    candidate,
  }))
}

function historyGhost(history: string[], input: string): string | null {
  if (input.length === 0) return null
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]
    if (command.length > input.length && command.startsWith(input)) return command.slice(input.length)
  }
  return null
}

function historyPrefixMatches(history: string[], input: string, limit = 12): string[] {
  const seen = new Set<string>()
  const matches: string[] = []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]
    if (command.length === 0) continue
    if (input.length > 0 && !command.startsWith(input)) continue
    if (seen.has(command)) continue
    seen.add(command)
    matches.push(command)
    if (matches.length >= limit) break
  }
  return matches
}

function mergeHistory(loaded: string[], session: string[]): string[] {
  if (loaded.length === 0) return session.slice()
  if (session.length === 0) return loaded.slice()
  let overlap = 0
  const maxOverlap = Math.min(loaded.length, session.length)
  for (let size = maxOverlap; size > 0; size -= 1) {
    let same = true
    for (let index = 0; index < size; index += 1) {
      if (loaded[loaded.length - size + index] !== session[index]) {
        same = false
        break
      }
    }
    if (same) {
      overlap = size
      break
    }
  }
  const next = loaded.concat(session.slice(overlap))
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next
}

function historyNavigationAllowed(value: string, cursor: number, direction: number): boolean {
  if (!value.includes('\n')) return true
  return direction < 0 ? !value.slice(0, cursor).includes('\n') : !value.slice(cursor).includes('\n')
}

function lineBounds(value: string, cursor: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const nextBreak = value.indexOf('\n', cursor)
  return { start, end: nextBreak === -1 ? value.length : nextBreak }
}

function wordCaret(value: string, cursor: number, direction: -1 | 1): number {
  if (direction < 0) {
    let next = cursor
    while (next > 0 && /\s/.test(value[next - 1])) next -= 1
    while (next > 0 && !/\s/.test(value[next - 1])) next -= 1
    return next
  }
  let next = cursor
  while (next < value.length && !/\s/.test(value[next])) next += 1
  while (next < value.length && /\s/.test(value[next])) next += 1
  return next
}

function keyToBytes(event: KeyboardEvent): string | null {
  const ESC = '\x1b'
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
    return null
  }
  if (event.metaKey) return null
  switch (event.key) {
    case 'Enter': return '\r'
    case 'Backspace': return '\x7f'
    case 'Tab': return '\t'
    case 'Escape': return ESC
    case 'ArrowUp': return ESC + '[A'
    case 'ArrowDown': return ESC + '[B'
    case 'ArrowRight': return ESC + '[C'
    case 'ArrowLeft': return ESC + '[D'
    case 'Home': return ESC + '[H'
    case 'End': return ESC + '[F'
    case 'PageUp': return ESC + '[5~'
    case 'PageDown': return ESC + '[6~'
    case 'Delete': return ESC + '[3~'
    case 'Insert': return ESC + '[2~'
    default: break
  }
  if (event.key.length === 1) return event.key
  return null
}
