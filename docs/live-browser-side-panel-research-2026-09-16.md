# Live Interactive Browser View in an IDE Side Panel — Prior Art & Technical Reference

日期：2026-09-16
范围：为「DSH 右侧栏 Browser 标签页」提供技术底稿。所有结论标注来源；标 **[实测]** 的为本机实验验证（Chromium 149.0.7827.55 / Chrome for Testing 1228，macOS arm64，脚本在 `/tmp/cdpexp/`）。

配套文档：`docs/sidebar-browser-tab-feasibility-2026-09-16.md`（本仓库既有可行性调研）。本文补充其外部先例、CDP 细节，并**修正其中一处结论**（见 §3.3）。

---

## 0. TL;DR

1. **唯一能给出"同一浏览器、用户实时看、agent 同时在操作"的机制是 CDP `Page.startScreencast`**。没有例外（§1）。
2. **CDP 允许多个客户端同时附着同一 target 并各自独立 screencast** —— 这是本方案的地基，已实测（§3.1）。
3. **`--remote-debugging-pipe` 与 `--remote-debugging-port` 不是互斥的**，可以同时开启；这是既有文档 §2 「pipe 路线物理上走不通」的**修正**（§3.3）。
4. **播放流的帧尺寸 ≠ metadata 里的尺寸**；metadata 报的是**页面视口**，不是 JPEG 图像。坐标映射必须用真实图像尺寸（§6.1，实测数据）。
5. **iframe 路线对第三方站点结构性不可行**（X-Frame-Options / `frame-ancestors`，无法被嵌入方绕过）（§5）。
6. 成本随「看的人数」线性放大：5 个并发观看者时预算 ×5（实测 §3.4）。

---

## 1. AI browser-agent 产品用了什么机制

| 产品 | 机制 | 输入回传 | 来源 |
|---|---|---|---|
| **browser-use**（OSS 库） | **(a)** screencast → MP4 文件，**不是 UI**；模型拿 **(b)** 截图 | 无（headless） | [recording_watchdog.py](https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/browser/watchdogs/recording_watchdog.py) |
| browser-use cloud | **(e)** 托管 `live_view_url` 放进 `<iframe>` | 在托管页内 | [live-preview docs](https://docs.browser-use.com/cloud/browser/live-preview.md) |
| browser-agent-template (Vercel eve) | **(e)** `<iframe src={liveUrl}>` | 焦点保留在 iframe 内 | [browser-panel.tsx](https://raw.githubusercontent.com/browser-use/browser-agent-template/main/app/_components/browser-panel.tsx) |
| **Playwright Inspector** (`PWDEBUG=1`) | **(f)** 真·可见浏览器窗口；Inspector 窗口**不显示页面图像** | 真实 OS 窗口 | [recorderApp.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/recorder/recorderApp.ts) |
| **Playwright UI Mode** (`--ui`) | **(g)** DOM 快照重放 + **(a)** 胶片带；测试跑 **headless** | 拖动时间轴 | [testServer.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright/src/runner/testServer.ts) |
| **Playwright Trace Viewer** | **(g)** 沙箱 iframe 内 DOM 重放；Screenshots 面板是 **(a)** 真 screencast JPEG | n/a（重放） | [snapshotTab.tsx](https://raw.githubusercontent.com/microsoft/playwright/main/packages/trace-viewer/src/ui/snapshotTab.tsx) |
| **Playwright Dashboard** (`playwright-cli show`) | **(a)** 真·实时 screencast → WS → `<img>` | 合成 mouse/key 走 WS 回传 | [dashboardController.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/tools/dashboard/dashboardController.ts) |
| Playwright MCP | **无实时视图**；a11y YAML + 可选 PNG | `browser_snapshot` / `browser_take_screenshot` | [README](https://github.com/microsoft/playwright-mcp) |
| **Skyvern**（默认） | **(d)** noVNC RFB 客户端（React） | RFB over WS → canvas | [BrowserStream.tsx](https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/skyvern-frontend/src/components/BrowserStream.tsx) |
| **Skyvern**（local 模式） | **(a)** `Page.startScreencast` jpeg q60 over WS | 第二条 WS `/stream/cdp_input/` → `Input.*` | [PR #4904](https://github.com/Skyvern-AI/skyvern/pull/4904) |
| Browserbase / Stagehand | **(e)** `debuggerUrl` iframe → 托管视图 | 在托管页内 | [session live view](https://docs.browserbase.com/platform/browser/observability/session-live-view) |
| **Vercel agent-browser** | **(a)** screencast → WS → `<canvas>` | `input_mouse`/`input_keyboard`/`input_touch` | [cdp_loop.rs](https://raw.githubusercontent.com/vercel-labs/agent-browser/main/cli/src/native/stream/cdp_loop.rs) |
| Claude computer use（API） | **(g)** 截图塞进 `tool_result`；无实时视图 | 仅模型循环 | [computer-use docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) |
| anthropic-quickstarts demo | **(d)** noVNC 并列 Streamlit | canvas 内真实 X11 输入 | [entrypoint.sh](https://raw.githubusercontent.com/anthropics/claude-quickstarts/main/computer-use-demo/image/entrypoint.sh) |
| Cursor Browser | **(e)** "secure web view"，编辑器内或独立窗口 | agent MCP 工具 | [Cursor docs](https://cursor.com/docs/agent/tools/browser) |
| Windsurf / Devin Desktop Previews | **(e)** "simple web view" 面板 | "Send element" → `@`-mention | [previews docs](https://docs.devin.ai/desktop/previews) |
| Devin（cloud） | **(d)** VNC | 用户在 VNC 面板接管 | [release notes](https://docs.devin.ai/release-notes/overview) |
| OpenHands | **(b)** base64 PNG 放进 `<img>` | 无（只读） | [browser-snapshot.tsx](https://raw.githubusercontent.com/OpenHands/agent-canvas/v1.2.0/src/components/features/browser/browser-snapshot.tsx) |

**图例**：(a) CDP screencast JPEG over WS ·(b) 轮询 `Page.captureScreenshot` ·(c) WebRTC/自建视频 ·(d) noVNC/VNC ·(e) 原生嵌入（iframe/webview）·(f) 真·可见浏览器窗口 ·(g) 录制好的 DOM 快照在 iframe 内重放

### 值得注意的否定结论

- **WebRTC 在上述任何产品的实时视图里都找不到**。(c) 类机制在实时视图场景基本不存在；Browserbase 的**回放**用的是 HLS（m3u8 → fMP4），那是录像不是直播。
- **没有任何产品把实时页面当真实 DOM/iframe 嵌进来**。唯一的真·实时像素通路就是 CDP screencast。
- **Playwright UI Mode 的"实时"面板其实是 trace 重放**（每 500ms 轮询 trace 文件），且 v1.56 起测试默认 headless。
- **OpenHands 不是 noVNC**（与常见说法相反）：其面板是 `<img src="data:image/png;base64,...">`，仓库全量 grep `novnc|vnc` 在 HEAD 及 tag 0.9–0.60 均为空。noVNC 印象来自无关的 `enyst/OpenHands-Tab` 扩展。

**未确认项**（不作断言）：Browserbase/Stagehand 实时视图的内部传输（文档只说 "iframe"）；browser-use cloud `live.browser-use.com` 的内部协议；Cursor 的 webview 引擎；Devin 用的具体 VNC 库。

---

## 2. CDP screencast 规格

### 2.1 三个 API

```
Page.startScreencast({ format, quality, maxWidth, maxHeight,
                       everyNthFrame, maxFramesInFlight, sendLastFrame })
Page.screencastFrame  → { data (base64), metadata, sessionId }   # 事件
Page.screencastFrameAck({ sessionId })
Page.stopScreencast()
```

标注：`startScreencast` / `stopScreencast` / `screencastFrameAck` / `screencastFrame` **全部是 `experimental`**——不是废弃，而是 Chrome 从不稳定化它（协议可随时改）。来源：[devtools-protocol Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)，本地核对自 `json/browser_protocol.json`。

**格式**：`format` 只接受 `jpeg` 或 `png`（**没有 webp**；`Page.captureScreenshot` 才有 webp）。`quality` 仅对 jpeg 生效，范围 0–100。

### 2.2 帧率旋钮

`startScreencast` **没有 fps 参数**。帧率由三样东西决定：

| 旋钮 | 含义 |
|---|---|
| 源端重绘频率 | 页面只在合成器产出新帧时才发帧；静止页面几乎不发帧 |
| `everyNthFrame` | 每 N 帧只发 1 帧（默认 1） |
| `maxFramesInFlight` | **未 ack 的帧上限，默认 3**；达到即停发 |
| `sendLastFrame` | 为**降低延迟**牺牲吞吐：缓存最后一帧，ack 一到立刻发 |

`sendLastFrame` 的官方原文：*"By default, after screencastFrameAck arrives, the next produced frame is sent. Passing this flag enables storing the last produced frame in memory, which is immediately sent upon screencastFrameAck. This way, overall performance is traded for a better latency."*

**内部硬上限**：`DevToolsVideoConsumer` 的 `kDefaultMinCapturePeriod = 10ms` → 理论 **~100 fps 封顶**（[devtools_video_consumer.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_video_consumer.cc)）。

### 2.3 掉帧与背压机制（源码级）

关键在 [`page_handler.cc`](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/page_handler.cc)：

```cpp
bool PageHandler::EnoughScreencastFramesInFlight() {
  return frames_in_flight_ >= max_frames_in_flight_;
}

void PageHandler::OnFrameFromVideoConsumer(...) {
  if (++frame_counter_ % capture_every_nth_frame_) return;
  // Do not capture a new frame when not in sendLastFrame mode,
  // and we cannot send this frame right away. This is a choice
  // for performance over latency.
  if (EnoughScreencastFramesInFlight() && !send_last_frame_) return;
  ...
}
```

**这是"掉帧"的真实语义：不是丢帧，而是根本不编码。** 注意 `SentScreencastFrame` 在**编码前**就 `frames_in_flight_++`，所以一个慢的 JPEG 编码也会占用 in-flight 配额。

**不 ack 的后果 [实测]**：一个不发 `screencastFrameAck` 的观看者**恰好停在 3 帧**，而它的邻居（正常 ack）在同样时间窗内收到 **151 帧**——即 `maxFramesInFlight=3` 默认值的行为确认，且**一个卡住的观看者不会拖累其他观看者**。

### 2.4 多客户端附着：真实约束

**结论：允许多客户端，且每个客户端可以各自独立启动 screencast。**

源码依据：`PageHandler` 是**按 session 实例化**的，不是按 target 单例——

```cpp
// render_frame_devtools_agent_host.cc — 每个 session 一份 handler
session->CreateAndAddHandler<protocol::PageHandler>(...);
```

而 `startScreencast` 的"已激活"检查是 **handler 级**（`screencast_encoder_` 是成员变量），所以只拦截**同一 session 内的重复调用**：

```cpp
Response PageHandler::StartScreencast(...) {
  if (screencast_encoder_ || media_recorder_)
    return Response::ServerError("Screencast is already active");
```

`attached` 是 target 上的**布尔标志**，不阻止后续附着。`Target.attachToTarget`（带 `flatten:true`，官方称 flat 模式将取代非 flat，[crbug.com/991325](https://crbug.com/991325)）。

---

## 3. 关键实测结果

浏览器：Chrome for Testing 1228（**Chrome/149.0.7827.55**），`--headless=new`，页面为自绘 canvas 动画页（`/tmp/cdpexp/page.html`，800×600，requestAnimationFrame）。客户端：手写零依赖 WebSocket CDP 客户端（`/tmp/cdpexp/raw.mjs`）。

### 3.1 五路并发 screencast，两条路由混合 [实测]

| 观看者 | 路由 | `startScreencast` | 帧数 (4s) | fps | 均值帧 |
|---|---|---|---|---|---|
| V1 | browser 端点 + flat session | `{}` ✅ | 331 | 82.7 | 8077 B |
| V2 | 直连 `/devtools/page/<id>` | `{}` ✅ | 331 | 82.7 | 8077 B |
| V3 | browser 端点 + flat session | `{}` ✅ | 331 | 82.7 | 8077 B |
| V4 | 直连 `/devtools/page/<id>` | `{}` ✅ | 331 | 82.7 | 8077 B |
| V5 | browser 端点 + flat session | `{}` ✅ | 331 | 82.7 | 8077 B |

**五个客户端全部成功、全部独立收到帧、互不干扰，持续 4 秒无衰减。** 两条路由（浏览器端点 flat session、直连 page 端点）**都可以**。

其他实测结论：
- **同一 session 重复调 `startScreencast`**：返回 `{}`（不报错）——见 §2.4 的 handler 级检查，第二次调用在**同一 handler** 上会覆盖行为而非报错。
- **一个客户端在另一个客户端导航时仍然存活**：`frames_before: 350 → frames_after: 468`（`survived: true`）。
- **sessionId 是 per-connection 作用域的 [实测]**：把连接 A 拿到的 `sessionId` 拿去连接 B 用，返回 `-32001 "Session with given id not found."`。**这是实现时最容易踩的坑**——视图侧必须自己持有自己 attach 得到的 sessionId。
- **`Page.startScreenRecording` 在 Chrome 149 不存在** → `-32601 "'Page.startScreenRecording' wasn't found"`。协议 JSON 里有这个命令，但运行时未暴露。**不要依赖它做录像**。

### 3.2 独立进程跨进程附着 [实测]

两个完全独立的 OS 进程（`launcher.mjs` / `viewer.mjs`）：

```
Process A (pid 65561) 启动 Chrome，持有它
Process B (pid 65694) 独立进程，走 TCP 附着：
  startScreencast        : {}            ✅
  frames_in_3s           : 205
  fps                    : 68.3
  input_injected_from_B  : [[111,77]]    ✅ 点击真实到达页面
```

**结论：进程边界不构成障碍。**「宿主进程持有浏览器 + 另一进程/另一窗口渲染视图」在 port 模式下原生可行。

### 3.3 ⚠️ 修正：pipe 与 port **可以并存**

这是对既有文档 §2「pipe 是进程内私有 fd，第二个进程无法连接，所以这条路物理上走不通」的**重要修正**。

事实澄清：

| 说法 | 真实情况 |
|---|---|
| pipe 模式无 TCP 监听 | ✅ 正确 [实测]：`lsof` 无监听、无 `DevToolsActivePort`、9222/9223 均 `ECONNREFUSED` |
| pipe 模式下 screencast 完全可用 | ✅ 正确 [实测]：3 秒 180 帧 / 60 fps |
| **pipe 排他 ⇒ 无法同时开 port** | ❌ **错误** |

源码依据 [`remote_debugging_server.cc`](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/devtools/remote_debugging_server.cc) 的 `GetInstance()` 里，两个分支是**顺序且独立**的，各自把 `debugging_server_started = true`，**没有互斥检查**：

```cpp
if (command_line.HasSwitch(switches::kRemoteDebuggingPipe)) {
  debugging_server_started = true;
  server->StartPipeHandler();
}
std::string port_str = command_line.GetSwitchValueASCII(::switches::kRemoteDebuggingPort);
if (auto port = ParsePort(port_str)) {
  debugging_server_started = true;
  server->StartHttpServer(...);      // ← 两个都会跑
}
```

**[实测] 同时传 `--remote-debugging-pipe` + `--remote-debugging-port=9333`：**

```json
{
  "parent_process_over_pipe": { "getTargets_ok": true, "frames": 151, "fps": 60.4 },
  "tcp_side": {
    "http_json_version_ok": true,
    "secondClient_getTargets_ok": true,
    "secondClient_startScreencast": {},
    "secondClient_frames": 151, "secondClient_fps": 60.4,
    "secondClient_input_reached_page": "[[222,88]]"
  },
  "parent_pipe_still_alive_after_tcp_client": true
}
```

**两条通路同时满速运行，互不影响。**

对 Playwright 的意义（[实测]，`/tmp/cdpexp/pwtest/`）：

```js
const b = await chromium.launch({
  args: ['--remote-debugging-port=9455'],   // ← 关键
});
// Playwright 自身照常工作：page.evaluate → "pw-still-works"
// 且 TCP 端点真实可用：http://127.0.0.1:9455/json/version → Chrome/149
```

Playwright 的 `_innerDefaultArgs` **只对 `--remote-debugging-pipe` 抛错**，对 `--remote-debugging-port` **放行**：

```ts
if (args.find(arg => arg.startsWith('--remote-debugging-pipe')))
  throw new Error('Playwright manages remote debugging connection itself.');
```

（来源：[chromium.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromium.ts)）默认 launch 确实加 `--remote-debugging-pipe`（同文件的 `defaultArgs`），但**加 port 不会破坏它**。

**完整端到端验证**：Playwright 启动并以 port 模式驱动页面，**独立进程**同时 screencast 并注入输入：

```json
{
  "viewerProcessPid": 68128,
  "startScreencast": {},
  "frames": 342, "fps": 114,
  "input_from_viewer_reached_page": "{\"hits\":[[333,99]],\"agentTick\":14}"
}
```

注意 `agentTick: 14` —— 视图进程读到了 **Playwright 正在写入的页面状态**，证明两侧确实是同一个页面。

### 3.4 成本随观看者数量线性放大 [实测]

| 观看者数 | 每路 fps | 合计带宽 |
|---|---|---|
| 1 | 60 | **3.89 Mbps** |
| 5 | 60 ×5 | **19.43 Mbps** |

**每个观看者触发独立的 JPEG 编码**（每 session 一个 `DevToolsVideoConsumer` + `FrameSinkVideoCapturer`）。所以"多个 UI 表面同时看同一个浏览器"不是免费的——CPU 和带宽都 ×N。**单侧边栏视图 = 1 个观看者，成本按单路算。**

### 3.5 质量/带宽权衡 [实测]

| quality | fps | 均值帧 | 估算带宽 |
|---|---|---|---|
| 20 | 59.2 | 5.4 KB | 2.54 Mbps |
| 60 | 60 | 8.2 KB | 3.92 Mbps |
| 90 | 60 | 12.4 KB | 5.95 Mbps |

**quality 对带宽影响约 2.3×，对帧率无影响**（帧率由页面重绘驱动）。侧边栏用 q40–60 即可。

### 3.6 后台标签页不发帧 [实测]

`Target.createTarget({ background: true })` 创建的隐藏 target：

```
startScreencast: {}            ← API 接受
frames_from_background_target: 0
visibilityEvents: [false]      ← screencastVisibilityChanged 报告不可见
```

**后台/不可见页面产出 0 帧。** 这对"切走就停"是**天然利好**：即便忘了显式停流，后台也不会烧 CPU。配合主动 `Page.stopScreencast` 双保险（既有文档 §3 已验证 stop/restart）。

---

## 4. Playwright 特定事项

### 4.1 默认用什么连接

**`--remote-debugging-pipe`**（stdio fd 3/4，NUL 分隔 JSON）。来源：[chromium.ts `defaultArgs`](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromium.ts)：

```ts
override async defaultArgs(options, isPersistent, userDataDir) {
  const chromeArguments = this._innerDefaultArgs(options);
  chromeArguments.push(`--user-data-dir=${userDataDir}`);
  chromeArguments.push('--remote-debugging-pipe');   // ← 默认
  ...
}
```

Chromium 侧说明（[content_switches.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/public/common/content_switches.cc)）：*"Enables remote debug over stdio pipes [in=3, out=4] or over the remote pipes specified in the 'remote-debugging-io-pipes' switch."*

pipe 的好处是**不给整个机器开一个控制端口**；代价是**外部进程无法附着**——除非同时加 port（§3.3）。

### 4.2 在 Playwright 里取 CDP 帧

```js
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', async ev => {
  // ev.data: base64 jpeg; ev.metadata: 页面视口尺寸（不是图像尺寸！）
  await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
});
await cdp.send('Page.startScreencast', {
  format: 'jpeg', quality: 60, maxWidth: 800, maxHeight: 600,
});
```

**[实测]** 这条路径在 Playwright 默认 pipe 启动下完全可用（`inprocess_screencast_frames: 225` / 2.5s ≈ **90 fps**）。即 **Playwright 自己就能看，不需要额外进程**——如果视图和 agent 在同一个 Node 进程里，这是最简路径。

### 4.3 Playwright 自己的录制机制

Playwright 内部有一个 `Screencast` 类做**多客户端扇出**（[screencast.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/screencast.ts)）：多个 client（trace recorder、video recorder、dashboard）共享**同一条** CDP screencast，ack 用 **OR 逻辑**：

> "Ack when any client resolves (OR logic). This ensures that even if tracing throttles its response, other clients (like video) that resolve immediately keep frames flowing."

且 tracing 侧有**节流**：`const throttledRate = 200;`（[tracing.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/trace/recorder/tracing.ts)），避免 trace 写入拖慢实时流。

**视频录制** = screencast 帧 → ffmpeg → webm/mp4，`vp8 -deadline realtime -speed 8 -b:v 1M`（[videoRecorder.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/videoRecorder.ts)）。**trace 里的 Screencast 面板是离线重放的 JPEG 序列**，不是直播。

### 4.4 从另一进程做低延迟直播？

**官方无此 API，但技术上完全可行**——做法就是 §3.3 的"加 port"，然后外部进程走原生 CDP。Playwright 不提供、也不阻止这条路。

另一条既有官方路径是 `connectOverCDP`（[BrowserType docs](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)）——但注意官方两点警告：
- *"Connecting over the Chrome DevTools Protocol is only supported for Chromium-based browsers."*
- *"This connection is significantly lower fidelity than the Playwright protocol connection via `connect`."*

**[实测] `connectOverCDP` 与第三方 screencast 客户端可共存**（`/tmp/cdpexp/pwtest/cdpattach.mjs`）：

```
playwright_connectOverCDP          : connected, 1 context, 1 page
playwright_side_screencast         : 60.4 fps
third_client_while_pw_attached     : {} 60 fps     ✅
playwright_still_drives_after_third_client : true  ✅
playwright_screencast_still_streaming      : true  ✅
```

即：**Playwright（connectOverCDP）与第三方观看者可以同时附着同一浏览器，双方都满速。** 这给"宿主持有浏览器 + 视图看 + Playwright 驱动"提供了官方 API 级的实现路径。

### 4.5 playwright-mcp 的接入点

`--cdp-endpoint <endpoint>`（env `PLAYWRIGHT_MCP_CDP_ENDPOINT`）——指向 `http://127.0.0.1:<port>` 即可让 24 个工具接到我们自己启动的浏览器。来源：[playwright-mcp README](https://github.com/microsoft/playwright-mcp)。

---

## 5. VSCode Simple Browser / Electron 嵌入

### 5.1 VSCode Simple Browser：iframe 套 webview

源码（[simpleBrowserView.ts](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/simple-browser/src/simpleBrowserView.ts)）确认是 **literal iframe**：

```html
<iframe sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe>
```

外层 webview CSP 含 `frame-src *`（这是允许任意 framed 内容的关键），`enableScripts: true`、`retainContextWhenHidden: true`。

**官方限制原文**（[VS Code 1.109 release notes](https://code.visualstudio.com/updates/v1_109)）：

> "VS Code has long included the Simple Browser ... However, because it relied on iframes, there were several limitations: **website authentication wasn't possible, and common sites like Google, GitHub, and Stack Overflow couldn't be opened**."

微软自己的解决方案是 **`WebContentsView`**（vscode#277298 明确写 "rich integrated web browser using WebContentsView"）——与 §5.2 的结论一致。

**附加限制**：sandbox 列表**没有 `allow-popups`、没有 `allow-top-navigation`**，所以 OAuth/登录跳转独立于此也无法完成。

**没有专门的官方文档页**：`microsoft/vscode-docs` 全量 grep "Simple Browser"/`simpleBrowser` 只命中 release notes（v1_100、v1_109）与一处 UX 指南样例；`api/references/commands.md` 零条目。描述只存在于扩展内 `package.nls.json`。

### 5.2 Electron 嵌入选项

**`<webview>`** — 官方明确不推荐：

> "We currently recommend to not use the `webview` tag and to consider alternatives, like `iframe`, a `WebContentsView`, or an architecture that avoids embedded content altogether."

来源：[webview-tag docs](https://www.electronjs.org/docs/latest/api/webview-tag)。自 Electron 5 起默认禁用，需 `webPreferences.webviewTag: true`。且 [tutorial/web-embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds) 写明 *"We do not guarantee that the WebView API will remain available in future versions of Electron."* 它是 **OOPIF**——"essentially a custom element using shadow DOM to wrap an `iframe` element inside it"，因此**继承 iframe 的全部 framing 语义**。

**`WebContentsView`**（替代已废弃的 `BrowserView`，后者 29.0.0 起 deprecated）：

> "WebContentsViews are not a part of the DOM—instead, they are created, controlled, positioned, and sized by your Main process ... positioning them accurately with respect to DOM content requires coordination between the Main and Renderer processes."

来源：[web-contents-view docs](https://www.electronjs.org/docs/latest/api/web-contents-view)。

**关键架构限制：原生层叠在 renderer DOM 之上（或之下），没有 DOM↔native 的合成。** 你无法把 HTML 覆盖在 `WebContentsView` 上面——`contentView.addChildView(view[, index])` 只在**视图之间**定序。可见性逃生舱只有 `setBackgroundColor()`（支持 alpha）、`setBorderRadius()`（但 *"The area cutout of the view's border still captures clicks"*）、`setVisible()`、以及 guest 的 `transparent`——这些让**下层像素可见**，**不把输入还给 DOM**。

**默认值**（[webPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)）：`nodeIntegration: false`、`contextIsolation: true`（12 起）、`sandbox: true`（20 起）、`webviewTag: false`、`webSecurity: true`。**关闭 contextIsolation 会连带禁用进程沙箱**，无论其他设置如何。

**官方安全清单第 12 条**（[security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)）：

> "If your goal is to display a website, a browser will be a more secure option."

### 5.3 X-Frame-Options / `frame-ancestors` 无法被嵌入方绕过

- [MDN X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options)：`DENY` / `SAMEORIGIN`；`ALLOW-FROM` 已废弃；**在 `<meta>` 里设置无效，只认 HTTP 头**。
- [MDN CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors)：*"checks each ancestor ... If any ancestor doesn't match, the load is canceled"*；不支持 `<meta>`；不回退到 `default-src`。
- [WHATWG HTML §7.7](https://html.spec.whatwg.org/multipage/speculative-loading.html#the-x-frame-options-header) 给出算法：*"If navigable is not a child navigable, then return true."* —— **检查只对嵌套 navigable 生效**，这正是"顶层浏览器表面可行、iframe 不可行"的规范依据。
- [W3C CSP3 §6.4.2.1](https://www.w3.org/TR/CSP3/#frame-ancestors-and-frame-options)：`frame-ancestors` 覆盖 X-Frame-Options。

**没有任何 iframe 属性 / sandbox token / webview 选项能打败它们**——策略由**被嵌入方**下发、由**它自己的浏览器**执行。Electron 的绕过尝试未被采纳：electron#426（"Ignore X-Frame-Options"）合并后又被 revert；electron#26369（`frame-ancestors *` 在 `<iframe>` **和** `<webview>` 里都框不住）以 COMPLETED 关闭。

**结论**：对你不控制的第三方站点，唯一可行的嵌入是**顶层浏览器表面**——Electron `WebContentsView`、VSCode 新集成浏览器、CEF `CefBrowserView`，或一个被远程控制的独立浏览器。**iframe 路线的侧边栏结构上做不到**，这正是微软在 v1.109 里正在替换的东西。改写响应头的代理是唯一 iframe 兼容的替代，但那改变了你嵌入的对象。

---

## 6. 输入回传

### 6.1 ⚠️ 坐标映射：metadata 是页面尺寸，不是图像尺寸

**这是最容易写错的地方，实测已澄清。**

```
页面真实视口               : 756 × 413 CSS px (dpr 1)

请求 maxWidth=400,maxHeight=300:
  实际 JPEG 图像           : 400 × 219        ← 真正要用来映射的尺寸
  metadata.deviceWidth/Height: 756 × 413      ← 报的是页面视口，不是图像！

请求 maxWidth=200,maxHeight=200:
  实际 JPEG 图像           : 200 × 109
  metadata.deviceWidth/Height: 756 × 413      ← 同样不变
```

即 **`ScreencastFrameMetadata.deviceWidth/deviceHeight` 恒等于页面视口尺寸，与 `maxWidth`/`maxHeight` 无关**（协议里 `deviceWidth` 的注释是 *"Device screen width in DIP"*，这里 device ≙ 页面视口）。

于是映射规则是：

```
css_x = image_x * (viewport_width  / image_width)
css_y = image_y * (viewport_height / image_height)
```

其中 **`image_width/image_height` 必须取自真实解码后的 JPEG 尺寸**（或前端 `naturalWidth`/`getBoundingClientRect`），**不能**用 metadata。

**[实测] 验证**：手算 `(200,150)` 图像坐标 → `(200,150)` CSS，注入点击后页面收到 `[{"x":200,"y":150}]`，`mapping_confirmed: true`。

Skyvern 的开源实现提供了可直接抄的参考（含 `object-contain` **letterbox 留白**处理，[cdpInputUtils.ts](https://github.com/Skyvern-AI/skyvern/pull/4904)）：

```ts
export function mapCoordinates(clientX, clientY, rect, vpW, vpH) {
  const containerAspect = rect.width / rect.height;
  const imageAspect = vpW / vpH;
  let renderedW, renderedH, offsetX, offsetY;
  if (containerAspect > imageAspect) {          // 容器更宽 → 左右留白
    renderedH = rect.height; renderedW = rect.height * imageAspect;
    offsetX = (rect.width - renderedW) / 2; offsetY = 0;
  } else {                                       // 容器更高 → 上下留白
    renderedW = rect.width; renderedH = rect.width / imageAspect;
    offsetX = 0; offsetY = (rect.height - renderedH) / 2;
  }
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (localX < 0 || localX > renderedW || localY < 0 || localY > renderedH) return null;
  return { x: Math.round(localX * (vpW / renderedW)),
           y: Math.round(localY * (vpH / renderedH)) };
}
```

注意：若 CSS 里用 `object-contain`，**必须**做 letterbox 反算；示例里的参数 `vpW/vpH` 应传**真实图像尺寸**。另外还需叠加 `metadata.scrollOffsetX/Y`、`offsetTop`、`pageScaleFactor`（若要支持滚动视图与缩放）。

### 6.2 事件分发

```js
// 鼠标
Input.dispatchMouseEvent({
  type: 'mousePressed'|'mouseReleased'|'mouseMoved'|'mouseWheel',
  x, y,                       // CSS px，相对主 frame 视口左上角
  button: 'left'|'right'|'middle'|'none',
  buttons, clickCount, modifiers,
  deltaX, deltaY,             // mouseWheel 用
})
// 键盘
Input.dispatchKeyEvent({
  type: 'keyDown'|'keyUp'|'rawKeyDown'|'char',
  key, code, windowsVirtualKeyCode, nativeVirtualKeyCode,
  text, unmodifiedText, modifiers,
})
// IME / emoji（不走按键路径）
Input.insertText({ text })
```

`modifiers` 位掩码：**Alt=1, Ctrl=2, Meta/Command=4, Shift=8**。

**[实测]** `Input.dispatchMouseEvent` + `Input.dispatchKeyEvent` 均生效，页面收到 `[[400,300]]` / `[[333,99]]`。

### 6.3 坑

| 坑 | 说明 |
|---|---|
| **sessionId 作用域** | [实测] sessionId **绑定在建立它的那条连接上**，跨连接使用直接 `-32001`。视图侧必须用自己 attach 得到的 id。 |
| **坐标基准** | `x,y` 是**主 frame 视口坐标**，不是页面/文档坐标。滚动、缩放（`pageScaleFactor`）、`offsetTop` 都要单独叠加。 |
| **letterbox** | 见 §6.1。 |
| **`type: 'char'` 才产生文本输入** | 只发 `keyDown` 可能不触发输入；需要在 `keyDown` 时带 `text`，或补 `char`。Skyvern 的做法：仅对可打印单字符、且 `eventType === 'keyDown'` 时才带 `text`。 |
| **右键菜单** | 前端需 `onContextMenu={e => e.preventDefault()}`，否则本地菜单会盖住画面。 |
| **不可信输入** | `Input.dispatch*` 产生的是**受信任**事件（isTrusted=true），能绕过部分合成事件检测。但若走 Electron 原生层注入（Cua 的 `trusted` 路线），在 macOS 上**会激活窗口**。 |
| **没有 IPC 级 ack** | 输入不回执，无法直接知道页面是否消费了事件；需要靠 screencast 画面或 `Runtime.evaluate` 反查。 |
| **控制权仲裁** | 相机（画面）可多路共享，但**光标只有一个**。Skyvern 用显式 "take control"/"cede control" 加锁，避免用户与 agent 抢鼠标。多用户/多表面场景必须自己设计这个仲裁。 |

---

## 7. 对本仓库方案的影响

既有文档的架构（宿主持 port 模式浏览器 → 视图 screencast + agent `--cdp-endpoint`）**成立且已被本次实测强化**。需要更新的三点：

1. **§3.3 的修正**：不必"自己启动浏览器才能拿到 port"。若某个既有 provider 已在用 pipe，**给它追加 `--remote-debugging-port` 即可同时获得外部视图能力**，不必推翻重来。这降低了架构改造的侵入性。
2. **§6.1 的坐标映射**必须改用**真实图像尺寸**，不要用 metadata —— 既有文档 §5 写的「screencast 帧是缩放后的（实测 756×413 对应 1280×720 视口）」把两者混在一起了，按新数据应是：metadata 报页面视口，图像尺寸由 `maxWidth` 决定。
3. **多观看者成本 ×N**：单侧边栏视图是 1 路，成本可控；但若将来加"每 session 一个视图"或缩略图墙，需要按 §3.4 重新估算。

**推论（供决策）**：既然 `--headless=new` 下 screencast 完全可用（本报告全部实验都在 headless 下跑出 60–114 fps），**"真无头 + 侧边栏有画面"已无技术障碍**，不必为了显示而弹出可见窗口。

---

## 8. 复现脚本

全部在 `/tmp/cdpexp/`（未纳入仓库）：

| 脚本 | 验证内容 |
|---|---|
| `raw.mjs` | 零依赖 WebSocket CDP 客户端（Node 内置 WebSocket 对 CDP 握手失败，故自写） |
| `exp5.mjs` | 5 路并发 screencast，两条路由 |
| `exp6.mjs` | session 作用域、重复 start、5 路并发、输入注入、导航存活、不 ack 阻塞、quality 权衡 |
| `exp7.mjs` | 坐标映射、后台 target、`startScreenRecording` 缺失、成本放大 |
| `exp8.mjs` | JPEG 真实尺寸 vs metadata（§6.1 的数据来源） |
| `launcher.mjs` + `viewer.mjs` | 双进程跨进程附着 |
| `pipe.mjs` / `both.mjs` | pipe 无 TCP 监听 / pipe+port 并存 |
| `pwtest/pwdriver.mjs` + `pwviewer.mjs` | Playwright 驱动 + 独立进程观看 |
| `pwtest/cdpattach.mjs` | `connectOverCDP` 与第三方 screencast 共存 |

---

## 附：来源清单

**协议/源码**：[CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/) · [page_handler.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/page_handler.cc) · [devtools_video_consumer.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_video_consumer.cc) · [remote_debugging_server.cc](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/devtools/remote_debugging_server.cc) · [content_switches.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/public/common/content_switches.cc) · [devtools_http_handler.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_http_handler.cc) · [devtools_session.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_session.cc) · [devtools_agent_host_impl.h](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_agent_host_impl.h) · [render_frame_devtools_agent_host.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/render_frame_devtools_agent_host.cc) · [devtools_pipe_handler.cc](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_pipe_handler.cc)

**Playwright**：[chromium.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromium.ts) · [screencast.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/screencast.ts) · [crPage.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/crPage.ts) · [videoRecorder.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/videoRecorder.ts) · [tracing.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/trace/recorder/tracing.ts) · [dashboardController.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/tools/dashboard/dashboardController.ts) · [connectOverCDP docs](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) · [playwright-mcp README](https://github.com/microsoft/playwright-mcp)

**VSCode / Electron / Web 规范**：[simpleBrowserView.ts](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/simple-browser/src/simpleBrowserView.ts) · [VS Code 1.109 release notes](https://code.visualstudio.com/updates/v1_109) · [webview-tag](https://www.electronjs.org/docs/latest/api/webview-tag) · [web-contents-view](https://www.electronjs.org/docs/latest/api/web-contents-view) · [browser-view](https://www.electronjs.org/docs/latest/api/browser-view) · [security tutorial](https://www.electronjs.org/docs/latest/tutorial/security) · [web-embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds) · [MDN X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options) · [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors) · [WHATWG HTML §7.7](https://html.spec.whatwg.org/multipage/speculative-loading.html#the-x-frame-options-header) · [W3C CSP3](https://www.w3.org/TR/CSP3/#frame-ancestors-and-frame-options)

**产品**：[browser-use recording_watchdog.py](https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/browser/watchdogs/recording_watchdog.py) · [browser-use cloud live-preview](https://docs.browser-use.com/cloud/browser/live-preview.md) · [browser-agent-template](https://github.com/browser-use/browser-agent-template) · [Skyvern PR #4904](https://github.com/Skyvern-AI/skyvern/pull/4904) · [Skyvern channels/vnc.py](https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/skyvern/forge/sdk/routes/streaming/channels/vnc.py) · [Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view) · [Browserbase session replay](https://docs.browserbase.com/platform/browser/observability/session-replay) · [vercel-labs/agent-browser cdp_loop.rs](https://raw.githubusercontent.com/vercel-labs/agent-browser/main/cli/src/native/stream/cdp_loop.rs) · [Claude computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) · [anthropic-quickstarts entrypoint.sh](https://raw.githubusercontent.com/anthropics/claude-quickstarts/main/computer-use-demo/image/entrypoint.sh) · [Cursor browser docs](https://cursor.com/docs/agent/tools/browser) · [Devin previews](https://docs.devin.ai/desktop/previews) · [OpenHands browser-snapshot.tsx](https://raw.githubusercontent.com/OpenHands/agent-canvas/v1.2.0/src/components/features/browser/browser-snapshot.tsx)
