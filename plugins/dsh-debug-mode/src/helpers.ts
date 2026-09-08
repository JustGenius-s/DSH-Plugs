/** Node ESM helper written to `.dsh/debug/log.mjs`. */
export const LOG_MJS = `\
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SINK_REL = join('.dsh', 'debug', 'sink.json')

function findSink() {
  const url = process.env.DSH_DEBUG_URL
  const sessionId = process.env.DSH_DEBUG_SESSION
  if (url && sessionId) return { url, sessionId }
  const starts = [process.cwd()]
  try { starts.push(dirname(fileURLToPath(import.meta.url))) } catch {}
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 16; i++) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, SINK_REL), 'utf8'))
        if (typeof raw.url === 'string' && typeof raw.sessionId === 'string') {
          return { url: raw.url, sessionId: raw.sessionId }
        }
      } catch {}
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('dsh debug sink not found; is /debug on?')
}

function lineOf(args) {
  return args.map((value) => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join(' ')
}

export async function debugLog(...args) {
  const text = lineOf(args).trim()
  if (text === '') return
  try {
    const sink = findSink()
    await fetch(sink.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sink.sessionId, text, source: 'ingest' }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {}
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
const { readFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const SINK_REL = join('.dsh', 'debug', 'sink.json')

function findSink() {
  const url = process.env.DSH_DEBUG_URL
  const sessionId = process.env.DSH_DEBUG_SESSION
  if (url && sessionId) return { url, sessionId }
  const starts = [process.cwd(), __dirname]
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 16; i++) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, SINK_REL), 'utf8'))
        if (typeof raw.url === 'string' && typeof raw.sessionId === 'string') {
          return { url: raw.url, sessionId: raw.sessionId }
        }
      } catch {}
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('dsh debug sink not found; is /debug on?')
}

function lineOf(args) {
  return args.map((value) => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join(' ')
}

async function debugLog(...args) {
  const text = lineOf(args).trim()
  if (text === '') return
  try {
    const sink = findSink()
    await fetch(sink.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sink.sessionId, text, source: 'ingest' }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {}
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
            "text": text,
            "source": "ingest",
        }).encode("utf-8")
        req = urllib.request.Request(
            sink["url"],
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2).read()
    except (OSError, urllib.error.URLError, TimeoutError):
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

body=$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"sessionId": sys.argv[1], "text": sys.stdin.read(), "source": "ingest"}))' "$session")
curl -sS -m 2 -X POST -H 'content-type: application/json' -d "$body" "$url" >/dev/null
`
