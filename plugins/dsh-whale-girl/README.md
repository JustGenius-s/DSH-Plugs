# @just-genius/dsh-whale-girl

Desktop pet (whale-girl) for DSH. In a plain browser it is an in-page floating companion; in [DSH-Desktop](https://github.com/JustGenius-s/DSH-Desktop) it opens a transparent always-on-top overlay via `window.dshDesktop.overlays`, so the pet sits on the OS desktop — no separate Tauri/Electron companion app to package.

Assets and the state machine come from [whale-girl](https://github.com/vlln/whale-girl) (MIT; character design by ZipZipPipe).

## Features

- **Two runtimes, one plugin** — the client probes `dshDesktop.overlays`; when present it opens the overlay window at `/whale-girl/overlay`, otherwise it falls back to the in-page pet.
- **Presence heartbeats** — while the overlay is online it POSTs to `/whale-girl/presence`, and the in-page pet hides itself (`companionOnline`) so the two never appear at once.
- **Persistent ledger** — XP, titles, and memories are kept host-side (`/whale-girl/state|events|interact`).
- **Settings card** — Settings → Plugins gets a 桌面宠物 card (visibility, roaming, size, opacity, napping), next to the update plugin's entry.

## Design

| Half | Role |
| --- | --- |
| host `src/index.ts` | Ledger + routes: `state` / `events` / `interact` / `presence` / `config` / `assets` / `overlay` |
| client `src/client/**` | Overlay detection, in-page pet, settings card |

The host serves the overlay page and the pet assets, so the transparent desktop window is just another browser view of the same plugin — state stays in one place.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-whale-girl
```

Restart DSH web. In DSH-Desktop the pet appears on the OS desktop; in a plain browser it stays in the bottom-right corner of the page.
