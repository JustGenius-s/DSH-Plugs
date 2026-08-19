# @just-genius/dsh-debug-mode

Cursor-style debug mode for DeepSeek Harness: a `/debug` collaboration mode, a Debug chip, a Debug Logs dock, and a reproduction-steps card with **Proceed** / **Mark as fixed**.

This is the first slice — the human-in-the-loop shell. The agent still instruments by editing files and calling `debug_log`; there is no automatic language-runtime probe bus yet.

## What you get

- **`/debug` / `/debug off`** — same shape as `/plan`. Optional message after `/debug` is submitted as the next user turn under debug guidance.
- **Debug chip** — red pill in the composer tool row while debug mode is the effective target. Clicking it runs `/debug off`.
- **Debug Logs dock** — sits above the composer while debug mode is on. Read-only evidence from `debug_log` (and later runtime ingest).
- **Reproduction card** — shown when the model calls `wait_for_repro`. Follow the steps, then **Proceed** or **Mark as fixed**. Extra notes go in the composer; those buttons attach the current draft.

## Tools

| Tool | When |
| --- | --- |
| `wait_for_repro` | Pause until the user finishes the listed steps |
| `debug_log` | Append one line to the Debug Logs dock |

## Install

```bash
cd plugins/dsh-debug-mode && pnpm install && pnpm run build
```

Then add it to the web profile (restart required after the first install):

```text
帮我安装本地插件 @just-genius/dsh-debug-mode 到 DSH 的 web profile。

插件源码在 <this-repo>/plugins/dsh-debug-mode。

步骤：
1. 先在插件目录执行 pnpm build。
2. 编辑 ~/.dsh/profiles/web/package.json：
   - dsh.profile.bundles 数组加入 "@just-genius/dsh-debug-mode"；
   - dependencies 加入 "@just-genius/dsh-debug-mode":
     "link:<this-repo>/plugins/dsh-debug-mode"。
3. 在 ~/.dsh/profiles/web 目录执行 pnpm install。
4. 重启 DSH web（改了 bundle 栈，刷新页面不够，必须重启）。

验证：composer 输入 /debug，应出现红色 Debug 徽章和 Debug Logs 面板。
```
