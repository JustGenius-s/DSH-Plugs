# DSH 0.2.0 升级启动修复

日期：2026-09-29。实际运行时：`@deepseek-ai/dsh@0.2.0-rc.1`。

## 原因

`dsh-client-shortcuts` 根据 `document.documentElement.dataset.platform` 判断
desktop/web。DSH-Desktop 为 macOS 布局设置了 `darwin`，但尚未提供新版官方
`window.dshDesktop.keyboard` 和 `window.dshDesktop.shortcuts` 接口。
新服务构造时抛出 `Desktop keyboard bridge unavailable`，导致 layout、workspace、
sidebar 等依赖链阻塞，共显示 30 个未激活条目。

## 已应用的修复

`scripts/repair-dsh-shortcuts.mjs` 修改本机运行时的 shortcuts 客户端：仅当两个
原生接口都不存在时，使用上游已有的 web 键盘和 localStorage 适配器。
保留 `data-platform=darwin`，不影响窗口红绿灯避让、拖拽区域和桌面布局。
具备原生接口的壳保持 desktop 行为；部分接口损坏仍报告原有错误。

补丁严格限定 `0.2.0-rc.1`，验证源码锚点，重复执行无变化，先备份再原子替换，
避免修改 pnpm 共享存储中的硬链接。原文件备份在目标 `lib/client.js` 同目录的
`client.js.before-desktop-compat`。

```sh
node scripts/repair-dsh-shortcuts.mjs
# 非默认 runtime 可将根目录作为第一个参数传入。
DSH_RUNTIME_ROOT="$HOME/.dsh/runtime" node --test packages/runtime/test/shortcuts-compat-host.test.js
```

更新或重装运行时可能覆盖补丁。相同版本可重跑脚本；其他版本会拒绝修改，需要重新
检查其接口。长期应在 DSH-Desktop 接入完整的官方原生键盘和快捷键持久化协议。
当前使用 web 快捷键配置与组合限制，不提供原生菜单或内嵌页面的键盘转发。
设置存储沿用上游 web 的 origin 范围，服务端口改变时不会自动迁移。

## 验证结果

- 使用本机官方客户端模块，在 Node VM 中复现原始构造异常。
- 补丁后旧桌面壳和普通 web 均初始化成功，配置进入 ready，并能保存快捷键。
- 完整原生壳仍使用 desktop 适配器；补丁幂等性及未知源码拒绝检查通过。
- 完整退出并重开 `/Applications/DSH-Desktop.app` 后，原生窗口可见正常主界面、
  工作区和历史会话、会话内容、模型选择器及消息输入框。未发送测试消息。
- 本次只做必要的桌面启动验收，没有打开额外浏览器做端到端测试。

## 独立的旧插件兼容告警

启动日志还显示以下插件被新版依赖兼容检查跳过，未修改其版本或给予豁免：

- `@tencent/dsh-tencent@0.1.0`
- `@deepseek-ai/dsh-browser-use@0.1.7-alpha.2`
- `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.7-alpha.2`
- `@deepseek-ai/dsh-computer-use@0.1.7-alpha.2`
- `@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.7-alpha.2`

这些功能需另行适配 0.2.0；本次正常启动验证不代表这些被跳过的能力已恢复。

后续更新（2026-09-29）：`@tencent/dsh-tencent` 已对齐 0.2.0-rc.1 依赖并重新构建，
重启后“设置 → 腾讯”和代理健康接口已恢复。详情见
`/Users/jiahaoqian/proj/dsh-tencent/docs/dsh-0.2.0-restoration-2026-09-29.md`。
浏览器／电脑控制插件不在该次恢复范围内。
