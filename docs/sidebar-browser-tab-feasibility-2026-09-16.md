# 侧边栏 Browser 标签窗口 — 可行性调研

日期：2026-09-16
结论：**技术可行，已端到端验证。** 架构比初版评估**更简单**（见 §5 修正）。
关联：[live-browser-side-panel-research-2026-09-16.md](live-browser-side-panel-research-2026-09-16.md)（调研 agent 的 8 组 CDP 实验，540 行）

## 1. 需求

在 DSH 右侧栏加一个 Browser 标签页，**用户能实时看到页面**，同时 **agent 直接操作同一个浏览器**（同一个页面，不是两份）。

## 2. 关键结论：现有实现缺的只是「一个端口」

| 路线 | agent 工具 | 实时画面 | 可否共用同一浏览器 |
|---|---|---|---|
| Browser Use（`mcp__playwright-mcp__*`） | ✅ 24 个 | ❌ 无表面 | — |
| Computer Use / Cua `browser_prepare` | ✅ | ⚠️ 靠**独立可见窗口**，非嵌入 | ❌ 另起进程 |

初版文档在这里下过一个**错误结论**，已修正：

> ~~「Browser Use 用 `--remote-debugging-pipe` 启动，第二个进程物理上连不上，所以必须另起浏览器」~~

**pipe 与 port 不互斥，可以同时开。** 这是决定性的：

- **源码**：`remote_debugging_server.cc::GetInstance()` 里 pipe 与 port 是**两个顺序独立的分支**，各自置 `debugging_server_started`，**没有任何互斥检查**。
- **Playwright 侧**：`_innerDefaultArgs` 只对 `--remote-debugging-pipe` 抛错，对 `--remote-debugging-port` **原样放行**。
- **我独立复现**：`chromium.launch({ args: ['--remote-debugging-port=9355'] })` → Playwright 照常驱动（`page.title()` 正常），同时 `http://127.0.0.1:9355/json/version` 可用、page target 可列。

我最初用裸 Chrome 手拼两个 flag 测得「TCP 起不来」，那是我自己的错误——没真正提供 pipe 的 fd，Chrome 直接报 `Remote debugging pipe file descriptors are not open`。**交给 Playwright 启动（它自己加 pipe）再加 port，就完全正常。**

**含义**：不需要推翻现有 provider、不需要自己当浏览器宿主 —— **给它追加一个 `--remote-debugging-port` 就能获得外部视图能力。**

## 3. 可行架构（已 POC 验证）

```
        Chrome（Playwright 启动：自带 pipe + 追加 port）
              ├── CDP（pipe）──────→ Playwright / agent 工具（24 个，原样）
              └── CDP（TCP port）──→ 侧边栏视图：Page.startScreencast
```

CDP 允许多客户端并存，所以「一个看、一个操作」是原生能力，不需要代理转发。

### 端到端实测

在「Playwright 正常启动 + 追加 port」的真实形态下：

```
[agent] playwright driving, title: "Example Domain"
[view ] tcp endpoint up: true Chrome/153.0.8010.48
[view ] page target found: true https://example.com/
[view ] frames after agent navigation: 1
[view ] frames after agent mutation  : 2 (+1)
[view ] frames during agent stream   : 41 (+39)
[agent] playwright sees view write: true
E2E_WITH_PIPE_PLUS_PORT: YES
```

即：**agent 用真 Playwright 操作、独立进程实时看同一页面、双向一致** —— 三件事同时成立，且**没动 provider 的启动方式**。

### 性能（可调）

| 场景 | fps | 带宽 | 单帧 |
|---|---|---|---|
| 高质量（1280×800, q60） | 59.2 | ~2.0 MB/s | 33.7 KB |
| 侧边栏档位（480×900, q45, everyNthFrame=2） | 29.5 | ~0.4 MB/s | 13.8 KB |

重页面 + 强制持续重绘测得，偏保守（静止页面几乎不发帧）。侧边栏档位 ~400 KB/s 为本机回环，可接受。

**成本随观看者线性增长**（调研 agent 实测：1 个 3.89 Mbps → 5 个 19.43 Mbps）。一个侧边栏 = 1 个观看者，没问题；**缩略图墙不可行**。

### 省 CPU 机制

`Page.stopScreencast` 停流后**真的零帧**，且 agent 侧完全不受影响：

```
frames while STOPPED : 0     ← 停流后真零帧
frames after RESTART : 1     ← 需要时能重启
agent still driving during stop: "T969"
THROTTLE_WORKS: YES
```

所以「切走就停、切回续」可行，与 `sidebar-tab-keep-alive` 的 `visible: false` 正好配套。

> ⚠️ 调研 agent 报告称「后台/隐藏 target 自动 0 帧，免费省 CPU」。**我实测未能复现**：把页面 `bringToFront` 到后台后，`document.visibilityState` 仍是 `visible`，且 2.5 秒内仍发出 54 帧。所以**不要依赖「隐藏自动省流」，必须显式 stop/start**。

## 4. 坐标映射（这里初版写错了，已修正）

初版文档说「screencast 帧是缩放后的（756×413 对应 1280×720）」，把两件事混在了一起。实测：

| 请求 maxWidth/maxHeight | 实际 JPEG 像素 | metadata.deviceWidth/Height |
|---|---|---|
| (无) | 756×413 | 756×413 |
| 320×400 | **320×180** | **1280×720** |
| 200×200 | **200×113** | **1280×720** |

**`metadata.deviceWidth/Height` 报的是页面视口，完全忽略 maxWidth/maxHeight。** 所以两个数都需要：

```
css_x = image_x * (metadata.deviceWidth  / 实际JPEG宽)
css_y = image_y * (metadata.deviceHeight / 实际JPEG高)
```

- 视口大小取自 **metadata**；
- 图像大小必须取自**真实解码的 JPEG**（`naturalWidth` / 解码字节），**不能用 metadata**。

**方向**：`Input.dispatchMouseEvent` 收的是 **CSS 视口坐标**，不是图像坐标。

我已验证往返正确（image 320×180、viewport 1280×720）：

```
用户点图像像素 (200,125) → 发送 CSS (800,500) → 页面报告 clicked 800,500   ✅
```

若误把图像坐标直接当 CSS 发（(200,125)），点击会落在页面左上角而非目标位置。

> 调研 agent 说「复用 sessionId 跨连接会 `-32001`」。**我没能复现**：跨连接 ack 别人（甚至不存在的）sessionId，都返回 ACCEPTED，没有报错。不过 ack **语义上**本应本地配对，实现时仍应每连接各自持有 sessionId —— 这条当作**保守实践**，不是它声称的硬报错。

## 5. 前置改造：比初版评估小得多

初版说要「插件自己当浏览器宿主」。**修正后**：现有 provider 只要能把 `--remote-debugging-port` 传进去即可。

三条路径，按侵入性排序：

**A. 配置注入（最省，已验证可行）**
调研 agent 发现、我也独立确认：**stock playwright-mcp 认 `--config`，且会转发 `launchOptions.args`**：

```
config_launchArgs_honored: true   ← 端口真的起来了
```

即通过 `--config` 文件塞 `launchOptions.args: ["--remote-debugging-port=N"]`，**不改官方包、不 fork**。

**B. provider 增加 args 字段**
`BrowserMcpLaunchConfig` 目前只有 `mode/headless/executablePath/toolCallTimeoutMs`，没有透传 args 的口子。在 `dsh-experimental-browser-use-playwright-mcp` 的 `apply()` 里加一个 args 透传即可（改动很小，但属官方包）。

**C. 自己当宿主**（初版方案，仍可用但不必要）
插件启动浏览器 + `--cdp-endpoint` 交给 MCP。已验证 attach 路径 24 工具全可用，但要自己做生命周期，成本最高。

**推荐 A**，B 作为上游化方向。

风险/注意点：
- **headless 与可见性解耦**：画面是自己渲染的，浏览器**不必可见**。可以真无头 + 侧边栏有画面 —— 绕开你之前踩的「弹可见窗口」问题。全部验证都在 `--headless` 下完成，无阻塞。
- **端口是完整浏览器控制权**：必须只绑 `127.0.0.1`，并校验 socket 归属（Cua 就是这么做的）。这是本方案最大的安全面。
- **`trusted` 输入在 macOS 独立 Chromium 上会激活窗口**（Cua 文档记录 `browser_input_trust_unavailable`）。视图侧注入点击若不想弹窗，用 `dom_event` 合成点击。
- **必须显式 stop/start**（见 §3 未复现项），别指望隐藏自动省流。
- **生命周期**：浏览器归 host 侧所有，必须绑 `tab.signal`（终端同款），否则关 tab 留进程 —— 正是之前 `browser_prepare` 残留的成因。
- **不要用 `Page.startScreenRecording`**：协议 JSON 里有，Chrome 149 运行时不存在（`-32601`）。

## 6. 与现有代码的契合度

**Terminal 就是先例**（同为「实时交互表面 + host 侧长连接」），骨架可直接抄：

| 需要 | 现成可复用 |
|---|---|
| 注册 tab 类型 | `registerSidebarTab()`（`dsh-codex/src/client/sidebar-right.ts`） |
| 切 tab 不丢状态 | `sidebar-tab-keep-alive.tsx`（`(sessionId, tab.id)` 保活，切走只 detach DOM） |
| host 侧 WS 端点 | `dsh-codex/src/host/terminal/server.ts`（`ws` + `webServer` 的 `upgrade` 路由） |
| 客户端连 WS | 同终端：`ws://${location.host}/<path>` |
| 注册 agent 工具 | `ctx.tools.register(defineTool({...}))`（dsh-memory / dsh-flow 已是先例） |
| 资源型 tab | `dsh-resource://<type>/<id>`，同终端 |

不需要新机制，把终端骨架换成 CDP 即可。

## 7. 建议

分三步，每步可独立验收：

1. **最小可用**：`browser` tab 类型 + host 侧 screencast 桥（WS 转发帧），provider 侧走 §5-A 注入端口。验收 = §3 的 E2E 脚本换成插件内路径。
2. **交互**：视图侧鼠标/键盘 → `Input.dispatch*`，按 §4 公式反算；加地址栏/前进后退/刷新。
3. **打磨**：多 tab（`dsh-resource://`）、分辨率自适应、可见性驱动的显式 stop/start、错误态。

工作量：第 1 步是大头（生命周期 + 协议），但**协议有终端可抄**；第 2 步是纯 CDP 输入映射；第 3 步增量。

## 8. 未决问题（需要你定）

- Browser tab 与现有 Browser Use 是**替代**还是**并存**？哪个默认？
- 需要你在面板里**直接操作**（鼠标点击），还是**只看** agent 操作就够？后者简单很多。
- 是否需要复用你**已登录**的 Chrome（cookie/登录态）？会显著抬高安全与合规成本，Cua 的 existing-profile 授权流程就是为它准备的。
