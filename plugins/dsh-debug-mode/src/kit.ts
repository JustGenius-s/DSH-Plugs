import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Session } from '@just-genius/dsh-plugin-runtime/host'
import { LOG_CJS, LOG_MJS, LOG_PY, LOG_SH } from './helpers.ts'
import {
  DEBUG_KIT_DIR,
  DEBUG_LOG_FILE,
  MAX_INGEST_LINE,
  capLogs,
  mintDebugId,
  type DebugLogEntry,
  type DebugLogSource,
  type IngestSink,
} from './shared.ts'

/** Files written into the session workspace so programs can emit evidence. */
export interface DebugKit {
  cwd: string
  logFile: string
  relLogFile: string
}

interface SinkFile {
  url: string
  sessionId: string
  logFile: string
}

const GITIGNORE = '*\n'

export function sessionCwd(session: Session): string | undefined {
  const cwd = session.header.cwd
  if (typeof cwd !== 'string') return undefined
  const trimmed = cwd.trim()
  return trimmed === '' ? undefined : trimmed
}

export function installDebugKit(session: Session, sink: IngestSink): DebugKit | null {
  const cwd = sessionCwd(session)
  if (cwd === undefined) return null
  try {
    return writeDebugKit(cwd, sink)
  } catch {
    return null
  }
}

function writeDebugKit(cwd: string, sink: IngestSink): DebugKit {
  const dir = join(cwd, DEBUG_KIT_DIR)
  mkdirSync(dir, { recursive: true })
  rotateForeignLog(dir, sink.sessionId)
  writeFileSync(join(dir, '.gitignore'), GITIGNORE, 'utf8')
  writeFileSync(join(dir, 'log.mjs'), LOG_MJS, 'utf8')
  writeFileSync(join(dir, 'log.cjs'), LOG_CJS, 'utf8')
  writeFileSync(join(dir, 'log.py'), LOG_PY, 'utf8')
  writeFileSync(join(dir, 'log.sh'), LOG_SH, 'utf8')
  const payload: SinkFile = {
    url: sink.url,
    sessionId: sink.sessionId,
    logFile: DEBUG_LOG_FILE,
  }
  writeFileSync(join(dir, 'sink.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    cwd,
    logFile: join(dir, 'debug.log'),
    relLogFile: DEBUG_LOG_FILE,
  }
}

export function appendLogFile(kit: DebugKit | null, entry: DebugLogEntry): void {
  if (kit === null) return
  try {
    mkdirSync(dirname(kit.logFile), { recursive: true })
    appendFileSync(kit.logFile, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Memory remains the dock source of truth.
  }
}

export function clearLogFile(kit: DebugKit | null): void {
  if (kit === null) return
  try {
    writeFileSync(kit.logFile, '', 'utf8')
  } catch {
    // Ignore disk errors; memory is already cleared.
  }
}

export function loadLogFile(kit: DebugKit | null): DebugLogEntry[] {
  if (kit === null || !existsSync(kit.logFile)) return []
  try {
    return parseLogFile(readFileSync(kit.logFile, 'utf8'))
  } catch {
    return []
  }
}

export function parseLogFile(text: string): DebugLogEntry[] {
  const entries: DebugLogEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parsed = parseLogLine(trimmed)
    if (parsed !== null) entries.push(parsed)
  }
  return capLogs(entries)
}

function parseLogLine(line: string): DebugLogEntry | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    if (typeof raw.text !== 'string') return null
    const text = raw.text.trim()
    if (text === '') return null
    return {
      id: typeof raw.id === 'string' ? raw.id : mintDebugId('log'),
      at: typeof raw.at === 'number' ? raw.at : Date.now(),
      source: asSource(raw.source),
      text: text.length > MAX_INGEST_LINE ? text.slice(0, MAX_INGEST_LINE) : text,
    }
  } catch {
    return {
      id: mintDebugId('log'),
      at: Date.now(),
      source: 'ingest',
      text: line.length > MAX_INGEST_LINE ? line.slice(0, MAX_INGEST_LINE) : line,
    }
  }
}

function asSource(value: unknown): DebugLogSource {
  if (value === 'agent' || value === 'user' || value === 'ingest') return value
  return 'ingest'
}

function rotateForeignLog(dir: string, sessionId: string): void {
  const sinkPath = join(dir, 'sink.json')
  const logPath = join(dir, 'debug.log')
  if (!existsSync(sinkPath) || !existsSync(logPath)) return
  try {
    const prev = JSON.parse(readFileSync(sinkPath, 'utf8')) as { sessionId?: unknown }
    if (typeof prev.sessionId !== 'string' || prev.sessionId === sessionId) return
    const stamp = prev.sessionId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
    renameSync(logPath, join(dir, `debug.${stamp}.log`))
  } catch {
    // Keep the current file if we cannot tell who owns it.
  }
}
