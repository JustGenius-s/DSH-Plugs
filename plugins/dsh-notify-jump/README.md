# @just-genius/dsh-notify-jump

Two client-only extras on top of `dsh-notification`:

1. **Jump** — click a system banner tagged `dsh-notification-<sessionId>` to focus the window **and** `sessions.open` that session. `dsh-notification`'s own `onclick` only calls `window.focus()`.
2. **Pending waits** — when a listed session enters `approval`, `question` (ask), or `plan-review`, show a system notification (same tag, so click still jumps). First list snapshot and reconnect replay seed the baseline and do not fire.

Settings-page test pings (`dsh-notification-test`) do not jump. Subagent rows are skipped. No banner while you are already looking at that session with the page visible.

Install next to `dsh-notification`:

```sh
dsh plugin --profile web add ./plugins/dsh-notify-jump
```

Restart the web profile after the first install (bundle-stack change). Later client rebuilds need a page refresh.
