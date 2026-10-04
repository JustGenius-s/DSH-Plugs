# 基于 Cua MCP 的 session 级单应用画中画（PiP）插件可行性调研

日期：2026-09-17 · 环境：macOS 26.4 arm64 · Cua Driver 0.28.1 · DSH 0.1.6-alpha.1 · 仓库 DSH-Plugs

> 结论先行：**可行，且推荐「插件自渲染悬浮窗 + Cua capture-only 轮询」路线**。Cua 自带的 `experimental_pip` 是 daemon 全局的「最近一次动作后截图」小窗，不是 session 级、不是实时流，不能直接当 PiP 用，但它证明了捕获链路可用。DSH-Desktop 已有原生 always-on-top overlay 窗口 API（`window.dshDesktop.overlays`，whale-girl 在用），是 PiP 窗口的现成挂载点。对照 Codex Desktop 的 Computer Use PiP，我们要做的形态与其类似（悬浮、只读预览、随 session 生命周期），但可以避开它被用户诟病的几个坑。

---

## 1. 需求边界

「session 级单应用画中画」= 每个 DSH session 可以把「本 session 正在操作的那个应用窗口」的实时画面，以一个小悬浮窗呈现给用户；随 session 创建/切换/结束而开/切/关；只读预览为主，点击可跳转到目标应用。

注意与已有工作的区分：`docs/live-browser-side-panel-research-2026-09-16.md` / `docs/browser-observation-tab-design-2026-09-16.md` 覆盖的是 **Browser Use（CDP screencast）侧栏观察窗**；本文针对的是 **Cua MCP（OS 级窗口捕获）的单应用 PiP**，能力边界不同。

## 2. Cua 侧能力盘点（一手来源：本地二进制 + MCP 工具描述）

### 2.1 现成的 `experimental_pip`：能用，但不是 session 级

`cua-driver serve --help` 原文 [实测]：

```
--experimental-pip          Show a small always-on-top window with the latest
                            post-action screenshot + a 1-line label. macOS only
                            today; Win/Linux print a not-yet-implemented notice.
--experimental-pip-geometry WxH[+X+Y]   Override window size (and optional top-left
                            origin). Defaults to 480x360 in the top-right
                            corner of the main display.
```

MCP `set_config` 工具描述（`cua-driver describe set_config` [实测]）：

> "The experimental_pip keys are persisted to ~/.cua-driver/config.json and take effect on the next daemon restart (the PiP backend is initialised once at startup)."

关键限制：

- **更新机制是「post-action screenshot」**：每次动作类工具调用后刷新一帧 + 一行标签，不是定时流、不是视频。agent 不动它不动。
- **daemon 全局**：PiP backend 启动时初始化一次，全 daemon 一个窗口；没有 per-session / per-window 参数。多 session 并发时无法各自开窗。
- **macOS only**；开启要重启 daemon（会打断所有现存 MCP session 的授权态，此前 `revoke --all` 已教训过一次）。
- 配置持久化在 `~/.cua-driver/config.json`（当前内容仅 `{"telemetry_enabled": false}` [实测]）。

→ 结论：`experimental_pip` 适合作为「agent 在动」的最简指示器，**不满足** session 级、多实例、连续预览的需求。

### 2.2 正解：`get_window_state` 的 capture-only 路径

`get_window_state(pid, window_id, include_accessibility_tree:false, max_dimension:N)` 跳过 AX walk（最贵可达 20s），只返回截图 + `window_bounds` / `screenshot_scale` / `app_name` / `window_title`；`max_dimension` 压长边出缩略图。工具描述原文即定位为 "the capture-only path for rendering a live window preview / picture-in-picture without paying for perception" [实测，来自 `describe get_window_state`]。

实测延迟（CLI 一次性调用，含进程开销，目标为前台普通窗口，max_dimension=480）[实测]：

| 次数 | 耗时 |
|---|---|
| 1 | 0.76s |
| 2 | 0.16s |
| 3 | 失败："No content produced (neither AX tree nor screenshot succeeded)" |

→ 实际可用的轮询节奏约 **1–2 fps**（此前秒表监控已验证 30s 内 66 次采样 ≈2.2/s 可持续）。**必须容忍瞬时失败**（窗口切换/最小化动画期间捕获会失败，重试即可）。

其他相关能力：

- `list_windows` 返回含**离屏窗口**（最小化、其他 Space、隐藏启动）的 window_id、bounds、z_index、space_ids [实测，来自工具描述]——PiP 可以展示被最小化/遮挡的窗口，这正是 OS 级捕获相对 CDP 的独特价值。
- `zoom(window_id, x1,y1,x2,y2)` 返回窗口局部裁剪 JPEG（四边各加 20% padding）——可做「只看关键区域」模式。
- `start_recording(record_video:true)` 录的是**主屏整屏** mp4，不是单窗口，且依赖常驻 MCP session——不适合做 PiP 源 [实测，见此前 29s 录屏验证]。
- 错误面：`window_id_not_found`（窗口已销毁→需经 `list_windows` 重绑）、`window_owner_pid_mismatch`（如沙盒 app 的 Open/Save 面板属于面板服务进程）、`degraded_reason: ax_window_unresolved`（capture-only 路径不受影响）。

### 2.3 session 绑定

Cua MCP 支持显式 `session` 标签（同一 MCP 连接 + 每个调用带 `session` 参数），授权/grant 按 session 隔离；session 空闲 TTL 约 5 分钟 [实测]。DSH session ↔ Cua session 标签可以一一映射，插件 host 层按 DSH sessionId 持有轮询器即可。

## 3. Codex Desktop 的 PiP 对照（一手来源：openai/codex 仓库 issues）

Codex Desktop（macOS，用户报告版本 26.707.41301）确有 **Computer Use Picture in Picture**：

- **形态**：原生悬浮窗，与 pet/avatar overlay 共用同一套原生 presentation 基础设施；内部与 thread/browser/tab 标识关联（app 知道预览对应哪个 tab）；单击无响应、双击错误唤醒 pet（bug）；只读预览，不是可操作表面。([#33086](https://github.com/openai/codex/issues/33086))
- **实现**：随 bundled 插件 `computer-use@openai-bundled` 分发，helper 进程 `~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`；禁用该插件仍拦不住 PiP（Browser 呈现绕过插件开关）。([#32363](https://github.com/openai/codex/issues/32363))
- **触发**：Computer Use / Browser Use 开始时自动弹出；关闭只影响当次实例，下次又弹；早期版本无持久关闭设置，后续构建加入 "Always hide picture in picture"。([#32451](https://github.com/openai/codex/issues/32451)、[#33086](https://github.com/openai/codex/issues/33086))
- **已知问题**（用户痛点，我们应避开）：侧栏展开时 PiP 不避让、遮挡内容 ([#44026](https://github.com/openai/codex/issues/44026))；`visible:false` 下仍反复弹到聊天上方 ([#44448](https://github.com/openai/codex/issues/44448))；孤儿 mascot overlay 残留 ([#32363](https://github.com/openai/codex/issues/32363))；PiP 意外激活桌面 pet ([#44765](https://github.com/openai/codex/issues/44765))；Windows 上 PiP 失败可致 app 挂起 ([#32040](https://github.com/openai/codex/issues/32040))。

对我们的启示：① 悬浮窗要**可拖动、可持久关闭**（设置项持久化）；② 要有**明确的「点击回到目标应用」交互**（Codex 单击无响应被大量吐槽）；③ 生命周期必须挂在 session 上，session 结束即清理，不留孤儿窗；④ 自动弹出要谨慎，默认建议跟随用户显式开启。

## 4. DSH 侧挂载点盘点（一手来源：本仓库源码）

| 挂载点 | 出处 | 适配度 |
|---|---|---|
| **`window.dshDesktop.overlays`** 原生悬浮窗 | `plugins/dsh-whale-girl/src/client/bridge.ts:7-28`：`open({contributor,id,url,bounds,chrome:{transparent,frame,alwaysOnTop,skipTaskbar,resizable,ignoreMouseEvents}})` / `move` / `setIgnoreMouseEvents` / `close` / `onClosed`；whale-girl 的浮动宠物已在用（`overlay.ts`） | ★★★ 最匹配 PiP：独立原生窗、always-on-top、可透明无边框、可点击穿透。注意仅 DSH-Desktop 环境存在，纯 Web GUI 无此 bridge |
| `sidebarRightTabs` 右侧栏 tab | `packages/runtime/src/client.ts:159`（服务名 `'sidebarRightTabs'`，L423 注册）；dsh-codex 的 `sidebar-right.ts` + `sidebar-tab-keep-alive.tsx`（按 `(sessionId, tabId)` 保留 React root，detach 时收 `visible:false`） | ★★ 适合做「大图预览页」，不适合悬浮小窗；keep-alive 机制可直接复用 |
| React portal 到 `document.body` 的应用内浮层 | `packages/ui/src/primitives/Modal.tsx` | ★ 只在 DSH 窗口内浮，不能越出主窗；且须遵守 DSH-Desktop drag 规则（根节点声明 `no-drag`，写 `-webkit-app-region` + `app-region` 一对，见 AGENTS.md） |
| `dsh-computer-tools` 插件 | 已 grep 全源码：无 PiP/预览窗代码；其 `PREVIEW_PATH`/`manager.preview()` 是**配置补丁预览**，与画面预览无关 | 无现成能力，但它是 Cua MCP 的现有接入点（`src/cua-driver.ts`、`manager.ts`），PiP 插件可复用其 driver 连接管理 |

session 级 UI 的现成模式：dsh-codex 的 `sidebarTabOccurrenceKey(sessionId, tabId)` 证明了「按 sessionId 键控 UI 实例」是仓库内已确立的做法，PiP 的「每 session 一个窗」可照搬该键控思路。

## 5. 方案建议

### 推荐架构：插件自渲染 + Cua capture-only 轮询

```
DSH session ──键控──> PiP controller（host 层，按 sessionId 持有一个 poller）
                         │  Cua MCP：get_window_state(pid, wid,
                         │    include_accessibility_tree:false, max_dimension≈480)
                         │  节奏 1–2 fps，带 session 标签；失败重试 + window_id 重绑
                         ▼
              dshDesktop.overlays.open(alwaysOnTop, resizable)
              加载插件 URL，<img>/canvas 逐帧替换（JPEG base64 → blob URL）
```

要点：

1. **窗口内容**：capture-only 截图轮询，1–2 fps 足够「知道 agent 在干嘛」；不要追求视频流（Cua 无单窗口流，整屏录屏文不对题）。
2. **session 生命周期**：poller 与 overlay 都挂 sessionId；session 归档/关闭 → `overlays.close` + 停轮询；参照 dsh-codex keep-alive 的 occurrence key。
3. **交互**：单击 → `bring_to_front(pid)`（Cua 有现成工具）把目标窗口拉前台；提供拖动（`overlays.move`）、关闭、持久化「不再自动弹出」设置（对照 Codex 教训 ①②④）。
4. **降级**：无 `dshDesktop` bridge（纯 Web）时退化为 sidebarRightTabs 预览页；目标窗口销毁时显示占位 + 自动重绑。
5. **权限与进程**：捕获走 CuaDriver.app（已签名、持 TCC 授权），插件自身无需任何新权限——这是相比自研 ScreenCaptureKit 捕获的最大省事点。
6. **不要**依赖 `experimental_pip`：daemon 全局、需重启、非流式，与 session 级目标冲突；仅可作为设置里的「极简指示器」备选。

### 成本与风险

- 轮询成本：每次 capture-only 调用 ~0.2–0.8s（含 CLI 开销；MCP 常驻连接应更低），1 fps 对 daemon 压力可接受 [实测]；多 session 并发开窗时按 session 数线性增长，建议同时最多 2–3 个活跃 PiP。
- 瞬时捕获失败（"No content produced"）必须视为常态，UI 上保留上一帧 + 静默重试 [实测]。
- `experimental_pip` 与插件自渲染可同时存在不冲突，但开启前者要重启 daemon，文档里需警告。

### 未验证项（实现前建议补测）

- 最小化/跨 Space 窗口的 capture-only 截图成功率（`list_windows` 声称可见离屏窗口，未实测捕获）。
- MCP 常驻连接下 capture-only 的真实延迟下限（去掉 CLI 进程开销）。
- `overlays.open` 的 `url` 加载插件页面的内容安全策略（whale-girl 已验证可行，但 PiP 需逐帧换图，需确认无闪烁）。

## 附：来源清单

一手（本机实测）：
- `cua-driver serve --help`（0.28.1）— `--experimental-pip` / `--experimental-pip-geometry` 说明
- `cua-driver describe set_config` / `describe get_window_state` — PiP 持久化与 capture-only 路径定位
- capture-only 延迟三连测（0.76/0.16s + 1 次瞬时失败）
- `~/.cua-driver/config.json`

一手（代码）：
- `plugins/dsh-whale-girl/src/client/bridge.ts`、`plugins/dsh-whale-girl/src/client/overlay.ts`
- `packages/runtime/src/client.ts`（L157/L159/L423）
- `plugins/dsh-codex/src/client/sidebar-right.ts`、`sidebar-tab-keep-alive.tsx`
- `plugins/dsh-computer-tools/src/`（无 PiP 能力的负向确认）

一手（官方仓库 issues）：
- [openai/codex#32451](https://github.com/openai/codex/issues/32451)、[#32363](https://github.com/openai/codex/issues/32363)、[#33086](https://github.com/openai/codex/issues/33086)、[#44026](https://github.com/openai/codex/issues/44026)、[#44448](https://github.com/openai/codex/issues/44448)、[#44765](https://github.com/openai/codex/issues/44765)、[#32040](https://github.com/openai/codex/issues/32040)

二手/内部：
- `docs/live-browser-side-panel-research-2026-09-16.md`、`docs/browser-observation-tab-design-2026-09-16.md`（本仓库前序调研，CDP 路线对照）
