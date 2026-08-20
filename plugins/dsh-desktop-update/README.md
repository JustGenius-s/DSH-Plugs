# @just-genius/dsh-desktop-update

Update badge for [DSH-Desktop](https://github.com/JustGenius-s/DSH-Desktop): a sidebar badge plus native menu/tray seats and system notifications, all driven by the `window.dshDesktop` preload bridge (`updates` / `seats` / `notify`). The contract lives in DSH-Desktop's `docs/desktop-api.md`.

## Features

- **Sidebar badge** — quiet question-mark idle state that opens version info and auto-check gates; turns into an accent arrow when an update is available.
- **Two update channels** — app updates jump to GitHub Releases; DSH runtime updates install in place (pnpm) and ask for a restart.
- **Version skipping** — skip a version and the prompt returns only when a newer one appears.
- **Native seats** — contributes `applicationMenu` / `tray` entries and fires `notify.show` system notifications when an update lands.
- **Graceful degradation** — in a plain browser (no bridge) the plugin renders nothing.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host entry (no-op; the plugin is client-only) |
| `src/client/bridge.ts` | Typed wrapper over `window.dshDesktop`, with presence detection |
| `src/client/seats.ts` | Menu/tray seat contributions, revoked on dispose |
| `src/client/card.tsx`, `src/client/index.tsx` | The badge UI, registered into the `sidebar.footer.action` slot |

The plugin depends on the bridge **contract**, not on Electron packaging code, so the desktop shell can evolve independently. On unmount it revokes its seats and closes notifications.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

Usually installed automatically by DSH-Desktop's main process (`scripts/install-desktop-plugin.mjs`, npm first with a local-source fallback). Manual install:

```sh
dsh plugin --profile web add ./plugins/dsh-desktop-update
```

To disable without uninstalling, add `- id: desktop-update\n  disabled: true` to `~/.dsh/cordis.patch.yml`.
