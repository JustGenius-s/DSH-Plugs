# @just-genius/dsh-desktop-update

DSH-Desktop 的更新徽章插件：在 Web 侧栏设置按钮旁渲染更新图标，数据来自
DSH-Desktop preload 暴露的 `window.dshDesktop`（Electron contextBridge）。

- 纯客户端插件：host 半侧为空（只为出现在 Loader 树里），浏览器半侧注册
  `sidebar.footer.action` 列表 slot 条目。
- 在普通浏览器（无 `window.dshDesktop`）中不渲染任何内容，插件保持惰性。
- 支持的操作：App 本体跳 GitHub Releases 下载、DSH 运行时就地升级（pnpm）
  + 重启生效、「跳过该版本」（出现更新的版本后自动恢复提示）。

## 安装

通常由 DSH-Desktop 主进程自动完成（scripts/install-desktop-plugin.mjs，
npm 优先、本目录源码回退）。手动安装：

```bash
pnpm install && pnpm build
# 在 ~/.dsh/profiles/web/package.json 中：
#   dsh.profile.bundles 加 "@just-genius/dsh-desktop-update"
#   dependencies 加 "@just-genius/dsh-desktop-update": "link:<本目录>"
```

禁用：在 `~/.dsh/cordis.patch.yml` 加 `- id: desktop-update\n  disabled: true`。
