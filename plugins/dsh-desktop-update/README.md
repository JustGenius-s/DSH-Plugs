# @just-genius/dsh-desktop-update

Update badge for [DSH-Desktop](https://github.com/JustGenius-s/DSH-Desktop): a sidebar badge plus native menu/tray seats and system notifications, all driven by the `window.dshDesktop` preload bridge (`updates` / `seats` / `notify`). The contract lives in DSH-Desktop's `docs/desktop-api.md`.

## Features

- **Update detection lives here** — the Host half queries GitHub Releases and the npm registry, compares versions, and polls every 6 hours. It runs in the dsh web host's Node process, so there is no CORS problem and detection continues with no window open. (It used to live in DSH-Desktop's Electron main process.)
- **Same-origin routes** — `/dsh-desktop-update/{state,check,version,exec,skip}`; the browser half polls them.
- **Two update channels** — app updates jump to GitHub Releases; DSH runtime updates install in place (pnpm) and ask for a restart.
- **Version skipping** — skip a version and the prompt returns only when a newer one appears; stored in `~/.dsh/desktop-update-skip.json`.
- **Native seats** — contributes `applicationMenu` / `tray` entries and fires `notify.show` system notifications when an update lands.
- **Graceful degradation** — in a plain browser (no shell) detection still runs and the state is served; only the execute actions sit out.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host entry: owns the `desktop-update` settings namespace, detection scheduling, and the five routes |
| `src/updater.ts` | The detector: version comparison, GitHub Releases + npm registry fetches, skip records |
| `src/shared.ts` | Contract shared by both halves (route paths, `DesktopUpdateState`) |
| `src/client/update-store.ts` | Polls the Host's state, reports the shell's version and execute outcomes |
| `src/client/bridge.ts` | Typed wrapper over `window.dshDesktop` (shell executes only), with presence detection |
| `src/client/seats.ts` | Menu/tray seat contributions, revoked on dispose |
| `src/client/card.tsx`, `src/client/index.tsx` | The settings card, registered into the `settings.plugin.item` slot |

## Division of labour

Detection belongs to the Host half; **execution belongs to the desktop shell**, because only a
packaged app can report its own version, run `pnpm add`, open the download page, and relaunch.
DSH-Desktop 0.2.0's `window.dshDesktop.updates` is therefore execute-only
(`appVersion` / `downloadApp` / `updateDsh` / `relaunch`).

The browser half is the only place that can reach both sides, so it shuttles the two facts
neither half can obtain alone:

- **the shell's packaged version** → `POST /dsh-desktop-update/version` — detection needs it to
  decide whether an App update exists;
- **an execute outcome** → `POST /dsh-desktop-update/exec` — so progress is shared across windows
  and survives a page reload.

The plugin depends on the bridge **contract**, not on Electron packaging code, so the desktop shell can evolve independently. On unmount it revokes its seats, closes notifications, and stops polling.

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
