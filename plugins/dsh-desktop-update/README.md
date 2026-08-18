# @just-genius/dsh-desktop-update

DSH-Desktop 的更新插件：侧栏徽章 + 原生菜单/托盘 + 系统通知，数据来自
DSH-Desktop preload 暴露的三族 API `window.dshDesktop`
（`updates` / `seats` / `notify`）。契约见 DSH-Desktop `docs/desktop-api.md`。

- 浏览器半侧注册 `sidebar.footer.action` 列表 slot 条目。
- 桌面壳里走 `updates` 检查/下载/升级/重启；向 `seats` 贡献
  `applicationMenu` / `tray`；有更新时用 `notify.show` 弹系统通知。
- 插件卸载时 `revoke` 席位并 `notify.close`。
- 普通浏览器没有 `window.dshDesktop`，插件保持惰性。

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
