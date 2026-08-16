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
import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import type { BlockContext, ClientMessage, ServerMessage } from '../../../shared/terminal-protocol'
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
  return proto + '//' + window.location.host + '/dash-codex/terminal/ws?' + query.toString()
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

  blocksRef.current = blocks
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
    writeToGrid(grid, text, storeOpts(), () => {
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
  }, [rebuildDoc, schedulePaint])

  const completeRunning = useCallback((exitCode: number) => {
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
  }, [appendOutput, completeRunning])

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
      setDraft('')
      const message: ClientMessage = { type: 'input', data: command + '\n' }
      ws.send(JSON.stringify(message))
      rebuildDoc()
      schedulePaint()
      return
    }
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
    setDraft('')
    const message: ClientMessage = { type: 'input', data: command + '\n' }
    ws.send(JSON.stringify(message))
    rebuildDoc()
    schedulePaint()
  }, [draft, rebuildDoc, schedulePaint])

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

  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [doc, blocks.length])

  const draftRows = Math.min(8, Math.max(1, draft.split('\n').length))
  const chips = contextChips(currentContext)

  const totalHeight = (doc?.totalRows ?? 0) * metrics.cellHeight
  const rangeById = new Map((doc?.ranges ?? []).map((r) => [r.id, r]))
  const viewportTop = scrollTop
  const viewportBottom = scrollTop + viewHeight
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

      <div className="dsh-warp-terminal-block dsh-warp-terminal-block-editing">
        {chips.length > 0 && (
          <div className="dsh-warp-terminal-chips">
            {chips.map((chip) => (<span key={chip.key} className="dsh-warp-terminal-chip">{chip.node}</span>))}
          </div>
        )}
        <textarea
          className="dsh-warp-terminal-command-textarea"
          placeholder={t('editor.placeholder')}
          value={draft}
          rows={draftRows}
          disabled={connState !== 'ready' || altActive}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const native = event.nativeEvent as { isComposing?: boolean; keyCode?: number }
            if (native.isComposing === true || native.keyCode === 229) return
            if (event.key === 'Enter' && event.shiftKey === false) {
              event.preventDefault()
              runDraft()
              return
            }
            if (runningIdRef.current === null) return
            const isAbort =
              event.key === 'Escape' ||
              (event.ctrlKey &&
                event.key.toLowerCase() === 'c' &&
                event.currentTarget.selectionStart === event.currentTarget.selectionEnd)
            if (isAbort) {
              event.preventDefault()
              killRunning()
              setDraft('')
            }
          }}
        />
      </div>

      <div className="dsh-warp-terminal-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="dsh-warp-terminal-doc" style={{ height: totalHeight }}>
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
        </div>
      </div>
    </div>
  )
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
