// Host half of the dsh-codex terminal feature.
//
// Owns a WebSocket endpoint (`/dsh-codex/terminal/ws`) backed by the DSH
// subprocess seam's `spawnTerminal` primitive. One browser connection is one
// interactive login shell on a real PTY.
//
// Like Warp, the prompt shown in the UI is rendered by the client itself from
// structured context (cwd / git / node version / duration), not by the shell.
// The shell's own PS1 is suppressed (PS1='') and its prompt hook
// (PROMPT_COMMAND in bash, precmd in zsh) emits
// `ESC]777;warp-block-end;<exit>;<cwd>BEL` before every prompt, which closes
// the current command block and reports the shell's current directory. After
// each block-end the host recomputes the context (git branch/status, node
// version) in that directory and pushes it as a `context` message; the
// browser attaches the latest context to the block being edited.

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle, SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { execFile } from 'node:child_process'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_CONFIG, type DshCodexConfig, type TerminalShell } from '../../shared/config'
import type { BlockContext, ClientMessage, ServerMessage } from '../../shared/terminal-protocol'
import { completeTerminalInput } from './completion'

export const name = 'dsh-codex-terminal'

/** Host services this plugin requires before `apply` runs. */
export const inject = ['subprocess', 'webServer'] as const

const execFileAsync = promisify(execFile)

const BLOCK_END_PREFIX = '\x1b]777;warp-block-end;'
const NODE_VERSION_PREFIX = '\x1b]777;warp-node-version;'
const BEL = '\x07'
const WS_PATH = '/dsh-codex/terminal/ws'
const MARKER_PREFIXES = [BLOCK_END_PREFIX, NODE_VERSION_PREFIX] as const
const CONTEXT_TIMEOUT_MS = 2500

export interface TerminalSession {
  ws: WebSocket
  handle: SubprocessTerminalHandle
  cwd: string
  shell: string
  rows: number
  cols: number
  pending: string
  ready: boolean
  closed: boolean
  nodeVersion: string | undefined
  contextSeq: number
  mode: 'prompt' | 'output'
  promptBuf: string
}

/** Handle the main thread can dispose to tear the whole server down. */
export interface DshCodexTerminalServer {
  dispose(): void
}

export function apply(ctx: Context) {
  ctx.effect(() => {
    const server = createDshCodexTerminalServer(ctx, () => DEFAULT_CONFIG)
    return () => server.dispose()
  }, 'dsh-codex: terminal websocket route')
}

/**
 * Create the terminal WebSocket server against an injected Cordis context.
 * Exported so the dsh-codex host entry (src/index.ts) can wire it explicitly
 * once the 'subprocess' and 'webServer' services are available, instead of
 * relying on this module being loaded as its own plugin.
 */
export function createDshCodexTerminalServer(
  ctx: Context,
  getConfig: () => DshCodexConfig = () => DEFAULT_CONFIG,
): DshCodexTerminalServer {
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Set<TerminalSession>()

  const disposeRoute = ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    },
  })

  const onConnection = (ws: WebSocket, req: IncomingMessage) => {
    void openSession(ctx, ws, req, getConfig)
      .then((session) => {
        if (session === undefined || session.closed) return
        sessions.add(session)
        const release = () => { sessions.delete(session) }
        void session.handle.done.then(release, release)
      })
      .catch((error) => {
        send(ws, { type: 'error', message: errorMessage(error) })
        ws.close()
      })
  }
  wss.on('connection', onConnection)

  return {
    dispose() {
      wss.off('connection', onConnection)
      for (const session of sessions) closeSession(session)
      sessions.clear()
      disposeRoute()
      wss.close()
    },
  }
}

export async function openSession(
  ctx: Context,
  ws: WebSocket,
  req: IncomingMessage,
  getConfig: () => DshCodexConfig = () => DEFAULT_CONFIG,
): Promise<TerminalSession | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const cwd = url.searchParams.get('cwd')?.trim() || process.cwd()
  const rows = clampInt(url.searchParams.get('rows'), 5, 200, 30)
  const cols = clampInt(url.searchParams.get('cols'), 20, 500, 100)
  const config = getConfig()
  if (!config.terminalEnabled) {
    send(ws, { type: 'error', message: 'terminal disabled' })
    ws.close()
    return undefined
  }
  const requestedShell = parseTerminalShell(url.searchParams.get('shell'))
  const configuredShell = parseTerminalShell(config.terminalShell) ?? 'auto'
  const shellPreference = requestedShell ?? configuredShell
  let disconnected = ws.readyState !== ws.OPEN
  let spawnedHandle: SubprocessTerminalHandle | undefined
  const onEarlyClose = () => {
    disconnected = true
    if (spawnedHandle !== undefined) {
      void spawnedHandle.terminate().catch(() => {})
    }
  }
  ws.once('close', onEarlyClose)

  const shellName = shellPreference === 'auto' ? (process.env.SHELL || 'bash') : shellPreference
  let shell: string
  try {
    shell = await ctx.subprocess.resolveExecutable(shellName)
  } catch (error) {
    if (shellPreference === 'auto' && shellName !== 'bash') {
      try {
        shell = await ctx.subprocess.resolveExecutable('bash')
      } catch (fallbackError) {
        ws.off('close', onEarlyClose)
        if (!disconnected) {
          send(ws, { type: 'error', message: `shell unavailable: ${errorMessage(fallbackError)}` })
          ws.close()
        }
        return undefined
      }
    } else {
      ws.off('close', onEarlyClose)
      if (!disconnected) {
        send(ws, { type: 'error', message: `shell unavailable: ${errorMessage(error)}` })
        ws.close()
      }
      return undefined
    }
  }

  try {
    spawnedHandle = await ctx.subprocess.spawnTerminal({
      argv: [shell, '-l'],
      cwd,
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      rows,
      cols,
      graceMs: 3000,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    ws.off('close', onEarlyClose)
    if (!disconnected) {
      send(ws, { type: 'error', message: `terminal spawn failed: ${errorMessage(error)}` })
      ws.close()
    }
    return undefined
  }

  if (disconnected || ws.readyState !== ws.OPEN) {
    ws.off('close', onEarlyClose)
    await spawnedHandle.terminate().catch(() => {})
    return undefined
  }
  const handle = spawnedHandle

  const session: TerminalSession = {
    ws,
    handle,
    cwd,
    shell,
    rows,
    cols,
    pending: '',
    ready: false,
    closed: false,
    nodeVersion: undefined,
    contextSeq: 0,
    mode: 'prompt',
    promptBuf: "",
  }

  ws.off('close', onEarlyClose)
  ws.on('close', () => {
    closeSession(session)
  })
  if (ws.readyState !== ws.OPEN) {
    closeSession(session)
    return undefined
  }

  handle.output.on('data', (chunk: Buffer | string) => {
    if (session.closed) return
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    onTerminalData(session, text)
  })

  void handle.done
    .then((outcome) => {
      if (session.closed) return
      session.closed = true
      if (session.ready && session.pending.length > 0) {
        send(session.ws, { type: 'output', text: session.pending })
        session.pending = ''
      }
      send(session.ws, {
        type: 'exit',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
      })
      try {
        session.ws.close()
      } catch {
        // already closing
      }
    })
    .catch(() => {})

  // Configure the shell: quiet input echo, colored output, and a prompt hook
  // that reports the exit status and current directory. PS1 stays empty so
  // the shell itself draws no  the client renders the Warp-style one.
  const setup = setupScript(shell)
  await handle.write(setup)

  ws.on('message', (raw) => {
    if (session.closed) return
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw)) as ClientMessage
    } catch {
      return
    }
    switch (message.type) {
      case 'input': {
        // Bytes buffered since the last block-end marker are the shell's own
        // prompt (prompt frameworks redraw it from precmd, so PS1='' cannot
        // suppress it). The client renders its own Warp-style prompt, so the
        // shell prompt is discarded here and the mode switches back to output.
        session.promptBuf = ""
        session.mode = 'output'
        session.pending = ""
        void session.handle.write(message.data).catch(() => {})
        break
      }
      case 'complete': {
        if (
          typeof message.requestId !== 'number' ||
          typeof message.input !== 'string' ||
          typeof message.cursor !== 'number' ||
          message.input.length > 32_768
        ) break
        const requestId = Math.floor(message.requestId)
        void completeTerminalInput(message.input, message.cursor, session.cwd)
          .then((completion) => {
            if (session.closed) return
            send(session.ws, { type: 'completion', requestId, ...completion })
          })
          .catch(() => {
            if (session.closed) return
            send(session.ws, {
              type: 'completion',
              requestId,
              start: Math.max(0, Math.min(message.input.length, Math.floor(message.cursor))),
              end: Math.max(0, Math.min(message.input.length, Math.floor(message.cursor))),
              replacement: '',
              candidates: [],
            })
          })
        break
      }
      case 'signal': {
        void session.handle
          .signalForeground(message.signal as SubprocessTerminalSignal)
          .catch(() => {})
        break
      }
      case 'resize': {
        // The seam's SubprocessTerminalHandle does not expose resize, but the
        // local provider's handle wraps a node-pty instance which does. Resize
        // the PTY so full-screen programs (vim) lay out to the real panel
        // dimensions instead of the spawn-time placeholder.
        const cols = Math.max(20, Math.min(500, Math.floor(message.cols)))
        const rows = Math.max(5, Math.min(200, Math.floor(message.rows)))
        session.cols = cols
        session.rows = rows
        const pty = (session.handle as unknown as { terminal?: { resize?: (c: number, r: number) => void } }).terminal
        try {
          pty?.resize?.(cols, rows)
        } catch {
          // Ignore a resize racing terminal shutdown.
        }
        break
      }
      case 'kill': {
        void session.handle.terminate().catch(() => {})
        break
      }
    }
  })

  if (session.closed) return undefined
  return session
}

export function closeSession(session: TerminalSession): void {
  if (session.closed) return
  session.closed = true
  void session.handle.terminate().catch(() => {})
  try {
    session.ws.close()
  } catch {
    // already closing
  }
}

/**
 * Shell-specific setup script. Every line executes inside the new interactive
 * shell. The prompt hook prints the block-end marker with exit code and cwd;
 * PS1 is emptied so no shell prompt is drawn.
 */
export function setupScript(shell: string): string {
  const name = basename(shell)
  const lines: string[] = [
    'stty -echo',
    'export TERM=xterm-256color',
    'export COLORTERM=truecolor',
    "export PS1=''",
    "export PS2=''",
  ]
  lines.push('printf \'\\e]777;warp-node-version;%s\\a\' "$(command -v node >/dev/null 2>&1 && node --version 2>/dev/null)"')
  if (name === 'zsh') {
    lines.push(
      'dsh_block_mark() { printf \'\\e]777;warp-block-end;%s;%s\\a\' "$?" "$PWD" }',
      'precmd_functions+=dsh_block_mark',
    )
  } else {
    lines.push(
      'PROMPT_COMMAND=\'printf "\\e]777;warp-block-end;%s;%s\\a" "$?" "$PWD"\'"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
    )
  }
  return lines.join('\n') + '\n'
}

/** Parse PTY output; block-end markers become messages, the rest is output. */
export function onTerminalData(session: TerminalSession, chunk: string): void {
  session.pending += chunk

  for (;;) {
    const blockIndex = session.pending.indexOf(BLOCK_END_PREFIX)
    const nodeIndex = session.pending.indexOf(NODE_VERSION_PREFIX)
    if (blockIndex === -1 && nodeIndex === -1) {
      const keep = possibleMarkerSuffixLength(session.pending)
      const safeLength = session.pending.length - keep
      if (safeLength > 0) {
        const safe = session.pending.slice(0, safeLength)
        session.pending = session.pending.slice(safeLength)
        emitOutput(session, safe)
      }
      return
    }

    const isBlockEnd = blockIndex !== -1 && (nodeIndex === -1 || blockIndex < nodeIndex)
    const markerIndex = isBlockEnd ? blockIndex : nodeIndex

    emitOutput(session, session.pending.slice(0, markerIndex))
    session.pending = session.pending.slice(markerIndex)

    const prefixLength = isBlockEnd ? BLOCK_END_PREFIX.length : NODE_VERSION_PREFIX.length
    const belIndex = session.pending.indexOf(BEL, prefixLength)
    if (belIndex === -1) return

    if (isBlockEnd === false) {
      const version = session.pending.slice(prefixLength, belIndex).trim()
      session.pending = session.pending.slice(belIndex + 1)
      if (version.length > 0) session.nodeVersion = version
      continue
    }

    const payload = session.pending.slice(BLOCK_END_PREFIX.length, belIndex)
    session.pending = session.pending.slice(belIndex + 1)

    const separator = payload.indexOf(';')
    if (separator === -1) continue
    const exitCode = Number.parseInt(payload.slice(0, separator).trim(), 10)
    const cwd = payload.slice(separator + 1).trim()
    if (Number.isNaN(exitCode)) continue

    if (session.ready === false) {
      session.ready = true
      if (cwd.length > 0) session.cwd = cwd
      send(session.ws, {
        type: 'ready',
        cwd: session.cwd,
        shell: session.shell,
        rows: session.rows,
        cols: session.cols,
      })
      void updateContext(session)
    } else {
      if (cwd.length > 0) session.cwd = cwd
      send(session.ws, { type: 'block-end', exitCode })
      void updateContext(session)
    }
    session.mode = 'prompt'
    session.promptBuf = ""
  }
}

function possibleMarkerSuffixLength(text: string): number {
  let keep = 0
  for (const marker of MARKER_PREFIXES) {
    const maxLength = Math.min(marker.length - 1, text.length)
    for (let length = maxLength; length > keep; length -= 1) {
      if (marker.startsWith(text.slice(-length))) {
        keep = length
        break
      }
    }
  }
  return keep
}

function emitOutput(session: TerminalSession, text: string): void {
  if (text.length === 0) return
  if (session.ready === false) return
  if (session.mode === 'prompt') {
    // Between a block-end marker and the next submitted command the only
    // bytes the shell prints are its prompt. Cap the discard buffer so a
    // misbehaving shell cannot grow it unboundedly.
    session.promptBuf += text
    if (session.promptBuf.length > 65536) {
      session.promptBuf = session.promptBuf.slice(-65536)
    }
    return
  }
  send(session.ws, { type: 'output', text })
}

/**
 * Recompute the Warp-style prompt context (git branch/status, node version)
 * in the shell's current directory and push it to the browser. Stale results
 * are dropped by sequence number so a slow `git status` cannot overwrite a
 * newer one.
 */
async function updateContext(session: TerminalSession): Promise<void> {
  const seq = ++session.contextSeq
  const cwd = session.cwd
  const git = await getGitInfo(cwd)
  if (session.closed) return
  if (seq !== session.contextSeq) return
  const context: BlockContext = { cwd, ...git }
  if (session.nodeVersion !== undefined) context.nodeVersion = session.nodeVersion
  send(session.ws, { type: 'context', context })
}

async function getGitInfo(
  cwd: string,
): Promise<Pick<BlockContext, 'branch' | 'files' | 'adds' | 'dels'>> {
  try {
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: CONTEXT_TIMEOUT_MS },
    )
    const branch = branchOut.trim()
    if (branch.length === 0) return {}

    const [statusOut, numstatOut] = await Promise.all([
      execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: CONTEXT_TIMEOUT_MS })
        .then((r) => r.stdout)
        .catch(() => ''),
      execFileAsync('git', ['diff', '--numstat', 'HEAD', '--'], { cwd, timeout: CONTEXT_TIMEOUT_MS })
        .then((r) => r.stdout)
        .catch(() => ''),
    ])

    const files = statusOut.split('\n').filter((line) => line.length > 0).length
    let adds = 0
    let dels = 0
    for (const line of numstatOut.split('\n')) {
      if (line.length === 0) continue
      const parts = line.split('\t')
      const a = Number.parseInt(parts[0], 10)
      const d = Number.parseInt(parts[1], 10)
      if (Number.isNaN(a) === false) adds += a
      if (Number.isNaN(d) === false) dels += d
    }
    return { branch, files, adds, dels }
  } catch {
    return {}
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message))
  } catch {
    // socket already closing
  }
}

function parseTerminalShell(value: string | null): TerminalShell | undefined {
  return value === 'auto' || value === 'bash' || value === 'zsh' ? value : undefined
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
