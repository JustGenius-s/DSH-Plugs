# @just-genius/dsh-session-navigator

A Codex-style message navigator rail for the DeepSeek Harness (DSH) web surface:
a vertical tick rail on the left edge of the conversation transcript, one tick
per user message. It shows where you are in a long session and jumps to any
message in one click.

## Features

- **One tick per user message**, clustered in a fixed rail on the transcript's
  left edge.
- **Active indicator** — the tick whose message sits at the top of the viewport
  is highlighted in the brand color (same size, different color).
- **Stepped hover** — hovering a tick elongates it with a stepped gradient across
  its neighbors, highlights it, and shows the message text in a tooltip.
- **Smooth jump** — clicking a tick smoothly scrolls to that message, leaving a
  small margin above it (`JUMP_MARGIN`).
- **Continuous hit areas** — each tick has a 16px transparent hit target that
  overlaps its neighbors, so there are no dead zones between ticks.

## How it works

The plugin is a Cordis client-UI plugin. Its browser half registers into the
`conversation.chat.turnTail` slot (session-scoped, so it receives the
conversation snapshot through `useSession`), reads the ordered user-message
nodes (`chat.order` + `chat.nodes`, filtering `kind === "user"`), and
renders one `position: fixed` rail (ported to `document.body`) per session.

It locates the conversation scrollport via the `[data-conversation-scroll]`
anchor and each message row via `[data-chat-anchor-key]`, measures each
message's content offset, tracks `scrollTop` through scroll / resize /
`MutationObserver` listeners, and jumps with an rAF-driven animation.

## Development

```bash
pnpm build && pnpm typecheck
dsh plugin --profile web add ./plugins/session-navigator
```

Restart the web profile (or the DSH app) after rebuilding, then refresh the page.

## Install via LLM

Paste this prompt into a DSH agent and it will install the plugin for you
(adjust the source path if your checkout lives elsewhere):

```text
帮我安装本地插件 @just-genius/dsh-session-navigator 到 DSH 的 web profile。

插件源码在 /Users/morisi/Space/DSH-Plugs/plugins/session-navigator（纯 client-UI 插件，
不 fork 官方功能，无需 disable 任何官方插件）。

步骤：
1. 编辑 ~/.dsh/profiles/web/package.json：
   - dsh.profile.bundles 数组加入 "@just-genius/dsh-session-navigator"；
   - dependencies 加入 "@just-genius/dsh-session-navigator":
     "link:/Users/morisi/Space/DSH-Plugs/plugins/session-navigator"。
2. 在 ~/.dsh/profiles/web 目录执行 pnpm install。
3. 重启 DSH web（改了 bundle 栈，刷新页面不够，必须重启）。

验证：重启后打开一个会话，对话记录左侧应出现一条竖向的 tick 导航条，
每个用户消息一个刻度，点击可跳转到该消息。

注意：写 ~/.dsh/profiles/web 需要 danger-full-access 权限；
遇到 sandbox 拒绝时，用 sandbox_permissions 重试一次即可。
```
