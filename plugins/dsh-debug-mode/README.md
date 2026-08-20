# @just-genius/dsh-debug-mode

Cursor-style debug mode for DSH: a `/debug` collaboration mode, a Debug chip, a Debug Logs dock, and a reproduction-steps card with **Proceed** / **Mark as fixed**.

This is the human-in-the-loop shell. The agent still instruments by editing files and calling `debug_log` — there is no automatic language-runtime probe bus yet.

## Persistence note

Debug mode state (`active` / wait / logs) lives in **process memory only** for the current live session. It is **not** written into the durable session log.

Official `/plan` can append `plan/mode` because that type is in the harness `KNOWN_SESSION_EVENT_TYPES` set. Plugin-owned `debug/*` events are not, and `Session.append` has no way to mark them `ignorable`, so persisting them would make the session refuse to reload.

Consequence: reload / restart / reopen clears debug mode, open waits, and the log dock. Use `/debug` again after reload if you still need it.

## Features

- **`/debug` / `/debug off`** — same shape as `/plan`. An optional message after `/debug` is submitted as the next user turn under debug guidance.
- **Debug chip** — red pill in the composer tool row while debug mode is the effective target; clicking it runs `/debug off`.
- **Debug Logs dock** — sits above the composer while debug mode is on; read-only evidence from `debug_log` (polled over HTTP).
- **Reproduction card** — shown when the model calls `wait_for_repro`. Follow the steps, then **Proceed** or **Mark as fixed**; extra notes typed in the composer are attached by those buttons.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/policy.ts` | In-memory store; `wait_for_repro` / `debug_log`; `/dsh-debug-mode/state|logs|repro` |
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
