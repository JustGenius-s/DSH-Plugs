# @just-genius/dsh-wechat-chat

Turn the DeepSeek Harness web surface into a **WeChat-style chat**.

Sessions become chats. The other side talks like a person in WeChat: short
bubbles, progress tips while tools run, and a typing indicator — not a long
agent transcript.

## What you get

- **WeChat desktop chrome**: dark icon rail, chat list, beige thread, green
  send button, green/white bubbles with tails.
- **Human progress**: tool calls render as gray center tips (`正在看 package.json`),
  assistant text splits on blank lines into multiple bubbles, and a live
  “对方正在输入” row appears while the agent is working.
- **Host persona**: the plugin registers a system-prompt section so the model
  texts short updates as it works, instead of dumping one essay.
- **Approvals / questions**: WeChat cards with Allow / Decline (and option
  buttons for ask-user questions).
- **Escape hatch**: 我 → 切换回经典界面. A green WeChat FAB brings the skin back.

## How it works

| Half | Role |
| --- | --- |
| Host `src/index.ts` | `ctx.systemPrompt.section({ name: 'wechat:chat-persona' })` |
| Browser `src/client/index.tsx` | Full-viewport occupant of `shell.overlay` |

The overlay is `position: fixed; inset: 0` with pointer events, so the official
three-column shell stays mounted underneath (settings and composer keep their
identity) but is covered while the skin is on.

## Development

```bash
pnpm build && pnpm typecheck
```

Then add it to the web profile (restart required after the first install):

```bash
# from this monorepo
# 1. link the package in ~/.dsh/profiles/web/package.json
# 2. pnpm install in that profile
# 3. restart DSH web, then refresh http://127.0.0.1:62320
```

## Install via LLM

```text
帮我安装本地插件 @just-genius/dsh-wechat-chat 到 DSH 的 web profile。

插件源码在 <this-repo>/plugins/dsh-wechat-chat（host 半边会注册 system prompt，
client 半边用 shell.overlay 画微信壳，无需 disable 官方插件）。

步骤：
1. 先在插件目录执行 pnpm build。
2. 编辑 ~/.dsh/profiles/web/package.json：
   - dsh.profile.bundles 数组加入 "@just-genius/dsh-wechat-chat"；
   - dependencies 加入 "@just-genius/dsh-wechat-chat":
     "link:<this-repo>/plugins/dsh-wechat-chat"。
3. 在 ~/.dsh/profiles/web 目录执行 pnpm install。
4. 重启 DSH web（改了 bundle 栈，刷新页面不够，必须重启）。

验证：重启后整个界面应变成微信桌面样式；发一条需求，对面会用短气泡边做边汇报。
右下角「我」可以切回经典界面。
```
