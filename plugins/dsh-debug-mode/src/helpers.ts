import type { IngestSink } from './shared.ts'

/** Pack helper args into one ingest body. Last object may carry structured fields. */
function packDebugArgsSource(): string {
  return `function pack(args) {
  if (args.length === 0) return { message: '' }
  const last = args[args.length - 1]
  const extras = last && typeof last === 'object' && !Array.isArray(last)
    && (last.hypothesisId != null || last.location != null || last.data !== undefined
      || last.runId != null || last.edge === true || last.edge === false)
    ? last : null
  const parts = extras ? args.slice(0, -1) : args
  const message = parts.map((value) => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join(' ').trim()
  const body = { message }
  if (extras) {
    if (typeof extras.hypothesisId === 'string') body.hypothesisId = extras.hypothesisId
    if (typeof extras.location === 'string') body.location = extras.location
    if (typeof extras.runId === 'string') body.runId = extras.runId
    if (extras.edge === true || extras.edge === false) body.edge = extras.edge
    if (extras.data !== undefined) body.data = extras.data
  }
  return body
}`
}

function edgeGateSource(): string {
  return `const _edgeLast = new Map()
function skipUnchanged(packed) {
  if (packed.edge === false) return false
  let data = ''
  try { data = JSON.stringify(packed.data) } catch { data = String(packed.data) }
  const slot = (packed.location || '') + '\\0' + (packed.hypothesisId || '')
  const value = (packed.message || '') + '\\0' + data
  if (_edgeLast.get(slot) === value) return true
  _edgeLast.set(slot, value)
  return false
}`
}

/** Browser-safe helper. Bakes the ingest URL only — session comes from the live debug session. */
export function renderBrowserLogHelper(sink: IngestSink): string {
  return `\
const SINK_URL = ${JSON.stringify(sink.url)}

${packDebugArgsSource()}

${edgeGateSource()}

export function debugLog(...args) {
  const packed = pack(args)
  if (packed.message === '' && packed.data === undefined) return
  if (skipUnchanged(packed)) return
  delete packed.edge
  fetch(SINK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'ingest', timestamp: Date.now(), ...packed }),
  }).catch((error) => { console.warn('[dsh-debug]', error) })
}
`
}

/** Node ESM helper written to `.dsh/debug/log.mjs`. */
export const LOG_MJS = `\
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SINK_REL = join('.dsh', 'debug', 'sink.json')

function findSink() {
  const url = process.env.DSH_DEBUG_URL
  const sessionId = process.env.DSH_DEBUG_SESSION
  if (url && sessionId) return { url, sessionId, logFile: join('.dsh', 'debug', 'debug.log') }
  const starts = [process.cwd()]
  try { starts.push(dirname(fileURLToPath(import.meta.url))) } catch {}
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 16; i++) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, SINK_REL), 'utf8'))
        if (typeof raw.url === 'string' && typeof raw.sessionId === 'string') {
          return { url: raw.url, sessionId: raw.sessionId, logFile: join(dir, '.dsh', 'debug', 'debug.log') }
        }
      } catch {}
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('dsh debug sink not found; is /debug on?')
}

${packDebugArgsSource()}

${edgeGateSource()}

export async function debugLog(...args) {
  const packed = pack(args)
  if (packed.message === '' && packed.data === undefined) return
  if (skipUnchanged(packed)) return
  delete packed.edge
  const sink = findSink()
  const body = { sessionId: sink.sessionId, source: 'ingest', timestamp: Date.now(), ...packed }
  try {
    const response = await fetch(sink.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) return
    throw new Error('ingest ' + response.status)
  } catch (error) {
    try {
      appendFileSync(sink.logFile, JSON.stringify({ at: Date.now(), source: 'ingest', text: packed.message, ...packed }) + '\\n')
    } catch {}
    console.warn('[dsh-debug]', error)
  }
}

const entry = process.argv[1]
const isMain = entry !== undefined
  && import.meta.url === pathToFileURL(entry).href

if (isMain) {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    await debugLog(...args)
  } else if (process.stdin.isTTY === false) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    await debugLog(Buffer.concat(chunks).toString('utf8'))
  } else {
    console.error('usage: node .dsh/debug/log.mjs <text>')
    process.exitCode = 1
  }
}
`

/** Node CJS helper written to `.dsh/debug/log.cjs`. */
export const LOG_CJS = `\
const { appendFileSync, readFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const SINK_REL = join('.dsh', 'debug', 'sink.json')

function findSink() {
  const url = process.env.DSH_DEBUG_URL
  const sessionId = process.env.DSH_DEBUG_SESSION
  if (url && sessionId) return { url, sessionId, logFile: join('.dsh', 'debug', 'debug.log') }
  const starts = [process.cwd(), __dirname]
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 16; i++) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, SINK_REL), 'utf8'))
        if (typeof raw.url === 'string' && typeof raw.sessionId === 'string') {
          return { url: raw.url, sessionId: raw.sessionId, logFile: join(dir, '.dsh', 'debug', 'debug.log') }
        }
      } catch {}
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('dsh debug sink not found; is /debug on?')
}

${packDebugArgsSource()}

${edgeGateSource()}

async function debugLog(...args) {
  const packed = pack(args)
  if (packed.message === '' && packed.data === undefined) return
  if (skipUnchanged(packed)) return
  delete packed.edge
  const sink = findSink()
  const body = { sessionId: sink.sessionId, source: 'ingest', timestamp: Date.now(), ...packed }
  try {
    const response = await fetch(sink.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) return
    throw new Error('ingest ' + response.status)
  } catch (error) {
    try {
      appendFileSync(sink.logFile, JSON.stringify({ at: Date.now(), source: 'ingest', text: packed.message, ...packed }) + '\\n')
    } catch {}
    console.warn('[dsh-debug]', error)
  }
}

module.exports = { debugLog }

if (require.main === module) {
  const args = process.argv.slice(2)
  const run = args.length > 0
    ? debugLog(...args)
    : new Promise((resolve, reject) => {
        const chunks = []
        process.stdin.on('data', (chunk) => chunks.push(chunk))
        process.stdin.on('end', () => resolve(debugLog(Buffer.concat(chunks).toString('utf8'))))
        process.stdin.on('error', reject)
      })
  run.catch(() => { process.exitCode = 1 })
}
`

/** Python helper written to `.dsh/debug/log.py`. */
export const LOG_PY = `\
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

SINK_REL = Path(".dsh") / "debug" / "sink.json"


def _find_sink() -> dict[str, str]:
    url = os.environ.get("DSH_DEBUG_URL")
    session_id = os.environ.get("DSH_DEBUG_SESSION")
    if url and session_id:
        return {"url": url, "sessionId": session_id}
    starts = [Path.cwd().resolve(), Path(__file__).resolve().parent]
    for start in starts:
        current = start
        for _ in range(16):
            candidate = current / SINK_REL
            try:
                raw = json.loads(candidate.read_text(encoding="utf-8"))
            except OSError:
                raw = None
            except json.JSONDecodeError:
                raw = None
            if isinstance(raw, dict) and isinstance(raw.get("url"), str) and isinstance(raw.get("sessionId"), str):
                return {"url": raw["url"], "sessionId": raw["sessionId"]}
            parent = current.parent
            if parent == current:
                break
            current = parent
    raise FileNotFoundError("dsh debug sink not found; is /debug on?")


def debug_log(*args: object) -> None:
    parts = []
    for value in args:
        if isinstance(value, str):
            parts.append(value)
        else:
            try:
                parts.append(json.dumps(value, default=str))
            except TypeError:
                parts.append(str(value))
    text = " ".join(parts).strip()
    if text == "":
        return
    try:
        sink = _find_sink()
        payload = json.dumps({
            "sessionId": sink["sessionId"],
            "message": text,
            "source": "ingest",
        }).encode("utf-8")
        req = urllib.request.Request(
            sink["url"],
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2).read()
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        sys.stderr.write(f"[dsh-debug] {error}\\n")
        return


if __name__ == "__main__":
    if len(sys.argv) > 1:
        debug_log(*sys.argv[1:])
    elif not sys.stdin.isatty():
        debug_log(sys.stdin.read())
    else:
        sys.stderr.write("usage: python .dsh/debug/log.py <text>\\n")
        raise SystemExit(1)
`

/** POSIX helper written to `.dsh/debug/log.sh`. */
export const LOG_SH = `\
#!/bin/sh
set -eu

find_sink() {
  dir="$1"
  i=0
  while [ "$i" -lt 16 ]; do
    if [ -f "$dir/.dsh/debug/sink.json" ]; then
      printf '%s\\n' "$dir/.dsh/debug/sink.json"
      return 0
    fi
    parent=$(dirname "$dir")
    if [ "$parent" = "$dir" ]; then
      break
    fi
    dir="$parent"
    i=$((i + 1))
  done
  return 1
}

if [ -n "\${DSH_DEBUG_URL:-}" ] && [ -n "\${DSH_DEBUG_SESSION:-}" ]; then
  url="$DSH_DEBUG_URL"
  session="$DSH_DEBUG_SESSION"
else
  sink=$(find_sink "$(pwd)" || find_sink "$(CDPATH= cd -- "$(dirname "$0")" && pwd)")
  url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$sink")
  session=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sessionId"])' "$sink")
fi

if [ "$#" -gt 0 ]; then
  text="$*"
elif [ ! -t 0 ]; then
  text=$(cat)
else
  echo "usage: sh .dsh/debug/log.sh <text>" >&2
  exit 1
fi

body=$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"sessionId": sys.argv[1], "message": sys.stdin.read(), "source": "ingest"}))' "$session")
curl -sS -m 2 -X POST -H 'content-type: application/json' -d "$body" "$url" >/dev/null
`

/** CLI that strips \`// #region agent log\` blocks from the files the agent touched. */
export const LOG_UNLOAD = `\
import { readFileSync, writeFileSync } from 'node:fs'

const region = /^[ \\t]*\\/\\/[ \\t]*#region agent log\\r?\\n[\\s\\S]*?^[ \\t]*\\/\\/[ \\t]*#endregion[ \\t]*\\r?\\n?/gm

export function stripAgentLogRegions(source) {
  return source.replace(region, '')
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node .dsh/debug/unload.mjs <file>…')
  process.exitCode = 1
} else {
  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    const after = stripAgentLogRegions(before)
    if (after !== before) writeFileSync(file, after)
    console.log((after === before ? 'unchanged' : 'stripped') + ' ' + file)
  }
}
`
