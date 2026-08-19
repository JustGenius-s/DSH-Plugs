# @just-genius/dsh-whale-girl

DSH 桌面宠物（鲸鱼娘）：浏览器里是页面内悬浮宠物；在 DSH-Desktop 里走 `window.dshDesktop.overlays`，开一扇透明置顶窗常驻操作系统桌面。不必再单独打包 Tauri/Electron 伴侣。

- Host：账本（XP/称号/回忆）、`/whale-girl/state|events|interact|presence|config|assets|overlay`
- Client：探测 `dshDesktop.overlays` → 打开 `/whale-girl/overlay`；普通浏览器回退页面内宠物
- Overlay 在线时 `POST /presence`，网页端宠物因 `companionOnline` 自动隐藏
- 设置：Settings → Plugins 里有「桌面宠物」卡片（显示/游走/尺寸/透明度/打盹），和更新插件同一位置

素材与状态机来自 [whale-girl](https://github.com/vlln/whale-girl)（MIT，角色形象 ZipZipPipe）。本插件不启动独立 Tauri/Electron 伴侣。

## 安装

```bash
pnpm install && pnpm --filter @just-genius/dsh-whale-girl build
dsh plugin --profile web add ./plugins/dsh-whale-girl
```

装完重启 web。Desktop 里会看到桌宠；浏览器里仍是右下角页面宠物。
