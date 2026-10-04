# Computer PiP 审查与修订

日期：2026-09-19。范围：`plugins/dsh-cua-pip`。本次要求取代 2026-09-17 设计文档中的“Cua 调用自动弹出、turn/end 收起、45 秒无拉帧回收”行为。

## 产品约定

画中画是 Agent 主动调起的 Computer Use 辅助工具。Agent 决定是否打开、目标应用和关闭时机。普通 Computer Use 调用不会创建预览；已经打开的预览可以跟随同一会话正在操作的窗口。

显示归属当前会话，捕获归属 Host 会话。切换会话不停止后台工作；返回时恢复对应状态。`turn/end` 不关闭预览。用户关闭后，只有 Agent 的显式打开操作能再次显示。

## 审查发现与修复

| 原实现问题 | 影响 | 修复 |
|---|---|---|
| `tool/call` 自动打开，`turn/end` 收起 | 不符合 Agent 按需调起，跨轮次状态丢失 | 注册 `computer_pip`，独立保存 `visible` 与工具活动 |
| 45 秒无 `/frame` 就回收，最多 3 个 watcher 直接 LRU 淘汰 | 切换会话导致后台监控停止 | 会话 watcher 显式 retain，共享并发上限并轮转捕获 |
| 仅解析普通调用参数，不关联结果或 Code Mode 子调用 | 启动应用后没有窗口 ID，或 Agent 在 `run_code` 内操作时漏更新 | 普通与嵌套调用按 session/callId 关联；从结果解析 PID，再解析准确窗口 |
| retarget 与正在执行的抓帧交错 | 旧帧、旧重绑结果覆盖新应用状态 | watcher 与 controller 校验请求代次；切目标即清旧帧 |
| 客户端发现 watcher 丢失后自动 watch | 用户关闭后可能再次复活 | 客户端只读 Host 状态，不做自动打开 |
| 标题栏、底部状态栏占用空间；仅自由拖动 | 画面不占满，位置容易越界 | 全卡预览、左右吸附、视口约束、hover/focus 显示模糊背景关闭 icon |
| 延迟关闭/聚焦请求只绑定 session | 旧请求可能操作刚重开的预览或另一个窗口 | 关闭校验 `openedAt`；聚焦校验显示画面的 pid/windowId |
| 持续向固定调试端口发送日志 | 每次轮询产生无关请求 | 清理插件中的临时调试埋点 |

## 工具与操作边界

`computer_pip` 支持 `open`、`resize`、`status`、`schedule_close`、`close`。会话 ID 从工具执行上下文取得；应用可按名称、bundle ID 或路径选择，也可指定已有 PID/窗口。底层仍使用已有 Cua provider 完成应用操作，PiP 不另造一套鼠标键盘工具。

Clock 示例：打开 Clock 预览，Agent 通过 Cua 启动计时并确认状态，再设置 `schedule_close(30)`。期限存于 Host，轮次结束或前端切走都不影响到期关闭。此动作只关闭预览，不会隐式停止 Clock 计时或退出 Clock。

本机只读驱动核验：Cua Driver 0.28.1 提供后台 `launch_app`、窗口枚举与 `get_window_state`；没有 `get_app_state`。ima、Cursor、Clock 可在本机应用目录中识别。后台输入是否生效仍受应用 Accessibility 实现、窗口状态和系统权限限制；不能承诺每一个系统应用在任何状态下都可无前台操作。

实机捕获复核：驱动报告 Accessibility 和 Screen Recording 已授权；新版 `captureFrame` 成功读取已打开的 Cursor（640×640）和 ima（639×411）。当时没有打开的 Clock 窗口，未为此启动应用或操纵计时。

## 验证与剩余范围

验证涵盖函数和接口，不渲染组件或断言 DOM：Agent 显式打开、跨轮次与 60 秒切换保活、30 秒到期关闭、关闭与重开交错、过期结果隔离、MCP 错误与响应形态、窗口重绑、调度并发、拖动/吸附几何与会话帧隔离。插件还执行 TypeScript、构建和客户端模块注入检查。全仓依赖约束检查仍报 `dsh-synapse` 的既有共享 runtime 依赖/导入问题，不属于本次修改范围。

最终结果：10 个测试文件、197 项测试通过；插件 TypeScript、构建及客户端模块注入检查通过。

未执行浏览器端到端，也未真实操作 Clock 启动一次计时。Host 重启不恢复之前的 watcher 和关闭定时器，需重新显式打开；客户端刷新会重置本地拖拽位置。正常会话切换和前端重挂载不影响仍运行的 Host 状态。

实现入口：`src/tool.ts`（Agent 工具）、`src/controller.ts`（会话生命周期）、`src/watcher.ts`（捕获调度）、`src/cua.ts`（驱动适配）、`src/client/float.tsx`（浮窗）。

## 会话边缘定位修正

根据实际截图，原拖动坐标取自全窗口 `shell.overlay`，导致左侧吸附落在会话列表上。浮窗现在使用主会话 scrollport 的可见矩形，扣除底部 composer 区域，默认吸附会话左下角；局部拖动坐标不再包含侧栏偏移。位置变化与尺寸变化均会重新测量，主会话不存在或被侧栏全屏遮盖时隐藏 UI，Host watcher 继续保活。

补充验证：新增 15 项会话边界与主区域选择测试，合计 212 项测试通过；TypeScript、客户端构建和模块注入检查通过。未运行浏览器端到端验证。

## Agent 调整窗口宽高

`computer_pip(action="resize", width=1024, height=768)` 默认调整已绑定的原生应用窗口，单位为系统逻辑单位（macOS 点）。驱动接口为 `set_window_frame`，要求完整 x/y/width/height，因此先读取准确窗口的位置，调整一次后再读取同一窗口的实际 bounds。应用拒绝、权限不足和复读失败会明确返回错误，不自动重试窗口修改；应用自身尺寸限制以复读结果为准。

`resizeTarget="preview"` 则只调整 PiP 卡片的 CSS 宽高，偏好放在会话状态中，客户端保持完整画面并适配主会话边界。原生尺寸和卡片尺寸独立返回为 `windowBounds` / `previewSize`，避免将截图缩放像素混用于原生窗口操作。

同一会话或同一个原生窗口的调整串行执行，完成时检查会话打开代次和目标身份，再清除旧尺寸帧、恢复保活捕获；不会修改定时关闭期限。仅修改预览时不调用应用驱动、不重置抓帧，也不丢失已有画面。resize 明确拒绝 `app` / `pid` / `windowId` 选择参数，避免模型指定另一个应用时却静默修改当前窗口。

验证结果：14 个测试文件、293 项测试通过；TypeScript、完整插件构建与客户端模块注入检查通过。驱动协议通过本机只读 `describe` 核对，本轮未实际调整用户应用窗口或运行浏览器端到端验证。

## Clock 实测回报复核

用户后续报告预览已关闭，但秒表停止并归零。只读核对本机对应 DSH 会话 `session-874d68b2-fdfd-449f-85ed-9fd5cbbeb894` 的原始工具事件，时间均为 **2026-09-19，北京时间**：

| 时间 | 可确认的事实 |
|---|---|
| 14:24:21 | Clock `StartStopButton` 标签为“停止”，AX 读数约 16:40 |
| 14:24:31 | 独立复读为 16:50.45，说明该时刻秒表确在递增 |
| 14:24:33 | `schedule_close(30)` 返回 `closeAt=1789799103684`，对应 14:25:03.684 |
| 14:37:31 | `computer_pip status` 返回 `open:false`、`frames:0`，确认此时预览已关闭 |
| 14:37:33 | 首次观察到旧 MCP session `has ended`；这不是 session 实际结束的时间戳 |
| 14:37:40 / 14:37:46 | Clock 同一 PID/窗口的 AX 读数为 0 秒，按钮为“启动” |

关闭期限与“首次读到 MCP 已结束”相隔约 12 分半，因此不能声称两者同时发生，也无法从这次采样精确确定预览实际关闭或秒表归零的时刻。该 DSH 会话记录中，最后一次成功开始计时之后没有停止/复位秒表的应用操作，也没有显式 `end_session`。

源码复核确认：PiP 的关闭路径只更新状态、清定时器及 `unwatch`；watcher stop 只清缓存和本地调度，不结束 Agent 的 MCP transport、不杀捕获进程，也不操作 Clock。`dsh-computer-tools` 的启动清理仅匹配孤立 Playwright 进程，与 CuaDriver/Clock 无关。本机桌面服务日志仅覆盖旧启动，无法补齐该事件的因果链。

这些采样只能证明当次观测报告了零读数和“启动”按钮，**不能排除陈旧观测，也不能证明秒表实际归零**。原因未确定，不能归因于用户手动操作、Clock 自身或 PiP 关闭。`status.running` 表示该会话的 Computer Use 活动，不能作为秒表计时状态。此次复核未重开 PiP、未恢复 MCP session、未操作 Clock，生产代码未因未证实的归因而调整。

## 连续预览刷新修正

原链路是 Host 约每秒截图一次，客户端每次 GET 完成后再等一秒；两层独立采样造成明显延迟。现在改为：可见预览以 5 fps 为上限连续采样，完成即经 `/cua-pip/stream` SSE 推送；后台会话约 1 fps 保活。调度按上一次捕获开始时间计算，不再额外叠加捕获 RTT。首帧立即开始，所有会话共享最多三个捕获槽。

慢客户端只保留一张最新待发帧，持续不能排空会断开；关闭事件优先于后续新帧，不能被同会话的重开覆盖。调整应用窗口只刷新帧，不结束已有订阅。客户端关闭/切换时释放连接；网络故障自动重连，推送不可用时才串行轮询。三秒未收到新的驱动采样结果会显示中断/重连角标，避免一直展示旧画面却看不出失效。

### 驱动权限与录制的区别

本机 Cua Driver 0.28.1 的 `permissions status --json` 返回 Screen Recording 和 Accessibility 已授权。`describe start_recording` 明确表示 `record_video:true` 将主显示器录制为 H.264 30fps 的 `recording.mp4`；当前工具目录没有指定窗口的实时视频输出接口。该 PiP 没有启动全屏录制，也没有申请新权限或修改驱动配置。

### 捕获不得改变 Agent 的观察状态

核对官方 0.28.1 源码发现，`get_window_state(include_accessibility_tree:false,max_dimension:640)` 仍可能写入按 PID/window ID 共享的 `resize_registry`。PiP 的缩略图比例会干扰 Agent 大截图的后续像素点击；与此前坐标越界现象相符，但不据此断言它是那次报错的唯一原因。

先验证了 `verify_state` 的 observation-only 路径：不会改变动作缓存，但最终截图带 AX/大图开销，本机完整推送链路仅约 1.61fps，未选作最终方案。

最终采用公开 `zoom` 图像接口，省略可选 `pid` 以避免写入 `zoom_registry`。矩形覆盖其 u32 图片域，驱动裁切实现将范围 clamp 到整幅窗口图像，不读取或修改 Agent 的截图坐标缓存。捕获前后分别读取准确的 PID/window ID、窗口层级与 bounds；身份或尺寸位置改变则丢帧。不会退回有状态的缩略截图路径。该接口固定输出最多 500px 宽的 JPEG，卡片放大不会提高源分辨率。

源码核对依据：

- [recording_tools.rs（0.28.1）](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.1/libs/cua-driver/rust/crates/cua-driver-core/src/recording_tools.rs)
- [get_window_state.rs（0.28.1）](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.1/libs/cua-driver/rust/crates/platform-macos/src/tools/get_window_state.rs)
- [zoom.rs（0.28.1）](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.1/libs/cua-driver/rust/crates/platform-macos/src/tools/zoom.rs)
- [capture_utils.rs（0.28.1）](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.1/libs/cua-driver/rust/crates/cursor-overlay/src/capture_utils.rs)

### 实测

2026-09-19 15:33（北京时间），已有 Cursor 窗口，12 帧：

| 指标 | 结果 |
|---|---|
| 路径 | 前后窗口校验 → 全窗 JPEG → watcher → SSE → 本地 HTTP reader |
| 实际接收帧率 | 4.87 fps |
| 平均捕获耗时（含两次窗口校验） | 197 ms |
| 平均接收帧间隔 | 205 ms |
| Host 收到截图至 HTTP reader 接收 | 0–1 ms |
| 图像 | 500×313，约 36,780 base64 字符 |

原始指标见 [benchmark JSON](./cua-pip-live-preview-benchmark-2026-09-19.json)。这验证的是驱动到 HTTP 的连续更新与传输延迟，没有进行浏览器渲染或真实秒表计时验收。它是约 5fps 的连续窗口截图，**不是 30fps 原生窗口视频流**；后者需要 Cua Driver 暴露对应的单窗口流接口。

最终验证：18 个测试文件、359 项测试通过；TypeScript、完整插件构建与客户端模块注入检查通过。新增测试覆盖订阅生命周期、立即推送、真实本地 HTTP 传输、背压丢旧帧、关闭不可被重开覆盖、刷新不断流、只读全窗捕获与前后身份校验。

## 完整 Clock 记录审计与运行时修复

输入为用户导出的 `/Users/jiahaoqian/Downloads/后台启动秒表并定时关闭.md`，共 3188 行。导出记录中的 Agent 判断是待核验的证据，不是本轮指令。最后一轮从 **2026-09-19 16:58:48 到 17:26:22（北京时间）**，约 28 分钟。按导出工具条目统计：

| 用户轮次开始（北京时间） | 工具调用 | 失败 | 点击 | 菜单调用 |
|---|---:|---:|---:|---:|
| 14:23:30 | 20 | 4 | 4 | 0 |
| 14:37:27 | 26 | 2 | 0 | 0 |
| 15:09:02 | 32 | 0 | 1 | 0 |
| 16:58:48 | 130 | 7 | 31 | 13 |

最后一轮重复执行停止/复位/启动、猜坐标与切换标签，误将 Clock 从 1024×768 改成 1376×847。`invoke_menu` 最后明确报 `target window 68120 did not become stably key and frontmost`；这说明该路径尝试了前置窗口，与后台要求相冲突。没有连续焦点证据支持“全程未前置”的总结。

最终几次读数递增只能支持当时的局部结果，不能把整个流程算作验收通过。AX 与图像矛盾、后续切页后出现较大读数，都不足以证明所有早先状态是缓存，也不足以确定 App Nap 是原因。两张图片哈希不同只说明字节变化；光标等变化不能证明秒表区域新鲜。之前把“编译通过 / Cursor 连续截图 / 点击当时递增”当作完整 case 成功的依据，需要纠正。

### 两个已查明的工程缺口

1. **磁盘构建与 DSH 实际运行版本不同。** 审计时旧 Host 的 `/cua-pip/resize`、`/cua-pip/stream` 都返回 404，status 没有新增尺寸字段。已安装 HMR 只监听模块 `change`；原 tsdown `clean:true` 会删除再创建 bundle，存在漏重载路径。已改为 `clean:false`，新增健康路由和 `status.runtimeVersion`，并提供只读 `scripts/verify-live.mjs`。定向触发已有 bundle 的 change 后，新 Host 已加载，无需重启整个 DSH。
2. **动作绑定在 MCP 结果投影中丢失。** 正式 Driver 的 canonical `structuredContent` 包含 `snapshot_id` 和 `elements[].element_token`，但 Agent 看见的文本只有树索引，实际调用裸 `element_index` 被拒绝。PiP 现在在 `tools/post-execute` 中提取真实绑定、窗口 bounds 和截图尺寸，经 `additionalContexts` 交给 Agent，保留原始 `content/value`，避免破坏官方 MCP 图片收尾。错误、被拦截或被其他插件替换的投影不再补上下文；应用文本作为 JSON 数据输出。

捕获与动作坐标也已隔离：PiP 的后台缩略图不再写 Agent 的共享像素缩放缓存。新增指引禁止手工猜缩放比例、为演示而复位、违反后台限制的菜单以及无限试错。指引有助于收敛行为，但本身不是强制执行层，仍需真实 case 验证。

当前运行证据保存在 [审计证据 JSON](./cua-pip-case-audit-evidence-2026-09-19.json)。其中健康检查来自实际 Host，不是构建文件；`/resize` 和 `/stream` 的 OPTIONS 返回 405 并给出正确 Allow，证明路由已注册。此检查不证明前端视觉状态或 Clock 行为。

### Cua Driver 单窗口录制补丁

[补丁、构建脚本与使用说明](../patches/cua-driver-0.28.1/README.md) 以官方 `cua-driver-rs-v0.28.1` 的固定 commit 为基线，增加 `start_recording(video_target:{pid,window_id})`。macOS 使用 desktop-independent 单窗口 ScreenCaptureKit filter，核验窗口归属；不支持、目标不存在或启动失败时明确报错，不回退整屏捕获。请求窗口授权使用嵌套 `video_target`，外层 ID 不能替换其目标；输出目录权限独立校验。

原生 `get_window_state` 文本也增加快照与几何信息，`list_windows` 文本列出具体窗口，减少不同 MCP 客户端的投影差异。24 项针对性 Rust 测试、`cargo check --locked`、release 构建与 staging 包签名检查已通过。产物为 `patches/cua-driver-0.28.1/build/CuaDriverLocal.app`；正式版 `/Applications/CuaDriver.app`、其 daemon、已有权限及 MCP provider 配置未被修改。

**这份补丁输出单窗口 MP4，尚未实现 SCStream 到 PiP 的实时视频传输，也未验证 Clock 的后台重绘。** Local 包为独立 ad-hoc 签名身份，不能承诺继承正式版录屏授权，需要用户为 Local 包授权后再做原生验证。编译和 24 项测试不等于该 case 已完成。

### 仍未通过的验收项

必须在实际加载版本与驱动身份都明确的条件下，以一次有界流程验证：目标窗口后台启动、用真实绑定执行必要的一次启动、连续新鲜读数递增、期间 DSH 保持前台、Host 30 秒关闭预览，以及关闭后同一 Clock 实例继续运行。需要原生视频时，还须接通到 PiP 的实时帧传输，不能把已存在的 MP4 文件接口当作直播能力。

本轮只做记录审计、源码修复、函数/接口测试、原生构建和运行时只读检查，没有再次点击、停止、复位 Clock，没有运行浏览器端到端。完整 Clock case **仍未宣告成功**。

## 后续修复：真正接通单窗口流

用户继续反馈目标窗口闪到前台。复核确认上面的 MP4 补丁与实际 PiP 是两条路径，旧 PiP 仍走 Cua `zoom`，后台约束仅为提示词。驱动源码还显示 `invoke_menu` 明确前置窗口；部分坐标 `click` 即使 `delivery_mode=background` 也会临时激活应用。不能只从调用参数判断没有抢焦点，也不能把未接入的 MP4 补丁当作 PiP 已使用。

本次将实际 PiP 像素源替换为 `plugins/dsh-cua-pip/native/WindowCapture.swift`：

- 唯一来源为 `SCContentFilter(desktopIndependentWindow:)` + 持久 `SCStream`，精确核验 PID/window ID/窗口层。无 display filter、桌面裁剪、激活或 screenshot fallback。
- 原生最长边 1024px，目标 30fps；新样本经受界限的 JSON/JPEG 管道进入 Host，再由 SSE 送至现有 PiP。它不是 MP4/WebRTC，且不录音频或麦克风。
- 同一窗口流跨会话引用计数，切换会话不中断录制。最后一个预览关闭、会话归档、目标切换、Host 退出或插件卸载时释放；系统结束共享或权限失败时不会自动重新开始。
- 帧样本时间与 idle/健康心跳分离，缓存重读不冒充新帧；即使原生不断提供相同内容，也不能据此证明秒表读数递增。
- `tools.guard` 强制拒绝已知前置操作、桌面操作、不安全的坐标点击/聚焦及驱动侧不可审查脚本，覆盖 DSH Code Mode 子调用。保留精确窗口的 AX 操作，不支持则明确拒绝。此 guard 不是 OS 隔离沙箱，不能承诺任意应用行为都不自行激活。
- 对已运行应用只读取现有窗口，不再发送 reopen/launch。正式 Cua Driver、其权限和 provider 配置保持不变。

### 本轮原生只读证据

对已有 Clock `pid=89831, window_id=68120` 做 8 秒捕获，没有启动/点击/停止/复位/resize/前置操作。采集收到 228 帧，1024×768，平均样本间隔 33.815ms；helper 正常停止、exit=0。独立 `NSWorkspace` 激活通知和 50Hz 前台采样持续 10 秒，共 500 次，初始/最终前台均为 PID 33209，未出现 Clock 前台采样或激活事件。

首帧中窗口左上角可见系统共享标记；画面为完整应用窗口，不是当时前台应用的桌面裁剪。原始图像和逐帧元数据在本机 `.tmp/native-window-capture-verification/`。这轮所有图像 hash 一样，图像中秒表读数未变化，因此**后台秒表递增与完整动作 case 仍未通过验收**。

实际 Host `/cua-pip/health` 已返回 `2026-09-19-native-window-stream-v3`、`capture=screencapturekit-window`、`backgroundPolicy=strict-window-v1`，helper 构建路径存在。原生 helper 预检允许屏幕录制；这不意味着可以继承官方 Driver 签名或其他机器无需授权。未触发浏览器端到端。

### 实际 Host 验证发现权限归属差异

随后在用户原 Clock 会话执行原生流到 Host/SSE 的 30 秒检查，结果 **0 帧，录屏权限被拒绝**。定时截止 `1789816372321`，实际关闭 `1789816372322`，偏差 1ms；33 秒内 1650 次前台采样与激活通知未观察到 Clock 前置，关闭后原生流数为 0。原始记录为 `.tmp/native-window-capture-verification/session-report.json`。

原因是直接 spawn 的 helper 继承调用宿主的 TCC responsible-process 身份：前面的 Codex 工具环境检查返回 true，并不代表 DSH 可以录屏。最终实现改为 LaunchServices `open -n -g`，通过私有本地 socket/token 连接 Host，使用独立 `DSH Window Capture` 身份；后台不提示、显式权限脚本才发起请求。修订版标识为 `2026-09-19-native-window-stream-v4`，health 增加 `nativeCapture.launch=launchservices`。

独立身份的真实只读预检返回 `screenRecording:false`，本轮已发起系统权限请求，等待用户在 macOS 完成授权。不能静默继承/重置 Cua Driver 或 Codex 的权限。**单窗口原生代码和直接 helper 的图像已验证；最终 DSH 内的实时流、系统图标及后台输入完整流程仍须授权后复验。** 所有测试成功也不能替代这一步。

最终验证：21 个测试文件、465 项函数/接口测试通过，Swift 原生契约测试、TypeScript、完整插件构建及客户端模块契约检查通过。实际 Host 已加载 v4，`nativeCapture.launch=launchservices`，活动流数为 0；独立身份授权仍为 false。全仓 `check-dependency-contracts` 被既有 `dsh-synapse` 缺失共享 runtime 依赖/导入问题阻塞，未为本任务修改无关插件。

### 用户授权后的实际链路复验

用户确认授权后，LaunchServices 独立身份预检已返回 `screenRecording:true`。2026-09-19 19:31（北京时间），同一个 Clock 窗口经过真实 DSH Host/SSE 的 30 秒检查收到 **848 帧，1024×768，平均接收间隔 35.153ms（约 28.4fps）**，无采集错误。截止 `1789817504724`，实际关闭 `1789817504725`，延迟 1ms；收到 SSE 终止事件，活动流恢复 0，helper 进程退出。

33 秒内 1650 次前台采样中 Clock 出现次数为 0，也没有 Clock 激活通知。记录到另两个应用之间的前台切换，不能把本轮表述为“前台完全未变化”。首末图像完整显示 Clock，左上角可见共享标记；所有帧的图像内容相同，秒表一直显示 `00:42.13`。

两次只读 `get_window_state(include_screenshot=false)` 均返回 `exact_window.status=ax_unresolved`，AXWindow 数为 0；accessibility、window_pointer、pid_keyboard 三条后台路径均被驱动以 `off_space_or_ax_unresolved` 拒绝。正式 driver-daemon 的辅助功能/录屏授权为 true，因此不能把这个动作拒绝简单归因于新 helper 未授权。未执行驱动建议的 foreground 升级，也未点击、停止、复位或重新打开 Clock。

**结论：DSH 单窗口采集、传输、无目标前置证据和 30 秒关闭已通过；Clock 读数递增与完整后台操纵仍未通过。** 汇总见 [原生窗口证据](./cua-pip-native-window-evidence-2026-09-19.json)，原始 Host 报告、首末帧位于 `.tmp/native-window-capture-authorized/`。

## v5：用户授权的桌面降级

用户随后明确允许：某应用必须前台才能响应时，可以降级为直接操作其桌面。原先全局禁止前台的策略据此改为 `background-first-desktop-fallback-v1`，不修改已经验证的单窗口录制链路。

- `computer_pip(action="control", controlMode="desktop", pid, windowId, reason)` 声明降级，不直接执行窗口激活或输入。工具返回控制模式、精确目标、原因和失效时间，并渲染桌面接管提示；无需先打开 PiP。
- Agent 指引要求先用后台语义操作；驱动明确要求前台或有界尝试/新观测确认无效时，先告知用户，再声明降级。沿用用户此次授权，不反复追问；如果后续任务明确要求仅后台，则不得使用该降级。Host 验证窗口存在和声明字段，但不把 Agent 填写的原因当成已证实的系统事实。
- guard 在桌面模式下允许绑定窗口的前置、菜单、foreground delivery、像素输入及拖拽；必要时允许显式 desktop 范围输入和 `get_desktop_state`。拒绝混合桌面坐标与窗口 ID/AX 绑定，其他窗口需要新的声明。驱动侧不可审查脚本与连续整屏录制仍不开放。
- 控制权按会话隔离，全 Host 同时只有一个桌面模式持有者。五分钟超时、本轮结束、真正的轮次取消、会话归档/删除和插件卸载时释放；新开 PiP 也恢复后台优先。DSH Code Mode 的一次 `run_code` 正常结束不会被误当成整轮取消。
- 单窗口录制与输入模式分离；关闭 PiP 只关闭预览，`controlMode:"background"` 单独交还桌面操作权限。模式切换和释放都不会为了“恢复焦点”额外激活应用。

新增函数/工具/Host 接口测试覆盖并发声明、跨会话拒绝、窗口冲突、过期请求、轮次取消、时限、返回后台及纯桌面调用。最终 **22 个文件、530 项测试通过**，TypeScript、插件构建和客户端模块契约检查通过。实际 `/cua-pip/health` 已报告 `2026-09-19-desktop-fallback-v5`、`desktopFallback.enabled=true`、`scope=session-and-window`、`ttlMs=300000`；LaunchServices 授权预检仍为 true，当前活动录制流为 0。

本轮未触发浏览器端到端，也未为了验证策略而实际前置/点击 Clock。测试与运行时核验验证的是桌面降级接口和策略，不代表完整 Clock 操作 case 已验收。

## v6：录制健康门禁与实际图像观测

用户截图显示 PiP 长时间为 “The recorded window has closed”，但 Agent 仍继续应用任务；合法的 `pid + element_token` 又被后台策略以缺少 window ID 拒绝。截图中向 Grok Bot 发消息的内容仅作为故障证据，本轮没有执行该业务任务。

只读复核时，原会话 watcher 为 `frames:0` 且错误持续，正式驱动仍列出准确的 Grok Bot 窗口 `pid=35074, window_id=37901`。修订前另起独立 helper 的短时对照采集获得 231 帧、1024×748、平均约 34.1ms；500 次前台采样中无目标前置。这只能证明当时窗口可被新流采集，不能证明原来的 watcher 健康，也不证明应用任务成功。

### 修复

- 修复失败 source 按不变窗口键缓存的问题：即便发现同一 PID/window ID，也先释放失败流再重建。Host 对可恢复中断/临时缺窗最多退避重试两次（500ms、1500ms）；普通 Cua 调用不会重置预算。关闭、用户/系统停止共享、权限拒绝均不会被自动重启。
- 原生窗口元数据改由与采集相同授权路径的 `SCShareableContent` / `SCWindow` 提供，不再把 `CGWindowList` 字典转换失败当作窗口关闭。按本机 SDK `SCError.h` 区分连接中断与用户/系统停止；未知失败保守停止。
- 增加 `recording` readiness 状态、恢复代次和错误码。正在打开、无首帧、恢复中、过期、暂停或停止的 PiP 不允许后台应用输入；发现和读取窗口状态仍开放。执行 guard 与实际派发都检查，避免并行工具越过检查。
- 新增 `computer_pip(action="observe")`，最多等待 10 秒，通过共享 attachment service 保存不可变的实际原生 PiP 图像，再作为图片上下文交给 Agent。保存失败、观测被其他策略替换/拒绝或代次变化均不放行输入。每次已派发输入结束后使旧观测失效，下一次输入必须重新 observe。
- 区分“图片已排队”和“图片已进入模型请求”：共享 runtime 的 `deferContext` 在 Code Mode 中要等外层脚本结束才交付，因此不能在 observe 返回时立即解锁。`llm/stream` 按会话、消息 ID、图片附件 ID 核验完整模型请求后才放行；同脚本 observe 后直接输入、跨会话图片、辅助摘要请求和取消请求均不能越过门禁。
- 每条原生流有独立 `frameId`，图像内容有独立 SHA256；样本序号递增不代表画面内容变化。`captureHealth.sampleAt` 是实际原生采样回调时间，`checkedAt` 只是心跳到达时间；重复保活心跳不能冒充动作后的采样通知。Agent 仍须结合新 AX 状态确认应用语义。
- 缓存接受的 canonical `get_window_state` 绑定，按会话/provider/PID 隔离，将 `pid + token` 或新快照/index 解析给 Host 策略与跟随逻辑；不改写驱动参数，不推测 token 格式或 PID。过期、跨域和冲突绑定被拒绝；真实有效性仍由驱动检查。保留 AX 路径优先和已有显式桌面降级，不全局放开像素操作。
- UI 根据状态显示恢复、停止、不可用或需要权限；同窗口重建、终止状态均丢弃旧图。空白/暂停流立即显示中断，不继续显示无提示的旧画面。

### 验证及权限阻塞

25 个测试文件、**585 项函数/接口测试通过**；TypeScript、Swift 原生契约、完整构建与客户端模块契约检查通过。新增覆盖包括真实 `WindowCaptureSource` + watcher 的同窗口失败重建、恢复期间关闭、停止/拒绝不重启、原生采样时间、动作串行与重新观测、实际附件及模型请求交付门禁、AX token 隔离及纯 UI 状态函数。

实际 DSH `/cua-pip/health` 已报告 `2026-09-19-observed-window-monitor-v6`，带有 `monitor.readyGate:true`、`monitor.observe:"native-image"`、`monitor.modelRequestGate:true`、两次恢复预算及 `canonical-session-provider-v2`。

本次原生代码修改需要重新构建并 ad-hoc 签名，之后经 LaunchServices 启动的独立 helper 预检返回 **`screenRecording:false`**。未重置正式 Cua/Codex 权限，也未自动弹出新授权请求。

2026-09-19 **21:56（北京时间）** 的实际 Host/SSE 30 秒拒绝路径检查确认：

- 0 帧，状态由 starting 转为 paused，`errorCode=permission_denied`、`retryCount=0`，没有循环恢复。
- Host 截止和实际关闭均为 `1789826182280`，收到终止事件，关闭后 0 活动流。
- 1649 次前台采样中目标出现次数为 0，无激活变化；未点击、输入、启动、缩放或前置目标应用。
- `verify-session.mjs` 正确以 exit=1 报告未通过录制验收。负路径可验证，并不代表新 helper 已产出真实画面。

证据见 [v6 汇总](./cua-pip-monitor-evidence-2026-09-19.json) 和本机 `.tmp/grok-monitor-v6-denied/session-report.json`。用户需在系统设置“隐私与安全性 → 屏幕与系统音频录制”重新授权 **DSH Window Capture**，再复查独立 probe 并验证真实帧/observe 操作闭环。**v6 的授权后原生图像及应用完整操作尚未通过实测验收**；未运行浏览器端到端验证。

## v7：窗口绑定的视觉操作

用户提供的 Computer Use 提示词作为接口设计参考，不作为本轮执行指令或额外操作授权。此次落地统一目标、同源观察和有界动作批次，没有将通用原始像素分支直接放开，也没有把应用迁移到虚拟机。

新增 `computer_window`：

- `bind` 显式打开 PiP 并返回会话拥有的窗口句柄；`observe` 返回同一窗口的 AX 与原生 PiP 图片，配对 `observationId`、帧 ID、尺寸与各自时间。真实 AX token 保留在 Host，图片消息同时携带有界 AX 信息，避免 Code Mode 不打印返回值时丢掉 AX 上下文。
- 视觉坐标只属于这张原生图片。Host 校验完整画面比例、窗口几何及 AX/图片时间差，命中唯一且声明对应动作的 AX 元素后，以准确 PID/window ID/token 发出后台语义动作；不进入 Cua 的原始像素点击分支。不假定 AX 与图像原子同步。
- `act` 支持 1–6 步确定性操作，每一步仍通过 `ctx.tools.execute`，保留当前 Agent 的 provider 可见性、审批、guard、取消及结果策略。Host 临时权限按子调用 ID、不可伪造的父 token、会话、工具名和参数绑定；只允许受控批次通过本插件自身的逐动作观测门禁，不能绕过其他策略。
- 同窗口批次互斥，动作前和审批后重查录制、代次、快照、几何和 30 秒观测期限。写值/文本可在中间，点击/按键只能最后执行；不允许根据中间新页面继续猜动作。失败、未知效果或未预期后端立即停下，保留步骤证据及其原始目标，不声称回滚。
- 批次后自动观察，新的实际图片进入下一次模型请求后才能再输入。空 AX / 缺失快照且驱动报告不可用时，仍可交付只读 PiP 图片与具体拒绝原因，不把“录制正常”冒充“输入可用”。
- 输出兼容实机驱动的 `route/delivery` 与旧 `path`，前台或未知后端不能被当作已验证后台成功。支持原生 `set_value`、可编辑元素的 `type_text`、已开放键盘路线的 `press_key`，不添加剪贴板、脚本或自动前置回退。

### 原生输入实测

2026-09-19 **23:16（北京时间）**，使用本轮临时编译的 AppKit 测试窗口，只操作该自有窗口，未操作现有应用：

1. 单窗口原生流给出 960×544 图片，从该图片坐标 `(260,264)` 解析到“Fixture Increment”按钮的真实 AX 绑定。
2. 仅发出一次点击。实机驱动返回 `route=accessibility`、`delivery.mode=background`、`effect=unverifiable`，没有将该回包本身当作成功。
3. 测试窗口收到一次 increment 事件，AX 复读为 `Count: 1`；原生新帧的内容改变，人工图像检查确认首帧 `Count: 0`、后帧 `Count: 1`。两张图左上角均可见系统共享标记。
4. 20 秒内 1000 次前台采样中目标出现次数为 0，无激活通知；检查结束后测试进程和采集 helper 均退出。

这验证的是实际原生采样、坐标映射和 AX 输入，不是完整生产 Agent 对话，也不把模拟 Host 接口测试当作实机审批流程。原生测试脚本只接受自身创建的 PID/window ID，失败后不重试输入、不转向其他应用。

### 实际 Host 取流

本轮独立录屏预检为 **true**，v6 当时的权限阻塞已经解除。原生录制 helper 本轮未变更/重新签名，没有再次请求或重置授权。实际 Host 已热加载 `2026-09-19-bound-window-control-v7`。

2026-09-19 **23:17（北京时间）**，原 Grok Bot 会话的 30 秒只读取流获得 **841 帧，1024×748，平均接收间隔 35.493ms**，无错误、无重试；截止与实际关闭均为 `1789831058605`，收到终止事件，活动流归零。1650 次前台采样及激活通知未观察到 Grok Bot 前置。

同一应用当时不在当前 Space。只读 Cua 状态返回 `exact_window.status=ax_unresolved`，AX、window_pointer、pid_keyboard 均以 `off_space_or_ax_unresolved` 拒绝。因此没有尝试点击、发消息、移动或前置它；取流成功不能替代输入能力验证。

### 验证范围

**29 个文件、642 项函数/接口测试通过**；类型检查、Swift 原生契约、完整插件构建及客户端模块契约检查通过。新测试覆盖坐标空间、唯一命中、能力拒绝、模型图片交付、慢审批、快照替换、原生几何变化、跨会话保护、部分完成记录及其他 Host guard 的拒绝。未做浏览器渲染/DOM 测试。

现阶段只开放 `visualClick=ax-hit-test-only`。**无 AX 的纯画布点击与拖拽仍不支持，不承诺任意应用全程后台。** 证据汇总见 [v7 汇总](./cua-pip-bound-window-evidence-2026-09-19.json)；首末测试图位于 `.tmp/window-actions-v7/`，Host 原始报告位于 `.tmp/grok-bound-window-v7/`。
