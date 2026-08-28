<h1 align="center">DSH-Plugs</h1>

<p align="center">
  A monorepo of plugins for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (DSH) — one folder = one plugin.
</p>

## Plugins

### [@just-genius/dsh-codex](plugins/dsh-codex)

The consolidated Codex shell: Codex-style message navigation, Cursor-style per-turn **Worked for** collapsing, a right-side `side.panel` host with a file tree / preview / diff view (VSCode Light+/Dark+ syntax themes), a Warp-style terminal panel backed by a real login-shell PTY, and a read-only git commit-graph panel.

### [@just-genius/dsh-debug-mode](plugins/dsh-debug-mode)

Cursor-style debug mode: `/debug`, a red Debug chip, a Debug Logs dock above the composer, and a reproduction-steps card with **Proceed** / **Mark as fixed**. Mode/wait/logs stay in process memory for the live session only (not written to the durable session log).

### [@just-genius/dsh-memory](plugins/dsh-memory)

Global markdown memory: **Settings → Memory** for manual CRUD, `memory_propose` for AI writes that wait for user confirmation, and enabled entries injected into the system prompt. Stored under `~/.dsh/memory/` as `index.json` + `entries/*.md`.

### [@just-genius/dsh-sync](plugins/dsh-sync)

GitHub Device Flow + secret Gist config sync: **Settings → Sync** pushes/pulls `settings.yaml` and the web plugin list (portable specs + `cordis.patch.yml`) with no self-hosted sync server. State lives in `~/.dsh/sync/state.json`.

### [@just-genius/dsh-desktop-update](plugins/dsh-desktop-update)

Update badge for [DSH-Desktop](https://github.com/JustGenius-s/DSH-Desktop) next to the sidebar Settings button, driven by the `window.dshDesktop` Electron bridge. App updates jump to GitHub Releases; DSH runtime updates install in place. Renders nothing in a plain browser.

### [@just-genius/dsh-model-custom-ex](plugins/dsh-model-custom-ex)

Replaces the official Models settings page (fork of `ui-settings-models`) to add per-model dropdown multi-selects for **vision** (`input`) and **thinking strength** (`reasoningEfforts`) — the two controls the stock page punts to `settings.yaml`.

### [@just-genius/dsh-plugin-config](plugins/dsh-plugin-config)

**Settings → 插件管理** in one tab: collapsible installed inventory (group by origin / mount plane, enable·disable·uninstall) plus the [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) marketplace. Shared top search. Replaces the official read-only Plugin list.

### [@just-genius/dsh-wechat-chat](plugins/dsh-wechat-chat)

Turns the web surface into a WeChat-style messenger: chat list, green/white bubbles, and an agent that texts short progress updates while it works. Switch back from 我.

### [@just-genius/dsh-whale-girl](plugins/dsh-whale-girl)

Desktop pet (whale-girl). In a plain browser it is the in-page companion; in DSH-Desktop it opens a transparent always-on-top overlay via `window.dshDesktop.overlays` so the pet sits on the OS desktop.

## Shared packages

[`packages/runtime`](packages/runtime) (`@just-genius/dsh-plugin-runtime`) is the
only package that directly adapts official DSH host/client APIs. All plugins
depend on this boundary instead of importing `@deepseek-ai/*` packages or
pinning their versions independently.

[`packages/ui`](packages/ui) (`@just-genius/dsh-plugin-ui`) ships DSH `--dsw-*` theme tokens plus React primitives (`Button`, `Input`, `Menu`, `Modal`, Markdown, confirmation and toast UI) and settings chrome. Plugins bundle it at build time; standalone apps (e.g. Vellum) can depend on it via `file:` / npm and call `installTheme()` once at boot. See [packages/ui/README.md](packages/ui/README.md).

Official DSH contracts are pinned at the shared boundary to the newest tested
published APIs (`0.1.1-rc.2` at this migration). See
[`DEPENDENCY_POLICY.md`](DEPENDENCY_POLICY.md) for the upgrade and bundle rules.

## Repository layout

```
DSH-Plugs/
├── package.json          # root workspace (shared build/type toolchain)
├── pnpm-workspace.yaml   # packages: ['plugins/*', 'packages/*']
├── tsconfig.base.json    # shared TS config
├── packages/
│   ├── runtime/          # @just-genius/dsh-plugin-runtime
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

1. Copy a `plugins/*` folder and rename it to your plugin name.
2. Set `package.json`'s `name` (keep the `@just-genius/dsh-*` prefix).
3. Edit `src/index.ts` (node half) and `src/client/index.tsx` (browser half).
4. `pnpm build`.

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
