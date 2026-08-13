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
