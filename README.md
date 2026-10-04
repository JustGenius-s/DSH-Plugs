<h1 align="center">DSH-Plugs</h1>

<p align="center">
  A monorepo of plugins for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (DSH) — one folder = one plugin.
</p>

## Plugins

### [@just-genius/dsh-codex](plugins/dsh-codex)

Side Chat, Terminal, and Git tab types for DSH's official right Sidebar. Files use DSH's built-in packages by default, with the retained custom preview available from Codex settings; the Warp-style terminal is backed by a real login-shell PTY. Optional: pin the newest question while scrolling, and drain a session's full history on open.

### [@just-genius/dsh-debug-mode](plugins/dsh-debug-mode)

Cursor-style debug mode: `/debug`, a red Debug chip, a Debug Logs dock above the composer, and a reproduction-steps card with **Proceed** / **Mark as fixed**. Instrumentation goes through a workspace helper under `.dsh/debug/`; the dock can be cleared; runtime lines are mirrored to `.dsh/debug/debug.log`. Mode/wait stay in process memory for the live session only (not written to the durable session log).

### [@just-genius/dsh-flow](plugins/dsh-flow)

Leader-plans / subagent-executes orchestration, **off until you select or run `/flow`**. Once on, the main agent only plans — it lays work out as a DAG with `flow_plan`, each node is dispatched to its own child agent, and it reshapes the graph mid-flight with `flow_patch` (retry with a revised prompt, skip, insert a corrective step) as results land. The execution guard allows the Leader to call only `flow_plan`, `flow_status`, `flow_next`, `flow_patch`, and `flow_confirm`; investigation and execution are delegated to children. A dedicated **Flow** tab in the right sidebar draws the live graph with React Flow: node colour = status, edges = dependencies, click a node for its brief, result, and failure reason. Select `/flow` in the command menu to enable the mode and open the tab. The composer shows a **Flow chip**; click it or use `/flow off` to leave and cancel running children.

### [@just-genius/dsh-workspace-plus](plugins/dsh-workspace-plus)

Sidebar enhancement that only ADDS to the official UI. A **pinned area** above the sidebar list where both **projects and sessions** can be pinned — session pins are DSH's own `pinnedSessionIds`, so the panel and the official row button are one write, while project pins live in `~/.dsh/workspace-plus/pins.json`. Extra entries are appended to the official workspace and session row menus (the session ones through DSH's own `sidebar.workspaces.session.menu.item` slot, the workspace ones injected into the menu DSH hardcodes), on top of **multi-folder workspaces** (add folders one by one, pick one as the **primary** — the official workspace, session cwd, and workspace-write scope — while the rest stay readable and coordinatable, with the folder list injected into the system prompt) and Markdown session export. Rows are identified by DSH's `data-row-key`/`data-slot` contract; nothing claims a slot or reorders the official list. Session menus do not offer permanent delete.

Supersedes the former `dsh-multi-repo`, which was renamed into this plugin; that package name is gone, and a first load still copies `~/.dsh/multi-repo/projects.json` forward when `bindings.json` is missing.

### [@just-genius/dsh-memory](plugins/dsh-memory)

Global markdown memory: **Settings → Memory** for manual CRUD, `memory_propose` for AI writes that wait for user confirmation, and enabled entries injected into the system prompt. Stored under `~/.dsh/memory/` as `index.json` + `entries/*.md`.

### [@just-genius/dsh-computer-tools](plugins/dsh-computer-tools)

**Settings → 浏览器与桌面**: one card per capability — Browser Use (Playwright MCP) and Computer Use (Cua MCP or Native) — each with its own save. Saving writes a managed `cordis.patch.yml` insert; defaults work out of the box and the knobs live under 高级选项. The capability packages are separate opt-in installs, so a card whose packages are absent offers **一键安装** (with a copyable command as fallback). It does not restart the host or drive the computer. Needs `dsh-plugin-config`.

### [@just-genius/dsh-cua-pip](plugins/dsh-cua-pip)

Agent-controlled, session-scoped Computer Use picture-in-picture. On macOS, a native ScreenCaptureKit helper streams one explicitly selected application window into the current conversation. PiP is optional: direct Cua calls keep using their configured provider independently.

### [@just-genius/dsh-sync](plugins/dsh-sync)

GitHub Device Flow + secret Gist config sync: **Settings → Sync** pushes/pulls `settings.yaml` and the web plugin list (portable specs + `cordis.patch.yml`) with no self-hosted sync server. State lives in `~/.dsh/sync/state.json`.

### [@just-genius/dsh-model-custom-ex](plugins/dsh-model-custom-ex)

Replaces the official Models settings page (fork of `ui-settings-models`) to add per-model dropdown multi-selects for **vision** (`input`) and **thinking strength** (`reasoningEfforts`), plus a per-model **default thinking strength** and typeable **capacity combos** — the controls the stock page punts to `settings.yaml`.

### [@just-genius/dsh-notify-jump](plugins/dsh-notify-jump)

Click a `dsh-notification` system banner to focus the window and open that session; when the DSH-Desktop bridge is present it routes through `window.dshDesktop.notify` so click-to-jump survives the Electron shell. Also notifies on the rising edge of approval / ask / plan-review waits.

### [@just-genius/dsh-session-archive](plugins/dsh-session-archive)

**Settings → 会话归档**: archived sessions grouped by workspace, with restore and confirmed delete. On DSH 0.1.7, the official archive view is in the sidebar's **视图选项 → 显示已归档／仅显示已归档** filter; there is no separate official archive settings page to reappear when this plugin is disabled.

### [@just-genius/dsh-plugin-config](plugins/dsh-plugin-config)

**Settings → 插件 → 插件扩展** adds a tab alongside DSH's official plugin pages for Cordis npm plugins (awesome-dsh-plugin marketplace, profile inventory, and npm updates) and Agent capability packs (builtin catalog → `~/.dsh/agent-plugins`). Shared top search. Agent packs mount hosted MCP tools/skills on enable without a DSH restart; Cordis installs and updates require a restart. The official Plugin list and the DSH v0.1.6-alpha.2+ sidebar plugin manager remain available.

### [@just-genius/dsh-quick-notes](plugins/dsh-quick-notes)

随手笔记: floating sticky-note cards over the shell, with a search overlay (**Mod+Shift+F**; **Mod+Shift+N** opens a new note). Cards are WYSIWYG — `# ` becomes a heading as you type, `- [ ]` a real checkbox, a GFM table stays an editable table — while the note on disk stays plain Markdown. A model round mints a title and up to 3 tags; renaming by hand freezes further AI overwrites. **Settings → 随手笔记** manages the library (search, tags, pin / archive / delete, bulk actions). Notes are global rather than per-workspace, under `$DSH_HOME/quick-notes`, and every write is atomic (temp file + rename).

### [dsh-synapse](plugins/dsh-synapse)

A visual, non-linear conversation workspace (vendored from [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) 0.4.1): the sessions, follow-ups, and forks of one workspace drawn as a draggable, zoomable map, reached from the top-level **会话地图** switch and served at `/synapse`. DSH's session log stays the single source of truth — Synapse projects committed events only, connects cards by the real fork edges instead of building a second history, and keeps its canvas layout in `$DSH_HOME/synapse/`, so deleting that directory never deletes a session. A card can also save its answer into a 随手笔记 note. Web profile only, reusing the existing DSH server. It is the one plugin that is plain root-level JS (`index.js` / `client.js` / `app.js`, built with `node --check`) — no `@just-genius` scope, no shared runtime, no `typecheck`.

### [@just-genius/dsh-whale-girl](plugins/dsh-whale-girl)

Desktop pet (whale-girl). In a plain browser it is the in-page companion; in DSH-Desktop it opens a transparent always-on-top overlay via `window.dshDesktop.overlays` so the pet sits on the OS desktop.

## Shared packages

[`packages/runtime`](packages/runtime) (`@just-genius/dsh-plugin-runtime`) is the
only package that directly adapts official DSH host/client APIs. All plugins
depend on this boundary instead of importing `@deepseek-ai/*` packages or
pinning their versions independently.

[`packages/agent-plugin`](packages/agent-plugin) (`@just-genius/dsh-agent-plugin`) is the
pure logic for Agent capability packs: manifest validation, variable substitution,
hosted MCP HTTP, OAuth, and install/enable/disable state. Host UI lives in
`dsh-plugin-config`.

[`packages/ui`](packages/ui) (`@just-genius/dsh-plugin-ui`) ships DSH `--dsw-*` theme tokens plus React primitives (`Button`, `Input`, `Menu`, `Modal`, Markdown, confirmation and toast UI) and settings chrome. Plugins bundle it at build time; standalone apps (e.g. Vellum) can depend on it via `file:` / npm and call `installTheme()` once at boot. See [packages/ui/README.md](packages/ui/README.md).

Official DSH contracts are pinned at the shared boundary to the newest tested
published APIs (`0.1.1-rc.2` at this migration).

## Repository layout

```
DSH-Plugs/
├── package.json          # root workspace (shared build/type toolchain)
├── pnpm-workspace.yaml   # packages: ['plugins/*', 'packages/*']
├── tsconfig.base.json    # shared TS config
├── packages/
│   ├── runtime/          # @just-genius/dsh-plugin-runtime
│   ├── agent-plugin/     # @just-genius/dsh-agent-plugin (Agent pack logic)
│   └── ui/               # @just-genius/dsh-plugin-ui
└── plugins/
    └── <plugin>/         # one plugin per folder
```

## What a plugin is

A plugin is a Cordis plugin npm package split in two halves:

| Half | Source | Output | Role |
| --- | --- | --- | --- |
| node | `src/index.ts` | `lib/index.js` | Host entry (usually an empty `apply` for pure UI plugins) |
| browser | `src/client/index.tsx` | `lib/client.js` | Browser entry, registered via `window.__ModuleLoader__.load({ id, factory })`, mounting React UI with `ctx.slots.register` in `apply` |

Two key declarations in `package.json`:

- `dsh.client` — declares the browser-side injection (`inject` lists the client package names it depends on; `platform: web`).
- `dsh.bundle.patch` — points at `cordis.patch.yml`, so installing the package automatically inserts its loader row into the profile.

## Develop

```sh
pnpm install      # install dependencies
pnpm build        # build all plugins (src → lib)
pnpm watch        # watch and rebuild
pnpm typecheck    # type-check
pnpm clean        # remove all lib/
```

## Adding a plugin

Before creating a plugin, follow the dependency rule in [`AGENTS.md`](AGENTS.md).

## Installing a plugin

```sh
# Link a local folder into the profile (relative paths anchor to the current directory)
dsh plugin --profile web add ./plugins/dsh-codex
```

Because the package declares `dsh.bundle.patch`, it joins the profile's bundle layer automatically on install; **restart DSH web** (a plain refresh is not enough for bundle-stack changes).

Uninstall:

```sh
dsh plugin --profile web remove @just-genius/dsh-codex
```
