# @just-genius/dsh-codex

Codex-style additions for DSH: Side Chat, Terminal, and Git mounted into DSH's official right Sidebar — all configurable from one Codex settings section. Files use DSH's built-in implementation by default.

## Features

- **Official Sidebar extensions** — Side Chat, Terminal, Changes, and Graph register through `ctx.sidebarRightTabs`; DSH owns Files, file previews, the tab strip, splits, floating panes, fullscreen mode, resizing, and collapse/expand controls.
- **Files** — the workspace tree stays with DSH. `dsh-resource://file/**` uses DSH's viewer by default; the retained Codex preview can be enabled from Codex settings for comparison.
- **Retained custom tabs** — DSH's disposable active-body seat only hosts a mount point. Side Chat, Terminal, Changes, Graph, and the optional custom Files bodies keep their actual React roots and DOM across tab switches, pane moves, dock/float changes, and Session switches; their official `tab.signal` is the sole tab-close lifetime.
- **Side Chat** — opens an independent temporary agent beside the current task, optionally seeded with a digest of the main conversation. Its first user message becomes the official tab title, and closing the tab disposes the side session through `tab.signal`.
- **Terminal panel** — Warp-style blocks backed by a real login-shell PTY over WebSocket (`/dsh-codex/terminal/ws`), with completions, history, ghost hints, and full-screen program (vim/htop) alt-screen support. Aborting its official `tab.signal` terminates the PTY.
- **Git graph panel** — read-only commit graph walking `git log` (`/dsh-codex/git-graph`), with lane layout, branch filter, and a commit context menu (copy, checkout, branch, cherry-pick, revert, reset).
- **Side chat** — a temporary conversation beside the current session (`/side`, or a `侧聊` tab). It shares the parent's sandbox but never its history: the transcript starts empty, and what it inherits instead is a bounded **context digest** of the parent's recent turns, injected as model-facing context so the side agent answers with the main task in mind. Two settings govern it: the panel switch, and whether a new side chat takes the digest at all. Turning the panel off also releases the side chats it owns.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/host/**` | PTY server, git-log/exec routes, settings persistence |
| client | `src/client/index.tsx`, `src/client/features/**` | One folder per feature, wired by `core/feature-manager.ts` |
| shared | `src/shared/**` | Config schema + WS/REST protocols shared by both halves |

- Client features are plain modules with a `definition.ts` (slot registrations, config gates); the feature manager mounts them in order, so a feature is added by dropping in a folder.
- The terminal renders the whole transcript onto **one canvas** (`cell-render.ts`): headless xterm grids are pure data, `doc-model.ts` flattens blocks into a linear document, and the painter draws only the visible window — one surface, one scrollbar, one selection model.
- Highlighting is bundled eagerly (single-file client bundle, no lazy chunks): `createHighlighterCoreSync` + the JS regex engine, dual-theme tokenize so theme switching needs no re-highlight.
- Sidebar layout and tab state follow DSH's official per-session lifecycle; this plugin keeps no parallel shell or launcher state.

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
