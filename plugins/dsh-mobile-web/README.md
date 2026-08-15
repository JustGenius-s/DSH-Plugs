# @just-genius/dsh-mobile-web

Makes the DeepSeek Harness (DSH) web UI usable on phones. The official shell
already auto-collapses the sidebar below 1024px into a 56px rail — that still
eats a phone-width column and expands by squeezing the chat. This plugin turns
that rail into a drawer, overlays the details pane, and adds a hamburger.

## What it changes

- **Sidebar drawer** — below 768px (or any coarse-pointer viewport ≤ 1024px)
  the left column leaves the grid and slides in over the chat.
- **Hamburger + backdrop** — `shell.overlay` chrome; tap the dimmer, swipe
  left, or press Escape to close. Swipe from the left edge to open.
- **Details overlay** — the right column becomes a full-screen sheet instead
  of a 300px+ third column.
- **Safe areas & keyboard** — `viewport-fit=cover`, `100dvh` /
  `visualViewport` height, and 16px inputs so iOS does not zoom on focus.
- **Auto-close** — selecting another session or opening a dialog closes the
  drawer.

Desktop layout is unchanged. The plugin does not replace AppFrame, sidebar, or
conversation — it only injects CSS and overlay chrome.

## Development

```bash
pnpm build && pnpm typecheck
dsh plugin --profile web add ./plugins/dsh-mobile-web
```

Restart the web profile after install, then refresh (or use phone-width
DevTools). Client-plugin HMR still needs `pnpm run dev:web` from the DSH
checkout; this package is a linked plugin, so rebuild + refresh after edits.

## Install via LLM

```text
帮我安装本地插件 @just-genius/dsh-mobile-web 到 DSH 的 web profile。

插件源码在 <this-repo>/plugins/dsh-mobile-web（纯 client-UI 插件，
不 fork 官方功能，无需 disable 任何官方插件）。

步骤：
1. 在仓库根目录执行 pnpm install && pnpm --filter @just-genius/dsh-mobile-web build
2. dsh plugin --profile web add ./plugins/dsh-mobile-web
3. 重启 DSH web（改了 bundle 栈，刷新页面不够，必须重启）。

验证：用手机宽度打开 Web UI，左侧 56px 轨应消失，左上角出现汉堡按钮，
点开后侧栏以抽屉盖在对话上，点遮罩关闭。
```
