# @just-genius/dsh-wechat-chat

Turns the DSH web surface into a **WeChat-style chat**: sessions become chats, and the agent talks like a person — short bubbles, progress tips while tools run, and a typing indicator instead of a long transcript.

## Features

- **WeChat desktop chrome** — dark icon rail, chat list, beige thread, green send button, green/white bubbles with tails.
- **Human progress** — tool calls render as gray center tips (`正在看 package.json`), assistant text splits on blank lines into multiple bubbles, and a live "对方正在输入" row appears while the agent works.
- **Host persona** — a registered system-prompt section makes the model text short updates as it works instead of dumping one essay.
- **Approvals / questions** — WeChat cards with Allow / Decline, and option buttons for ask-user questions.
- **Escape hatch** — 我 → 切换回经典界面; a green WeChat FAB brings the skin back.

## Design

| Half | Source | Role |
| --- | --- | --- |
| host | `src/index.ts`, `src/wechat-prompt.ts` | `ctx.systemPrompt.section({ name: 'wechat:chat-persona' })` |
| client | `src/client/index.tsx`, `src/client/WeChatApp.tsx` | Full-viewport occupant of `shell.overlay` |

The overlay is `position: fixed; inset: 0` with pointer events, so the official three-column shell stays mounted underneath (settings and composer keep their identity) but is covered while the skin is on — no official plugin needs disabling.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-wechat-chat
```

Restart DSH web after the first install. Verify: the whole UI becomes the WeChat desktop skin; send a request and the other side reports progress in short bubbles. The 我 button in the corner switches back to the classic UI.
