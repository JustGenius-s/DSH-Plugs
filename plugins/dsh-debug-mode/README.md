# @just-genius/dsh-debug-mode

Cursor-style debug mode for DSH: a `/debug` collaboration mode, a Debug chip, a Debug Logs dock, and a reproduction-steps card with **Proceed** / **Mark as fixed**.

This is the human-in-the-loop shell. The agent instruments by calling the workspace helper under `.dsh/debug/` (not by writing raw HTTP). `debug_log` is only for the agent's own notes. Every program reaches Debug Logs the same way: the helper POSTs to this session's ingest sink.

## Persistence note

Debug mode state (`active` / wait / logs) lives in **process memory only** for the current live session. It is **not** written into the durable session log.

Official `/plan` can append `plan/mode` because that type is in the harness `KNOWN_SESSION_EVENT_TYPES` set. Plugin-owned `debug/*` events are not, and `Session.append` has no way to mark them `ignorable`, so persisting them would make the session refuse to reload.

Consequence: reload / restart / reopen clears debug mode, open waits, and the in-memory dock. `.dsh/debug/debug.log` stays on disk; `/debug` again hydrates the dock from that file.

## Features

- **`/debug` / `/debug off`** — same shape as `/plan`. An optional message after `/debug` is submitted as the next user turn under debug guidance. Turning it on writes the workspace helper kit and injects a short debug policy plus the live helper path.
- **Debug chip** — red pill in the composer tool row while debug mode is the effective target; clicking it runs `/debug off`.
- **Debug Logs dock** — sits above the composer while debug mode is on; read-only evidence from `debug_log` and runtime POSTs (polled over HTTP).
- **Workspace helper** — `/debug` writes `.dsh/debug/` (`sink.json`, `log.mjs` / `log.cjs` / `log.py` / `log.sh`). Programs should call that helper instead of hand-writing HTTP. The directory is gitignored.
- **Runtime ingest** — helper POSTs to `/dsh-debug-mode/logs` with `{ sessionId, text }` (or `{ sessionId, lines }`). External posts are always `source: ingest`. Debug must be on, or the sink returns 409.
- **Log file** — every dock line is also appended as JSONL to `.dsh/debug/debug.log`. Turning debug on again hydrates the dock from that file when memory is empty.
- **Clear** — the Debug Logs header has a Clear button. It wipes the live dock and truncates `debug.log`.
- **Reproduction card** — shown when the model calls `wait_for_repro`. Follow the steps, then **Proceed** or **Mark as fixed**; extra notes typed in the composer are attached by those buttons.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/policy.ts`, `src/kit.ts` | In-memory store; workspace helper kit; `wait_for_repro` / `debug_log`; ingest/clear routes |
| client | `src/client/*` | Chip + dock poll `/dsh-debug-mode/state`; styles via CSS Modules |
| shared | `src/shared.ts`, `src/types.ts` | Paths and payload types shared by both halves |

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-debug-mode
```

Restart DSH web after the first install. Verify: type `/debug` in the composer — a red Debug badge and the Debug Logs dock should appear within ~0.5s.
