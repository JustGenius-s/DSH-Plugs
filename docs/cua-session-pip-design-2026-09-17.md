# dsh-cua-pip 设计文档：session 级单应用画中画插件

> 2026-09-19：本文保留为历史设计。当前行为以 [Computer PiP 审查与修订](./cua-pip-review-2026-09-19.md) 为准：Agent 显式打开、跨轮次/会话保活、Host 定时关闭，不再由每次 Cua 调用自动弹出。

日期：2026-09-17 · 前置调研：[cua-session-pip-feasibility-2026-09-17.md](./cua-session-pip-feasibility-2026-09-17.md) · 目标运行时：DSH 0.1.6-alpha.1 / Cua Driver 0.28.1 · 插件目录：`plugins/dsh-cua-pip`

> 修订 2026-09-18（再晚）：挂到**当前会话对话流界面**的页内悬浮层，**不新开系统窗口**。触发仍是该对话流主动调用 Cua。挂载点只有 `shell.overlay`；`dshDesktop.overlays` 不再打开。v2 侧栏、v3 会话区 tab、输入框 chip、原生独立窗均已废弃。Host 听 `session/event` 的 Cua `tool/call`，从参数自动 watch，客户端只负责在当前对话流上开/关卡片。

## 1. 定位、目标与非目标

### 定位

本插件是 computer-use（Cua）能力的延伸：Cua 在后台操作目标应用时，把「被操作的窗口」钉进当前会话对话流上的页内画中画，实时观察——不另开系统窗口，也不抢会话区 tab。

### 目标

- 当前对话流 **主动调用 Cua** 时，在该会话界面右下角弹出页内卡片，以 ~1 fps 预览正在被操作的窗口
- 只读预览；单击画面 → `bring_to_front(pid)`
- 生命周期挂 Cua burst：`tool/call` 开卡片，`turn/end` 收起；用户关掉当次后同一 turn 不再弹；归档/删除 session 才清 retained；idle TTL 回收 watcher
- 只走 `shell.overlay` 页内浮动卡片（`no-drag`）；不新开 Desktop overlay

### 非目标

- 不做视频流（Cua 无单窗口流；`start_recording` 是主屏整屏，文不对题）
- 不在预览窗内反向操控目标应用（只读 + 单击聚焦）
- 不使用 Cua `experimental_pip`：daemon 全局单窗、post-action 才刷一帧、开启需重启 daemon——不满足 session 级、多实例（调研 §2.1）
- v1 不做设置页，参数走代码常量（`src/shared/config.ts`）

## 2. 架构总览

使用流程：agent 经 Cua 在后台操作某应用 → host 看到 Cua `tool/call` 后自动 watch 目标窗口并广播 activity → 当前对话流上弹出页内卡片 ~1fps 直播 → 用户边观察边做自己的事；需要接管时单击画面。`turn/end` 后收起。

```
┌─ Client ──────────────────────────────────────────────┐
│ 当前对话流: shell.overlay 页内浮动卡片（no-drag）         │
│ 用户关掉当次 → 同一 turn 不再弹                         │
└───────────────────────────────────────────────────────┘
┌─ Overlay / float ─────────────────────────────────────┐
│ GET /cua-pip/activity 决定开不开                         │
│ GET /cua-pip/frame ~1fps · 单击 → POST /focus            │
└───────────────────────────────────────────────────────┘
┌─ Host ─────────────────────────────────────────────┐
│ session/event → applyCuaEvent（Cua 工具名 + pid/wid）  │
│ WatcherRegistry: 1fps capture-only；45s idle TTL；3 LRU │
│ window_id_not_found → 按 pid 重绑最大在屏窗口             │
└───────────────────────────────────────────────────────┘
```

## 3. Host 设计

### WatcherRegistry（`src/watcher.ts`）

- `Map<sessionId, Watcher>`，一个 session 一个轮询器；重复 watch = retarget 改绑
- Watcher：`setInterval` 1 fps → `cua-driver call get_window_state`（capture-only），缓存最新帧（base64 PNG + 宽高 + app/窗口名）
- **idle TTL 45s**：无人拉 `/frame` 自动回收——关 tab 不留轮询进程开销
- **并发上限 3**：超出时 LRU 淘汰 `lastFetchAt` 最旧者（`evictionCandidate`）
- **窗口重绑**：捕获报 `window_id_not_found` / `window_owner_pid_mismatch` → `list_windows` 后 `pickRebindCandidate`（同 pid 内优先在屏、其次最大面积）。`universalAccessAuthWarn` / 标题「录屏」的系统授权浮层不算可用目标：自动 watch 会丢掉它，避免 latch 到 TCC 对话框。
- **瞬时失败容错**："No content produced" 是常态（窗口切换/动画期间），保留上一帧 + 记 error，下拍重试
- timer `unref()`，不阻止 host 进程退出

### 路由（`src/index.ts`，前缀 `/cua-pip`）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/cua-pip/windows` | GET | `list_windows` 包装；过滤无名/<50px 窗口 |
| `/cua-pip/watch` | POST | `{sessionId,pid,windowId}` 建立/改绑 watcher |
| `/cua-pip/unwatch` | POST | `{sessionId}` 停止并删除 |
| `/cua-pip/frame?session=<id>` | GET | 拉最新帧；调用即 touch 保活 |
| `/cua-pip/focus` | POST | `{sessionId}` → `bring_to_front(target.pid)` |
| `/cua-pip/activity` | GET | 当前各 session 的 Cua burst（active / tool / target / turn） |
| `/cua-pip/overlay` | GET | 遗留原生窗 HTML（客户端不再打开） |

### Cua CLI 封装（`src/cua.ts`）

- 走 CLI `cua-driver call <tool> '<json>'` 而非裸 MCP socket：CLI 是文档化稳定面，且是 daemon socket 的瘦客户端——TCC 授权由 daemon（已签名 CuaDriver.app）持有，插件自身零权限、不用维护常驻连接
- 纯函数可测：`parseWindows` / `parseFrame` / `classifyError` / `pickRebindCandidate`
- `execFile` timeout 20s、`maxBuffer` 64MB（base64 帧）

### CLI 能力验证（2026-09-17 [实测]，结论：满足需求）

| 场景 | 方法 | 结果 |
|---|---|---|
| 单 watcher 持续 1 fps | 40 次 capture-only 调用（目标 DSH-Desktop 1728×1014，max_dimension 640） | **0 失败**；avg 0.255s / p50 0.236s / p95 0.270s / max 0.812s；帧 ~301KB base64（≈226KB PNG） |
| 3 watcher 并发（maxWatchers 上限） | 3 窗口 × 8 ticks 全并发 | **24/24 成功**；avg 0.199s / max 0.308s，daemon 无串扰 |
| `bring_to_front` | `describe bring_to_front` | 入参 `{pid, window_id?}`，CLI 可调；会抢前台——设计如此，仅用户单击画面时触发 |
| daemon 形态 | `status` | daemon 常驻（socket `~/Library/Caches/cua-driver/cua-driver.sock`），CLI 调用即 socket 转发 |

结论：CLI 路径在 1 fps × 3 watcher 下延迟与稳定性均达标，**无需常驻 MCP 连接**；若未来要 5+ fps 再评估 `cua-driver mcp` stdio 常驻模式。

## 4. Client 设计（`src/client/index.tsx`）

- **不挂会话区 tab，不新开系统窗口**。触发是当前对话流在 `GET /cua-pip/activity` 里的 Cua burst（`pickConversationActivity` + `dsh.sessions.current`）。其他 session 的 burst 不画在本线程上。
- `shell.overlay` 页内浮动卡片（根节点 `-webkit-app-region: no-drag` + `app-region: no-drag`），复用 `CuaPipPanel`。卡片「×」记住 session+turn，同一 turn 不再弹。
- 启动时若仍有旧的 `dshDesktop.overlays` 画中画，关掉它，不再 `open`。
- Chip / sidebar / `conversation.view` / 原生独立窗都不做。

## 5. 面板设计（`src/client/panel.tsx` + `src/client/panel-state.ts`）

- 页内面板：无窗口选择栏；画面区按捕获窗口宽高比缩放（长边 400）；拖动卡片移动；`<img>` 1 fps；单击 → `/focus`
- **状态保留是双层结构**：
  1. host watcher 按 sessionId 存续，float 卸载不影响抓帧；45s 无人拉取才被 idle TTL 回收。卸载**不**调用 `/unwatch`
  2. 模块级 `RetainedTargets`；`ctx.sessions.list.subscribe` 在 session 离开 `byId`（归档/删除）时 `pruneRetained`。addressed 子会话仍算活着
- **重连路径在 1s `pull()` 循环里**（不在一次性 `boot()` 里）：pull 发现未 watch 且 retained 有目标 → 自动 re-watch，`rewatchDue` 5s 节流防死目标空转——即使 `boot()` 的窗口列表请求挂起，重连也不被阻塞
- 纯逻辑全部抽在 `panel-state.ts`（picker key/label、retained map、rewatch 节流门），组件只是薄壳，符合仓库「只测函数/接口」规则

## 6. 关键设计决策（对照 Codex PiP 教训）

| Codex Desktop 被吐槽的点（openai/codex issues） | 本插件对策 |
|---|---|
| 自动弹出、无法持久关闭（#32451） | 仅 Cua burst 自动弹；关掉当次后同一 turn 不再开 |
| 单击预览无响应（#33086） | 单击画面 → `bring_to_front(pid)` |
| 孤儿 overlay 残留（#32363） | `turn/end` / session disposed 关窗；watcher 45s idle TTL 兜底 |
| 遮挡不避让（#44026） | 页内卡片可关；不另开系统窗 |

## 7. 技术选型依据（调研 §2/§4）

- **数据源**：`get_window_state(include_accessibility_tree:false, max_dimension:640)` capture-only 路径，官方定位即 PiP 预览；实测单次 0.16–0.76s（含 CLI 进程开销）→ 1 fps 轮询可行
- **OS 级捕获独有价值**：`list_windows` 含最小化/跨 Space/被遮挡窗口，CDP screencast 做不到
- **挂载点**：`shell.overlay` 叠在当前对话流上。会话区 tab / 侧栏 / chip / 原生独立窗已废弃。
- **权限**：捕获走已签名 CuaDriver.app（持 TCC 授权），插件自身零新权限

## 8. 文件清单与状态

| 文件 | 状态 |
|---|---|
| 构建骨架（package.json / tsdown×3 / tsconfig / vitest.config / cordis.patch.yml） | ✅ 已写 |
| `src/shared/routes.ts`、`src/shared/config.ts`、`src/shared/types.ts`、`src/shared/cua-activity.ts` | ✅ 已写 |
| `src/cua.ts`、`src/watcher.ts` | ✅ 已写 |
| `src/index.ts`（activity + overlay 页 + 原有路由） | ✅ 已写 |
| `src/client/index.tsx`（`shell.overlay` 页内 float） | ✅ 已写 |
| `src/client/overlay.ts` + `src/overlay.html` | 遗留，客户端不再打开 |
| `src/client/float.tsx` + `panel.tsx` + `panel-state.ts` | ✅ 已写 |
| ~~`src/client/sidebar.ts`~~ / ~~`conversation.view`~~ | 🗑 已废弃 |
| `test/cua-activity.test.ts`、`test/cua.test.ts`、`test/watcher.test.ts`、`test/panel-state.test.ts` | ✅ 已写 |
| `README.md` | ✅ 已写 |

## 9. 测试计划（vitest，只测函数/接口，不渲染 DOM）

- `parseWindows`：过滤无 bounds/无名窗口、字段映射（snake_case → camelCase）
- `parseFrame`：取 `screenshot_png_b64`；缺帧抛 `capture_failed`
- `classifyError`：window_gone / capture_failed / cli_failed 三分
- `pickRebindCandidate`：优先在屏、其次最大面积、空列表返回 undefined
- `shouldReap` / `evictionCandidate`：TTL 边界与 LRU 顺序
- `WatcherRegistry`（mock capture/listWindows）：watch 去重 retarget、超额淘汰、unwatch 停表、tick 失败容错与重绑、idle 自动回收
- `pruneRetained` / `RetainedTargets.keys`：按 `byId` 存活谓词丢掉归档会话，addressed 子会话保留
- `isCuaToolName` / `extractWatchTarget` / `applyCuaEvent` / `pickActivity` / `pickConversationActivity` / `shouldOpenOverlay` / `isHijackCapture` / `coalesceUsableTarget`：Cua burst 识别、嵌套 target、只挂当前对话流、同 turn 关闭不再弹、跳过系统「录屏」浮层

## 10. 验证步骤

1. `pnpm --filter @just-genius/dsh-cua-pip build` + `typecheck` + `test`
2. DSH web 重启加载插件（bundle patch 需重启，非刷新）
3. 端到端：加载插件后，当前对话流主动调 Cua → 会话界面右下角出现页内卡片；不新开系统窗口；`turn/end` 后收起；关掉当次同一 turn 不再弹；会话区顶栏没有「画中画」tab。

## 11. 风险与未验证项

- 离屏/最小化窗口 capture-only 成功率未实测（`list_windows` 声称可见，捕获未验证）
- ~~CLI 开销是否撑得起轮询~~ 已实测排除：见 §3「CLI 能力验证」（1 fps 单路 0 失败 avg 0.255s，3 路并发 24/24）
- 多 session 并发对 daemon 的压力：已用 `maxWatchers: 3` 兜底（3 路并发实测无串扰）
- 屏幕锁定/显示器休眠期间，Cua 的 AX 查询与窗口捕获整体不可用（系统行为，非插件问题）；锁屏下 GUI 操作全部不可行
