# @just-genius/dsh-session-archive

**Settings → 会话归档**: archived sessions grouped by workspace. Each row can be
**restored** (取消归档) or **deleted** (删除, asking for a second click). Sidebar
**归档会话** stays one-click (no confirm dialog).

Loading belongs to the row being acted on, not to the page: a restore or a
delete shows its progress in that row's own button, leaves every other row
usable, and only counts as finished once the refreshed list arrives. A failed
action reports inside its row. Re-reading the list never blanks the page — rows
are replaced only when fresh data arrives.

On DSH 0.1.7, the official archive view is the sidebar's **视图选项 →
显示已归档／仅显示已归档** filter, where archived sessions can be restored.
DSH does not register a separate official archive settings page. Disabling
this plugin removes its **Settings → 会话归档** page; the sidebar filter remains.
Permanent deletion of archived sessions is available only while this plugin
is enabled. The bundle patch only inserts this plugin; it does not disable or
restore an official settings page.

## Actions

| Action | Endpoint | Effect |
|---|---|---|
| List | `GET /dsh-session-archive/list` | Archived sessions joined with their workspace, title, and last activity |
| Unarchive | `POST /dsh-session-archive/unarchive` | Drops the id from the registry-global archive set; the workspace accounting slot was never touched, so the session returns to its recorded position |
| Delete | `POST /dsh-session-archive/delete` | Detaches the session from its workspace and removes its log directory — permanent |

Unarchive is idempotent: an id that is not archived resolves without writing.

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-session-archive
```

Restart DSH web after install (bundle patch). Then open **Settings → 会话归档**.

## Development

```sh
pnpm --filter @just-genius/dsh-session-archive build
pnpm --filter @just-genius/dsh-session-archive typecheck
node --test plugins/dsh-session-archive/test/*.test.js
```

`src/client/view-state.ts` holds the row/list state machine as plain functions
(no React), which is what the tests exercise; `ArchiveSection.tsx` only renders
it.
