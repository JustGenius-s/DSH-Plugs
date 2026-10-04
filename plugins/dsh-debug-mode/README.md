# @just-genius/dsh-debug-mode

Cursor-style debug mode for DSH: a `/debug` collaboration mode, a Debug chip, a Debug Logs dock, and a reproduction-steps card with **Proceed** / **Mark as fixed**.

This is the human-in-the-loop shell. Evidence lives in **runs**, not one wipeable stream. Hypotheses have a status. Browser probes should be inline fetch (or `debugLog` with edge gating), not a long-lived import from `.dsh/debug/`.

## Persistence

On DSH 0.1.6+ (hosts whose `Session.append` accepts `{ ignorable: true }`), `/debug` appends a log-only `debug/mode` event. Reload / reopen folds that event, so the chip, policy, and kit come back without typing `/debug` again. Pending `wanted` switches, the open wait, run archives, and hypothesis status stay process-local.

Older hosts cannot mark plugin events ignorable without poisoning the session log. There the stance stays in process memory only.

`.dsh/debug/debug.log` is the **live** run. `wait_for_repro` archives it to `.dsh/debug/debug.<runId>.log` (first wait `pre-fix`, next `post-fix`) and starts a new live file. Clear empties the live dock only — archived runs stay. Cleared is never proof of a fix.

## Features

- **`/debug` / `/debug off`** — `/debug` runs as soon as it is chosen (no argument field in the composer). The slash menu shows a localized title, description, and bug icon. `/debug off` or the red chip leaves. A full typed line `/debug <message>` still steers that text as the next user turn. Turning it on writes the workspace helper kit and injects the debug policy plus the live helper path.
- **Debug chip** — red pill in the composer tool row while debug mode is the effective target; clicking it runs `/debug off`.
- **Debug Logs dock** — appears after the first live log, archived run, or hypothesis lands (not on `/debug` alone). Live run, archived run chips, hypothesis status, and folded repeats (`×N`). Runtime ingest and `debug_log` share `hypothesisId`.
- **Workspace helper** — `/debug` writes `.dsh/debug/` (`sink.json`, `log.browser.js`, `log.mjs` / `log.cjs` / `log.py` / `log.sh`, `unload.mjs`). The directory is gitignored.
- **Runtime ingest** — Browser probes POST to a **stable sidecar** `http://127.0.0.1:17318/dsh-debug-mode/logs`, not the Desktop GUI port (that number changes every restart). `sessionId` is optional when exactly one debug session is live. Localhost Vite origins are CORS-allowed. Identical lines inside ~8s fold. Browser `debugLog` also drops unchanged `(location, hypothesisId, payload)` unless `{ edge: false }`.
- **Vite / bundled apps** — do not import `.dsh/debug/`. Paste the inline fetch from the ingest block (always port `17318`) inside `#region agent log`, then `node .dsh/debug/unload.mjs <file>…` on Mark as fixed.
- **Reproduction card** — `wait_for_repro` returns `logs` (this run) and `previousLogs` (archived run) so pre-fix evidence survives the next gate.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/policy.ts`, `src/kit.ts`, `src/persist.ts`, `src/runs.ts`, `src/dedup.ts`, `src/hypotheses.ts` | Mode fold; run archive; ingest fold; `wait_for_repro` / `debug_log` |
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

Restart DSH web after the first install. Verify: type `/debug` in the composer — a red Debug badge should appear within ~0.5s. The Debug Logs dock stays hidden until a runtime or `debug_log` line reaches the session.
