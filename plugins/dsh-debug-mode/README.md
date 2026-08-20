# @just-genius/dsh-debug-mode

Cursor-style debug mode for DSH: a `/debug` collaboration mode, a Debug chip, a Debug Logs dock, and a reproduction-steps card with **Proceed** / **Mark as fixed**.

This is the human-in-the-loop shell. The agent still instruments by editing files and calling `debug_log` — there is no automatic language-runtime probe bus yet.

## Features

- **`/debug` / `/debug off`** — same shape as `/plan`. An optional message after `/debug` is submitted as the next user turn under debug guidance.
- **Debug chip** — red pill in the composer tool row while debug mode is the effective target; clicking it runs `/debug off`.
- **Debug Logs dock** — sits above the composer while debug mode is on; read-only evidence from `debug_log`.
- **Reproduction card** — shown when the model calls `wait_for_repro`. Follow the steps, then **Proceed** or **Mark as fixed**; extra notes typed in the composer are attached by those buttons.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/policy.ts` | Registers the `wait_for_repro` / `debug_log` tools and the debug-mode policy |
| client | `src/client/index.tsx` | Debug chip, dock, and repro card; styles via CSS Modules (`*.module.css`) |
| shared | `src/shared.ts`, `src/types.ts` | Tool payload types shared by both halves |

The mode state rides the same composer-mode channel as `/plan`, so the official UI and this plugin never disagree about whether debug mode is on.

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

Restart DSH web after the first install. Verify: type `/debug` in the composer — a red Debug badge and the Debug Logs dock should appear.
