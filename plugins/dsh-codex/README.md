# @just-genius/dsh-codex

The consolidated Codex shell for DSH: message navigation, turn collapsing, a side-panel host with file preview, a Warp-style terminal, and a git commit graph — all configurable from one Codex settings section.

## Features

- **Navigator** — a vertical tick rail on the transcript, one tick per user message, with active highlight and smooth jump.
- **Worked-for collapsing** — completed turns that ran tools collapse into a Cursor-style **Worked for** row; the closing assistant message stays visible as the conclusion.
- **Side panels** — a right-side `side.panel` host with a scrollable tab strip, plus the imperative `ctx.sidePanels` service other features use to open panels.
- **Files panel** — session-cwd file tree with status badges, read-only preview and git diff view. Syntax highlighting uses shiki's `light-plus` / `dark-plus` (VSCode's default token colors) and follows the app's light/dark switch; line-number gutters stay pinned during horizontal scroll.
- **File links in chat** — chat file links open in the side-panel preview instead of the OS default app (toggleable).
- **Terminal panel** — Warp-style blocks backed by a real login-shell PTY over WebSocket (`/dsh-codex/terminal/ws`), with completions, history, ghost hints, and full-screen program (vim/htop) alt-screen support. Follows the app theme.
- **Git graph panel** — read-only commit graph walking `git log` (`/dsh-codex/git-graph`), with lane layout, branch filter, and a commit context menu (copy, checkout, branch, cherry-pick, revert, reset).

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/host/**` | PTY server, git-log/exec routes, settings persistence |
| client | `src/client/index.tsx`, `src/client/features/**` | One folder per feature, wired by `core/feature-manager.ts` |
| shared | `src/shared/**` | Config schema + WS/REST protocols shared by both halves |

- Client features are plain modules with a `definition.ts` (slot registrations, config gates); the feature manager mounts them in order, so a feature is added by dropping in a folder.
- The terminal renders the whole transcript onto **one canvas** (`cell-render.ts`): headless xterm grids are pure data, `doc-model.ts` flattens blocks into a linear document, and the painter draws only the visible window — one surface, one scrollbar, one selection model.
- Highlighting is bundled eagerly (single-file client bundle, no lazy chunks): `createHighlighterCoreSync` + the JS regex engine, dual-theme tokenize so theme switching needs no re-highlight.
- Legacy localStorage keys from the retired standalone side-panel / terminal plugins are still read, so existing panel state survives the consolidation.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

With the plugin linked into the web profile and DSH's client HMR running, `pnpm build` (or `pnpm watch`) hot-reloads the client bundle — no page refresh needed.

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-codex
```

Restart DSH web after the first install.
