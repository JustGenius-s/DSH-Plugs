// Host half of the dsh-codex terminal feature.
//
// Owns a WebSocket endpoint (`/dsh-codex/terminal/ws`) backed by the DSH
// subprocess seam's `spawnTerminal` primitive. One browser connection is one
// interactive shell on a real PTY (ConPTY on Windows).
//
// Like Warp, the prompt shown in the UI is rendered by the client itself from
// structured context (cwd / git / node version / duration), not by the shell.
// The shell's own prompt is suppressed, and its prompt hook (the PowerShell
// `prompt` function, PROMPT_COMMAND in bash, or precmd in zsh) emits
// `ESC]777;warp-block-end;<exit>;<cwd>BEL` before every prompt, which closes
// the current command block and reports the shell's current directory. After
// each block-end the host recomputes the context (git branch/status, node
// version) in that directory and pushes it as a `context` message; the
// browser attaches the latest context to the block being edited.
//
// PowerShell has no `stty`/PROMPT_COMMAND bootstrap: it runs the setup script
// from `-EncodedCommand`, wraps each submission in `. __dsh_run '<base64>'`
// (dot-sourced so variables and cwd survive), and reports the command's start
// with `warp-block-start` so ConPTY's echo of the transport line stays out of
// the block.

import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { SubprocessTerminalHandle, SubprocessTerminalSignal } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { promisify } from 'node:util'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_CONFIG, parseTerminalShell, type DshCodexConfig } from '../../shared/config'
import {
  TERMINAL_TERMINATE_PATH,
  type BlockContext,
  type ClientMessage,
  type ServerMessage,
  type TerminalTerminateRequest,
} from '../../shared/terminal-protocol'
import { completeTerminalInput } from './completion'
import { loadShellHistory } from './history'
import { resizeSubprocessTerminal, signalSubprocessTerminal } from '../adapters/subprocess-terminal'
import { resolveTerminalShell, terminalShellKind, terminalWorkingDirectory } from './shell'
import { powerShellArguments, powerShellCommand } from './powershell'

export const name = 'dsh-codex-terminal'

/** Host services this plugin requires before `apply` runs. */
export const inject = [HOST_SERVICES.subprocess, HOST_SERVICES.webServer] as const

const execFileAsync = promisify(execFile)

const BLOCK_END_PREFIX = '\x1b]777;warp-block-end;'
const BLOCK_START_PREFIX = '\x1b]777;warp-block-start;'
const NODE_VERSION_PREFIX = '\x1b]777;warp-node-version;'
const CAPS_PREFIX = '\x1b]777;warp-caps;'
const BEL = '\x07'
const WS_PATH = '/dsh-codex/terminal/ws'
const MARKER_PREFIXES = [BLOCK_END_PREFIX, BLOCK_START_PREFIX, NODE_VERSION_PREFIX, CAPS_PREFIX] as const
/** A shell that never reaches its first prompt is unusable; fail it visibly. */
const SHELL_READY_TIMEOUT_MS = 20_000
const CONTEXT_TIMEOUT_MS = 2500
/** How long a detached PTY outlives its socket, waiting for a reconnect. */
const DETACH_GRACE_MS = 10 * 60 * 1000
/** Total output (chars) buffered for replay while a session is detached. */
const REPLAY_MAX_CHARS = 1024 * 1024
/** Host pings every attached socket on this cadence; two misses kill it. */
const HEARTBEAT_MS = 30_000
/** Covers a close racing the initial PTY spawn/registration. */
const PENDING_TERMINATION_MS = 30_000
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export interface TerminalSession {
  /** Client-supplied reconnect token; one PTY per id survives socket drops. */
  id: string
  /** The currently attached socket; null while detached (client away). */
  ws: WebSocket | null
  handle: SubprocessTerminalHandle
  cwd: string
  shell: string
  rows: number
  cols: number
  pending: string
  ready: boolean
  closed: boolean
  /** PTY already exited; a reattach only collects the buffered `exit`. */
  exited: boolean
  /** Liveness flag for the heartbeat: set on attach/pong, cleared per ping. */
  alive: boolean
  /** Messages emitted while detached, flushed on reattach. */
  replay: ServerMessage[]
  replayChars: number
  detachTimer: ReturnType<typeof setTimeout> | undefined
  nodeVersion: string | undefined
  contextSeq: number
  mode: 'prompt' | 'output'
  promptBuf: string
  history: string[] | undefined
  historySent: boolean
  /** Shell confirmed bracketed-paste support via the warp-caps probe. */
  bracketedPaste: boolean
  /** Fires when the shell never produces its first block-end marker. */
  readyTimer?: ReturnType<typeof setTimeout>
  /** Block-end held back on Windows until ConPTY flushes trailing output. */
  pendingBlockEnd?: { exitCode: number; cwd: string }
  blockEndTimer?: ReturnType<typeof setTimeout>
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
  const sessions = new Map<string, TerminalSession>()
  const pendingTerminations = new Map<string, ReturnType<typeof setTimeout>>()

  const consumePendingTermination = (token: string): boolean => {
    const timer = pendingTerminations.get(token)
    if (timer === undefined) return false
    clearTimeout(timer)
    pendingTerminations.delete(token)
    return true
  }

  const requestTermination = (token: string): void => {
    const session = sessions.get(token)
    if (session !== undefined) {
      closeSession(session)
      sessions.delete(token)
      return
    }
    const previous = pendingTerminations.get(token)
    if (previous !== undefined) clearTimeout(previous)
    pendingTerminations.set(token, setTimeout(() => {
      pendingTerminations.delete(token)
    }, PENDING_TERMINATION_MS))
  }

  const disposeRoute = ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    },
  })
  const disposeTerminate = ctx.webServer.register({
    kind: 'exact',
    path: TERMINAL_TERMINATE_PATH,
    handler: (req, res) => handleTerminate(req, res, requestTermination),
  })

  const onConnection = (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = parseSessionId(url.searchParams.get('session'))
    if (sessionId !== undefined && consumePendingTermination(sessionId)) {
      ws.close()
      return
    }
    // A reconnect carries the same session id: reattach to the PTY that
    // survived the drop instead of spawning a fresh shell (Warp behavior).
    const existing = sessionId === undefined ? undefined : sessions.get(sessionId)
    if (existing !== undefined && !existing.closed && !existing.exited) {
      attachSocket(existing, ws, sessions, true)
      return
    }
    if (existing !== undefined) {
      closeSession(existing)
      sessions.delete(existing.id)
    }
    void openSession(ctx, ws, req, getConfig, sessionId, sessions)
      .then((session) => {
        if (session === undefined || session.closed) return
        if (consumePendingTermination(session.id)) {
          closeSession(session)
          return
        }
        sessions.set(session.id, session)
      })
      .catch((error) => {
        send(ws, { type: 'error', message: errorMessage(error) })
        ws.close()
      })
  }
  wss.on('connection', onConnection)

  // Idle intermediaries drop silent WebSockets; ping so the connection looks
  // alive, and terminate half-open sockets that stopped answering.
  const heartbeat = setInterval(() => {
    for (const session of sessions.values()) {
      const ws = session.ws
      if (ws === null || ws.readyState !== ws.OPEN) continue
      if (!session.alive) {
        try { ws.terminate() } catch { /* already closing */ }
        continue
      }
      session.alive = false
      try { ws.ping() } catch { /* already closing */ }
    }
  }, HEARTBEAT_MS)

  return {
    dispose() {
      clearInterval(heartbeat)
      wss.off('connection', onConnection)
      for (const session of sessions.values()) closeSession(session)
      sessions.clear()
      for (const timer of pendingTerminations.values()) clearTimeout(timer)
      pendingTerminations.clear()
      disposeTerminate()
      disposeRoute()
      wss.close()
    },
  }
}

async function handleTerminate(
  req: IncomingMessage,
  res: ServerResponse,
  terminate: (token: string) => void,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const token = (body as Partial<TerminalTerminateRequest> | null)?.token
  if (typeof token !== 'string' || !SESSION_ID_RE.test(token)) {
    sendJson(res, 400, { ok: false, message: 'invalid terminal token' })
    return
  }
  terminate(token)
  sendJson(res, 200, { ok: true })
}

/**
 * Wire a socket onto a live session. On reattach (`rehandshake`) the client
 * treats the socket as brand new, so resend `ready`, flush everything emitted
 * while detached, and push a fresh prompt context.
 */
function attachSocket(
  session: TerminalSession,
  ws: WebSocket,
  sessions: Map<string, TerminalSession>,
  rehandshake: boolean,
): void {
  if (session.detachTimer !== undefined) {
    clearTimeout(session.detachTimer)
    session.detachTimer = undefined
  }
  session.ws = ws
  session.alive = true
  ws.on('pong', () => { session.alive = true })
  ws.on('close', () => detachSession(session, ws, sessions))
  ws.on('message', (raw) => onClientMessage(session, raw))
  if (!rehandshake) return
  send(ws, {
    type: 'ready',
    cwd: session.cwd,
    shell: session.shell,
    rows: session.rows,
    cols: session.cols,
    bracketedPaste: session.bracketedPaste,
  })
  const replay = session.replay
  session.replay = []
  session.replayChars = 0
  for (const message of replay) send(ws, message)
  if (session.exited) {
    try { ws.close() } catch { /* already closing */ }
    return
  }
  void updateContext(session)
}

/**
 * The socket dropped: keep the PTY alive for DETACH_GRACE_MS so a reconnect
 * resumes the exact shell, and buffer its output for replay. Sessions whose
 * shell already exited (or that never come back) are torn down immediately /
 * when the grace timer fires.
 */
function detachSession(
  session: TerminalSession,
  ws: WebSocket,
  sessions: Map<string, TerminalSession>,
): void {
  if (session.ws !== ws) return
  session.ws = null
  if (session.closed || session.exited) {
    closeSession(session)
    sessions.delete(session.id)
    return
  }
  session.detachTimer = setTimeout(() => {
    session.detachTimer = undefined
    closeSession(session)
    sessions.delete(session.id)
  }, DETACH_GRACE_MS)
}

export async function openSession(
  ctx: Context,
  ws: WebSocket,
  req: IncomingMessage,
  getConfig: () => DshCodexConfig = () => DEFAULT_CONFIG,
  sessionId?: string,
  sessions?: Map<string, TerminalSession>,
): Promise<TerminalSession | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const cwd = url.searchParams.get('cwd')?.trim() || process.cwd()
  const rows = clampInt(url.searchParams.get('rows'), 5, 200, 30)
  const cols = clampInt(url.searchParams.get('cols'), 20, 500, 100)
  const registry = sessions ?? new Map<string, TerminalSession>()
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

  // Shell choice is platform-aware (PowerShell 7 / Windows PowerShell / Git
  // Bash on Windows) and already ran the candidate fallback internally.
  let shell: string
  try {
    shell = await resolveTerminalShell(ctx.subprocess, shellPreference)
  } catch (error) {
    ws.off('close', onEarlyClose)
    if (!disconnected) {
      send(ws, { type: 'error', message: `shell unavailable: ${errorMessage(error)}` })
      ws.close()
    }
    return undefined
  }

  if (disconnected) {
    ws.off('close', onEarlyClose)
    return undefined
  }

  const powershell = terminalShellKind(shell) === 'powershell'
  try {
    spawnedHandle = await ctx.subprocess.spawnTerminal({
      // PowerShell installs the whole block protocol from its encoded command
      // line; POSIX shells take a login flag and are configured over the PTY.
      argv: [shell, ...(powershell ? powerShellArguments() : ['-l'])],
      cwd,
      env: {
        TERM: 'xterm-256color', COLORTERM: 'truecolor',
        // Git Bash's login profile otherwise changes cwd to the user's home.
        ...(process.platform === 'win32' && !powershell ? { CHERE_INVOKING: '1' } : {}),
      },
      terminalType: 'xterm-256color',
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
    id: sessionId ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    ws: null,
    handle,
    cwd,
    shell,
    rows,
    cols,
    pending: '',
    ready: false,
    closed: false,
    exited: false,
    alive: true,
    replay: [],
    replayChars: 0,
    detachTimer: undefined,
    nodeVersion: undefined,
    contextSeq: 0,
    mode: 'prompt',
    promptBuf: "",
    history: undefined,
    historySent: false,
    bracketedPaste: false,
  }

  void loadShellHistory(shell).then((commands) => {
    if (session.closed) return
    session.history = commands
    sendHistoryIfReady(session)
  })

  ws.off('close', onEarlyClose)
  if (ws.readyState !== ws.OPEN) {
    closeSession(session)
    return undefined
  }
  attachSocket(session, ws, registry, false)

  // A shell whose profile hangs (or a PowerShell whose setup throws before the
  // first prompt) never emits block-end, so the pane would wait on `ready`
  // forever. Fail the session with an actionable error instead.
  session.readyTimer = setTimeout(() => {
    if (session.closed || session.ready) return
    deliver(session, {
      type: 'error',
      message: `shell initialization timed out: ${shell}. Check the shell profile or choose another shell in Codex settings.`,
    })
    closeSession(session)
    registry.delete(session.id)
  }, SHELL_READY_TIMEOUT_MS)

  // A PTY chunk can split a multi-byte character (ConPTY writes UTF-8 in small
  // reads), so decode across chunks instead of per Buffer.
  const decoder = new StringDecoder('utf8')
  handle.output.on('data', (chunk: Buffer | string) => {
    if (session.closed) return
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    onTerminalData(session, text)
  })

  void handle.done
    .then((outcome) => {
      if (session.closed) return
      session.exited = true
      clearTimeout(session.readyTimer)
      const tail = decoder.end()
      if (tail !== '') onTerminalData(session, tail)
      if (session.ready && session.pending.length > 0) {
        deliver(session, { type: 'output', text: session.pending })
        session.pending = ''
      }
      deliver(session, {
        type: 'exit',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
      })
      const attached = session.ws
      if (attached !== null) {
        try {
          attached.close()
        } catch {
          // already closing
        }
        // The close event detaches; an exited session is torn down there.
      } else {
        closeSession(session)
        registry.delete(session.id)
      }
    })
    .catch(() => {})

  // Configure the shell: quiet input echo, colored output, and a prompt hook
  // that reports the exit status and current directory. PS1 stays empty so
  // the shell itself draws no  the client renders the Warp-style one.
  // PowerShell needs none of this: its bootstrap arrived via -EncodedCommand.
  if (!powershell) {
    try {
      await handle.write(setupScript(shell))
    } catch (error) {
      closeSession(session)
      throw error
    }
  }

  if (session.closed) return undefined
  return session
}

/** Handle one client message on the session's currently attached socket. */
function onClientMessage(session: TerminalSession, raw: unknown): void {
  if (session.closed) return
  let message: ClientMessage
  try {
    message = JSON.parse(String(raw)) as ClientMessage
  } catch {
    return
  }
  switch (message.type) {
    case 'command': {
      if (!session.ready || typeof message.command !== 'string' || message.command.length > 1_048_576) break
      session.promptBuf = ""
      session.pending = ""
      const powershell = terminalShellKind(session.shell) === 'powershell'
      // PowerShell echoes its transport expression; expose output only after
      // the command-start marker, leaving the user's command in the UI header.
      session.mode = powershell ? 'prompt' : 'output'
      const normalized = message.command.replace(/\r\n|\n/g, '\r')
      const data = powershell
        ? powerShellCommand(message.command)
        : (session.bracketedPaste && message.command.includes('\n')
            ? `\x1b[200~${normalized}\x1b[201~`
            : normalized) + '\r'
      void session.handle.write(data).catch(error => {
        deliver(session, { type: 'error', message: `terminal write failed: ${errorMessage(error)}` })
        closeSession(session)
      })
      break
    }
    case 'input': {
      // Bytes buffered since the last block-end marker are the shell's own
      // prompt (prompt frameworks redraw it from precmd, so PS1='' cannot
      // suppress it). The client renders its own Warp-style prompt, so the
      // shell prompt is discarded here and the mode switches back to output.
      // PowerShell keeps `session.pending` intact: ConPTY can deliver a
      // partial OSC marker and this path also carries Ctrl+C and host replies.
      session.promptBuf = ""
      session.mode = 'output'
      if (terminalShellKind(session.shell) !== 'powershell') session.pending = ""
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
      void completeTerminalInput(
        message.input,
        message.cursor,
        session.cwd,
        process.env,
        terminalShellKind(session.shell),
      )
        .then((completion) => {
          if (session.closed) return
          deliver(session, { type: 'completion', requestId, ...completion })
        })
        .catch(() => {
          if (session.closed) return
          deliver(session, {
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
      // ConPTY delivers Ctrl+C as input ('\x03'); POSIX shells use the
      // foreground process group. See signalSubprocessTerminal.
      void signalSubprocessTerminal(session.handle, message.signal as SubprocessTerminalSignal)
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
      try {
        resizeSubprocessTerminal(session.handle, cols, rows)
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
}

export function closeSession(session: TerminalSession): void {
  if (session.closed) return
  session.closed = true
  clearTimeout(session.readyTimer)
  clearTimeout(session.blockEndTimer)
  if (session.detachTimer !== undefined) {
    clearTimeout(session.detachTimer)
    session.detachTimer = undefined
  }
  void session.handle.terminate().catch(() => {})
  const ws = session.ws
  session.ws = null
  if (ws !== null) {
    try {
      ws.close()
    } catch {
      // already closing
    }
  }
}

/**
 * Send to the attached socket, or buffer for replay while detached. Only
 * transcript-bearing messages (output / block-end / exit / history) are
 * replayed — ready, context, and completions are re-derived on reattach.
 */
function deliver(session: TerminalSession, message: ServerMessage): void {
  const ws = session.ws
  if (ws !== null && ws.readyState === ws.OPEN) {
    send(ws, message)
    return
  }
  if (
    message.type !== 'output'
    && message.type !== 'block-end'
    && message.type !== 'exit'
    && message.type !== 'history'
  ) {
    return
  }
  const chars = message.type === 'output' ? message.text.length : 64
  session.replay.push(message)
  session.replayChars += chars
  while (session.replayChars > REPLAY_MAX_CHARS && session.replay.length > 0) {
    const dropped = session.replay.shift()
    if (dropped === undefined) break
    session.replayChars -= dropped.type === 'output' ? dropped.text.length : 64
  }
}

/**
 * Shell-specific setup script. Every line executes inside the new interactive
 * shell. The prompt hook prints the block-end marker with exit code and cwd;
 * PS1 is emptied so no shell prompt is drawn. A capabilities probe reports
 * bracketed-paste support, so the client can wrap multi-line submissions in
 * the ?2004 markers and the line editor accepts them as ONE buffer (one
 * block-end) instead of executing line by line — Warp's own paste pipeline
 * (warp_tui terminal_content_element.rs) relies on the same mode.
 *
 * Like Warp, later lines are space-prefixed so hist_ignore_space / ignorespace
 * keeps bootstrap out of the user's HISTFILE.
 */
export function setupScript(shell: string): string {
  const name = terminalShellKind(shell)
  // Git Bash reports MSYS paths (/c/...) that the host cannot use for git or
  // the file tree, so ask it for the native Windows form.
  const workingDirectory = process.platform === 'win32' ? '$(pwd -W 2>/dev/null || pwd)' : '$PWD'
  const quiet = (line: string) => ' ' + line
  const lines: string[] = name === 'zsh'
    ? ['setopt HIST_IGNORE_SPACE']
    : ['HISTCONTROL="${HISTCONTROL:+$HISTCONTROL:}ignorespace"']
  lines.push(
    quiet('stty -echo'),
    quiet('export TERM=xterm-256color'),
    quiet('export COLORTERM=truecolor'),
    quiet("export PS1=''"),
    quiet("export PS2=''"),
    quiet('printf \'\\e]777;warp-node-version;%s\\a\' "$(command -v node >/dev/null 2>&1 && node --version 2>/dev/null)"'),
  )
  if (name === 'zsh') {
    lines.push(
      quiet('printf \'\\e]777;warp-caps;bracketed-paste=%s\\a\' "$(zle -l bracketed-paste >/dev/null 2>&1 && echo 1 || echo 0)"'),
      quiet(`dsh_block_mark() { printf '\\e]777;warp-block-end;%s;%s\\a' "$?" "${workingDirectory}" }`),
      // zsh 5.9 runs `precmd_functions` in order, and its own prompt machinery
      // claims the head of that output: a hook appended with `+=` runs AFTER
      // that machinery, so zsh captures the marker and re-emits it as prompt
      // text, losing the raw ESC bytes. No block-end ever reaches the browser,
      // so the pane waits on `ready` forever. (bash is unaffected: its
      // PROMPT_COMMAND writes straight to the PTY in a phase zsh does not
      // capture.) Prepend instead, so our hook runs FIRST and its bytes reach
      // the terminal. Verified: `+=` never emits a marker; prepending does.
      quiet('precmd_functions=(dsh_block_mark ${precmd_functions[@]})'),
    )
  } else {
    lines.push(
      quiet('bind "set enable-bracketed-paste on" 2>/dev/null'),
      quiet('printf \'\\e]777;warp-caps;bracketed-paste=%s\\a\' "$(bind -v 2>/dev/null | grep -q "enable-bracketed-paste on" && echo 1 || echo 0)"'),
      quiet(`PROMPT_COMMAND='printf "\\e]777;warp-block-end;%s;%s\\a" "$?" "${workingDirectory}"'"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`),
    )
  }
  return lines.join('\n') + '\n'
}

/** Parse PTY output; block-end markers become messages, the rest is output. */
export function onTerminalData(session: TerminalSession, chunk: string): void {
  session.pending += chunk

  for (;;) {
    const blockIndex = session.pending.indexOf(BLOCK_END_PREFIX)
    const startIndex = session.pending.indexOf(BLOCK_START_PREFIX)
    const nodeIndex = session.pending.indexOf(NODE_VERSION_PREFIX)
    const capsIndex = session.pending.indexOf(CAPS_PREFIX)
    if (blockIndex === -1 && startIndex === -1 && nodeIndex === -1 && capsIndex === -1) {
      const keep = possibleMarkerSuffixLength(session.pending)
      const safeLength = session.pending.length - keep
      if (safeLength > 0) {
        const safe = session.pending.slice(0, safeLength)
        session.pending = session.pending.slice(safeLength)
        emitOutput(session, safe)
      }
      return
    }

    let markerIndex = blockIndex
    let kind: 'block-end' | 'block-start' | 'node-version' | 'caps' = 'block-end'
    if (startIndex !== -1 && (markerIndex === -1 || startIndex < markerIndex)) {
      markerIndex = startIndex
      kind = 'block-start'
    }
    if (nodeIndex !== -1 && (markerIndex === -1 || nodeIndex < markerIndex)) {
      markerIndex = nodeIndex
      kind = 'node-version'
    }
    if (capsIndex !== -1 && (markerIndex === -1 || capsIndex < markerIndex)) {
      markerIndex = capsIndex
      kind = 'caps'
    }

    emitOutput(session, session.pending.slice(0, markerIndex))
    session.pending = session.pending.slice(markerIndex)

    const prefixLength =
      kind === 'block-end'
        ? BLOCK_END_PREFIX.length
        : kind === 'block-start'
          ? BLOCK_START_PREFIX.length
          : kind === 'node-version'
            ? NODE_VERSION_PREFIX.length
            : CAPS_PREFIX.length
    const belIndex = session.pending.indexOf(BEL, prefixLength)
    if (belIndex === -1) return

    const payload = session.pending.slice(prefixLength, belIndex)
    session.pending = session.pending.slice(belIndex + 1)

    if (kind === 'block-start') {
      // The user's command has begun executing: anything from here on belongs
      // to the block, including the PTY's echo of the transport expression.
      session.mode = 'output'
      session.promptBuf = ""
      continue
    }

    if (kind === 'node-version') {
      const version = payload.trim()
      if (version.length > 0) session.nodeVersion = version
      continue
    }

    if (kind === 'caps') {
      session.bracketedPaste = payload.includes('bracketed-paste=1')
      continue
    }

    const separator = payload.indexOf(';')
    if (separator === -1) continue
    const exitCode = Number.parseInt(payload.slice(0, separator).trim(), 10)
    const cwd = terminalWorkingDirectory(payload.slice(separator + 1).trim())
    if (Number.isNaN(exitCode)) continue

    if (session.ready === false) {
      session.ready = true
      clearTimeout(session.readyTimer)
      if (cwd.length > 0) session.cwd = cwd
      deliver(session, {
        type: 'ready',
        cwd: session.cwd,
        shell: session.shell,
        rows: session.rows,
        cols: session.cols,
        bracketedPaste: session.bracketedPaste,
      })
      sendHistoryIfReady(session)
      void updateContext(session)
    } else {
      if (process.platform === 'win32') {
        // ConPTY can pass an OSC through before it flushes the preceding
        // screen update. Keep those final bytes in the command's output by
        // holding the block-end until the stream goes quiet; the shell stays
        // in output mode until then.
        session.pendingBlockEnd = { exitCode, cwd }
        scheduleBlockEnd(session)
        continue
      }
      finishBlock(session, exitCode, cwd)
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
  deliver(session, { type: 'output', text })
  // Still inside an uncommitted block: restart the quiet-period timer so the
  // block-end lands after the trailing output rather than before it.
  if (session.pendingBlockEnd !== undefined) scheduleBlockEnd(session)
}

/**
 * Windows only: emit a held-back block-end once the PTY has been quiet for a
 * moment. Every later output chunk pushes the deadline out (see emitOutput), so
 * a shell that prints in several bursts still produces one block-end.
 */
function scheduleBlockEnd(session: TerminalSession): void {
  clearTimeout(session.blockEndTimer)
  session.blockEndTimer = setTimeout(() => {
    const pending = session.pendingBlockEnd
    session.pendingBlockEnd = undefined
    if (session.closed || pending === undefined) return
    finishBlock(session, pending.exitCode, pending.cwd)
  }, 40)
}

/** Close the running block: adopt the reported cwd and go back to prompt mode. */
function finishBlock(session: TerminalSession, exitCode: number, cwd: string): void {
  if (cwd.length > 0) session.cwd = cwd
  deliver(session, { type: 'block-end', exitCode })
  session.mode = 'prompt'
  session.promptBuf = ""
  void updateContext(session)
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
  deliver(session, { type: 'context', context })
}

async function getGitInfo(
  cwd: string,
): Promise<Pick<BlockContext, 'branch' | 'files' | 'adds' | 'dels'>> {
  try {
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      // windowsHide: without it every context refresh flashes a console.
      { cwd, timeout: CONTEXT_TIMEOUT_MS, windowsHide: true },
    )
    const branch = branchOut.trim()
    if (branch.length === 0) return {}

    const [statusOut, numstatOut] = await Promise.all([
      execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: CONTEXT_TIMEOUT_MS, windowsHide: true })
        .then((r) => r.stdout)
        .catch(() => ''),
      execFileAsync('git', ['diff', '--numstat', 'HEAD', '--'], { cwd, timeout: CONTEXT_TIMEOUT_MS, windowsHide: true })
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

function sendHistoryIfReady(session: TerminalSession): void {
  if (session.closed || session.ready === false || session.historySent) return
  if (session.history === undefined) return
  session.historySent = true
  deliver(session, { type: 'history', commands: session.history })
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message))
  } catch {
    // socket already closing
  }
}

function parseSessionId(value: string | null): string | undefined {
  if (value === null) return undefined
  return SESSION_ID_RE.test(value) ? value : undefined
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
