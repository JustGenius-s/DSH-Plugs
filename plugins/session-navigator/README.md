# @just-genius/dsh-session-navigator

Codex 风格的会话消息导航轨道（message navigator rail），挂在 DSH 网页会话面板。

## 现状：可运行的骨架

当前是「可运行的骨架」：在输入区下方（`conversation.composer.dock` 插槽）渲染一条
proof-of-life 读数，证明整条链路已打通 —— tsdown 构建、`dsh.client` 注入、
`ctx.slots.register` 挂载、React 渲染。

## 路线图（下一步）

参考 `/Users/morisi/Space/e-pi` 的 `MessageNavigator`，在会话 transcript 左侧渲染一条
竖向导航轨道：

- 每个用户消息一条刻度条，刻度条聚集在轨道中部；
- 视口顶部的消息高亮，hover 拉长并显示该消息标题；
- 点击跳转到对应消息。

## 开发

```bash
pnpm build && pnpm typecheck
dsh plugin --profile web add ./plugins/session-navigator
```
