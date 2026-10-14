# @just-genius/dsh-cua-pip

Agent 主动调用的 Computer Use 画中画。Agent 按任务需要打开一个应用预览，之后继续用 Cua 操作对应应用；普通 Computer Use 调用不会自行弹出画中画。

预览由 `shell.overlay` 管理，但显示范围限定在当前主会话内容区。默认位于会话左下角，避开侧栏、顶栏和底部输入框。切换会话只切换显示，后台录制和 Agent 操作继续；切回可恢复该会话的画面和位置。不会新开系统悬浮窗口。

当前采集路径为 **ScreenCaptureKit 持续单窗口流**，不是整屏录制后裁剪，也不再循环调用 Cua `zoom`。精确绑定 PID/window ID，macOS 管理系统录制指示器；插件不伪造图标。

## 可选 PiP 与独立 Cua 调用（v9）

普通 Cua / Computer Use 调用（包括 Code Mode 子调用）直接交给原 provider，不要求先调用 `computer_window.bind` 或 `computer_pip.open/observe/control`。PiP 未打开、等待首帧、图片未交付、录制失败、停止共享或窗口 provider 不可用，都不拦截直接 Cua 调用。宿主其他审批、guard 和 provider 自身的权限检查仍照常执行。

直接调用的参数和 `session` 原样保留，PiP 不替它执行 `start_session`，不要求后台模式、AX token 或额外桌面范围声明。即使可选的 `computer_window.bind` 返回 `window_provider_unavailable`，仍可直接使用已配置的 Cua 工具。预览只记录输入活动并使旧观测失效；并行直接调用不会被 PiP 串行化。

只有显式 `computer_window` 的内部调用使用 Host 按 DSH 会话/provider 分配的驱动会话，以及受宿主管线检查的幂等 `start_session` 预检。该窗口批次仍校验真实目标、录制状态、图片交付、AX 绑定与后台能力；PiP 自身的原生窗口 resize 也保留观测门禁。这些约束不扩散到直接 Cua 调用。

`computer_pip.control` 保留 PiP 工作流的模式和生命周期管理，不再是直接操作桌面的前置条件。`computer_pip`、`computer_window` 是 Host 工具，不加 MCP 前缀。`/cua-pip/health` 的运行版本为 `2026-09-29-optional-pip-v9`，通过 `directCua: "passthrough"`、`driverSessions.appliesTo` 和 `monitor.appliesTo` 标明适用范围。

## 窗口绑定操作（v7）

需要受监控的窗口批次时，可选用 `computer_window`。普通任务直接使用 Cua 即可。`computer_pip` 继续负责原有预览、尺寸、关闭和显式桌面降级。

```json
{"action":"bind","pid":1234,"windowId":5678}
{"action":"observe","targetId":"<bind 返回的 targetId>"}
```

`bind` 也接受 `app`。有多个窗口时先用 Cua `list_windows` 根据标题选出准确 PID/window ID，不猜第一个窗口。绑定与会话、打开代次、准确窗口关联；关闭/重开/目标变化后旧句柄失效。跨轮次保留句柄，但旧观测不能继续授权输入。

`observe` 将同一目标的原生 PiP 图片与 canonical AX 状态放入同一图片上下文，返回 `observationId`、实际图片宽高、帧 ID、AX 采样时间、两者时间差及分项能力。AX 单独读取时禁止驱动截屏，不覆盖 PiP 的像素源。两种采样不是原子 OS 快照；视觉定位要求时间差不超过 2 秒。Host 最多缓存 2000 个 AX 元素，模型文本最多显示 150 个、约 32KB，真实 token 留在 Host，不让模型手工拼接。

结束当前工具批次，让图片进入下一次模型请求，再发动作：

```json
{
  "action":"act",
  "targetId":"<本会话句柄>",
  "observationId":"<已交付图片对应的观测>",
  "steps":[{"kind":"click","x":260,"y":264}]
}
```

- `x/y` 是返回图片的原始像素坐标，不是浮窗 CSS 像素、Cua 截图或桌面坐标。Host 根据该帧的窗口几何映射到屏幕逻辑坐标，仅接受唯一、启用且声明了对应 AX 动作的元素，再用真实 token 走后台 AX。重叠命中、无 AX 的画布、过期几何或时间差过大均拒绝；不转入原始像素点击。
- 同样可传 `elementIndex`，由 `observationId` 绑定到真实快照；不能同时传坐标。支持 `click`、`set_value`、`type_text`、`press_key`。`set_value` 仅用于原生文本框/滑块/步进器，不走浏览器脚本或弹出菜单回退；`type_text` 必须指向已观测的可编辑控件；键盘能力不明/被拒绝时不发 `press_key`。
- 每批 1–6 个确定性步骤。只有写值/输入文本可以在中间，点击或按键必须放最后；需要看新页面、弹窗或决定下一步时不能合批。整个计划先校验，中途失败、效果不确定、输出后端异常、窗口移动、录制恢复、AX 快照替换或观测超过 30 秒，均停止后续步骤，保留已尝试步骤的结果，不重放、不声称回滚。
- 每个子调用仍经当前 Agent 可见的 Cua provider 和 `ctx.tools.execute`，保留宿主审批、guard、取消和结果策略。Host 为准确子调用发放不可由模型伪造的临时权限，只豁免本插件批次内部的逐动作观测门禁，其他 guard 不能被绕过。审批结束后还会复查录制、几何和观测有效性。
- `act` 自动读取操作后的 AX 和 PiP 图片；结果图片必须进入下一次模型请求，才能开始新批次。返回 `batch.results` 是驱动证据，不等于用户业务任务完成。`unverifiable` 的点击必须结合新 AX 与图片判断，不自动重试。
- `status` 返回能力及不可用原因。录制正常但 AX 不可用时仍交付图片，标记 `observed_read_only`；不能把它当成可以输入。当前 `visualClick="ax-hit-test-only"`，`rawPointer` 与 `drag` 明确不可用。已有桌面降级保持独立，窗口绑定工具不会自行激活目标。

这不是“把应用放进 PiP 进程”，也不是所有 macOS 应用都能全程后台。首版实现并验证的是**按 PiP 画面定位、以 AX 交付的后台操作**；纯画布像素输入仍需要另外审查的输入后端。

## Agent 工具

插件通过共享 runtime 注册 `computer_pip` 并提供使用指引。会话 ID 从调用 Agent 取得，无需由模型填写。

```json
{"action":"open","app":"Cursor"}
{"action":"open","app":"ima"}
{"action":"open","pid":1234,"windowId":5678}
{"action":"observe"}
{"action":"resize","width":1024,"height":768}
{"action":"resize","resizeTarget":"preview","width":360,"height":240}
{"action":"status"}
{"action":"control","controlMode":"desktop","pid":1234,"windowId":5678,"reason":"目标应用的后台输入被拒绝，必须前台执行"}
{"action":"control","controlMode":"desktop","controlScope":"desktop","reason":"目标是菜单栏，没有普通应用窗口"}
{"action":"control","controlMode":"background"}
{"action":"schedule_close","closeAfterSeconds":30}
{"action":"close"}
```

- `open`：按应用名称、bundle ID 或路径查找进程；已经运行时只查窗口，不再发送启动/重开事件。尚未运行才请求后台启动，等待该应用自己的可用窗口。也可监视现有 `pid` / `windowId`，只给 `pid` 时选其主窗口。没有应用白名单。
- 打开之后，Cua 的普通调用与 `run_code` 嵌套调用均可更新目标。应用启动结果中的 PID 会与调用关联；不猜测当前前台窗口，不捕获系统授权浮层。
- `observe`：可选地读取原生预览；直接 Cua 操作不依赖此调用。最多等待 10 秒，取得与 PiP 相同的原生图像，保存为不可变图片附件交给 Agent，同时返回 `frameId`、`imageHash`、`capturedAt` 和录制 `generation`。`computer_window` 批次要求图片交付；图片不是 Cua 点击坐标系。每次已派发输入都会使上次观测失效，即使输入返回失败。
- `observationDelivery:"queued"` 表示图片已保存但仍等下一次模型请求。若后续要执行 `computer_window.act`，须先结束当前工具批次并交付图片；直接 Cua 调用不受此门禁影响。Host 在 `llm/stream` 中核对本会话的完整请求是否包含准确的消息 ID 和图片附件 ID，才切为 `delivered`；摘要/标题等辅助请求、跨会话、取消或已被移除的图片不放行。图片已进入当前请求时无需只为交付状态重复 observe。
- PiP 打开但未出首帧、恢复中、过期、空白、暂停或停止时，Host 拒绝依赖该观测的 `computer_window` 批次；直接 Cua 输入和观测仍可执行。操作后的观测必须有晚于动作结束的原生图像或 idle 采样通知，重复 helper 心跳不能替代。Agent 必须结合新 AX 状态判断实际效果，帧序号和图像哈希不代表任务成功。
- `resize`：默认调整当前 PiP 绑定的**真实应用窗口**，必须同时传 `width` / `height`。尺寸单位为系统逻辑单位（macOS 上为点），不是截图像素。先读取并保留窗口位置，再调用 `set_window_frame`，最后复读同一个 PID/窗口的实际尺寸；不请求前置窗口。应用可能约束最小/最大尺寸，以返回的 `windowBounds` 为准。
- `resizeTarget: "preview"`：只调整会话里的 **PiP 卡片尺寸**，单位为 CSS 像素。保持完整画面，空间不足时等比缩小到会话区域内；不操作真实应用窗口。该偏好按会话保留。
- 原生窗口宽高须为 1–16384 的整数；预览卡片宽高须为 64–16384 的整数。调整前须已打开 PiP，resize 不接受 `app` / `pid` / `windowId`，选择应用须先 `open`。调整不会重置关闭期限；关闭或切换目标后，旧 resize 的结果不能恢复原预览。同一会话、或多个会话调整同一个原生窗口时，resize 按请求顺序执行。
- `status`：返回实际运行版本、是否打开、Computer Use 活动、目标、最新帧时间、抓帧数、错误、关闭截止时间，以及最近观察到的原生 `windowBounds`、请求的 `previewSize` 和 `control`。`recording` 返回录制状态、代次、重试次数；`observation` 记录当前图像，`needsObservation` 表示是否需要重新取图，`observationDelivery` 区分缺图、排队及已进入模型请求。`control` 包含当前操作模式、降级目标、原因和失效时间；与 PiP 的录制目标分开。两种尺寸的单位不同；`running` 表示 Computer Use 活动，不代表应用内秒表在递增。
- `control`：为 PiP 管理的动作保留后台/桌面模式声明。窗口范围传准确的 `pid`、`windowId` 和 `reason`；系统桌面范围传 `controlScope:"desktop"` 和理由。此声明不激活、不点击、不采集，也不替代宿主或 provider 的授权。直接 Cua 操作不需要此声明。
- 桌面模式在轮次结束、取消、会话归档/删除、卸载或 5 分钟后释放；PiP 工作流最多一个会话持有该声明。`open` 重置模式，`close` 和定时关闭只关闭预览。直接 Cua 调用不受此模式的持有者或过期状态限制。
- `schedule_close`：由 Host 计时，不依赖 Agent 保持当前轮次，也不依赖前端继续拉取。`open` 同样接受 `closeAfterSeconds`。取值大于 0 且不超过 86400 秒。
- `close` / 用户关闭按钮：停止该预览；后续 Cua 调用不会重新打开，只有明确的 `open` 会再次打开。

## 时钟 30 秒示例

1. Agent 调用 `computer_pip({"action":"open","app":"com.apple.clock"})`。
2. Agent 调用 `observe` 并读取新 AX 状态；仅在本次任务要求启动计时时，用真实 `element_token` 或 `snapshot_id + element_index` 操作。如果已运行，保留原状态；操作后再次 `observe`，两次间隔取样确认读数递增。
3. 启动后调用 `computer_pip({"action":"schedule_close","closeAfterSeconds":30})`。
4. 即使切换会话或 Agent 结束本轮，Host 仍持续抓帧，到期关闭画中画。

**关闭的是画中画。** 停止应用内计时或退出应用属于另外的 Computer Use 操作；本插件不会用“关闭预览”冒充已经完成这些操作。

此流程是验收标准，**用户提供的 Clock 实测记录尚未通过验收**。后台读数不变、AX 与截图不一致时，结果为未知；不能据此断言 App Nap、计时已停或始终运行。相同操作两次未得到明确效果就停止试点；需要前台才能继续时，可在任务授权范围内直接使用 Cua，不再无限重试后台点击。用户当前任务要求仅后台时，不使用需要窗口前置的菜单。不为重新演示而停止、复位、切标签或缩放窗口，也不重复执行结果不明确的破坏性操作。

插件会从 Cua `get_window_state` / `list_windows` 的 canonical `structuredContent` 提取真实动作绑定和窗口几何，作为独立上下文交给 Agent，保留原 MCP 图片/文本渲染。输出最多 12KB、30 个元素或 20 个窗口，不复制整棵 AX 树；绑定缺失时不生成替代 token。原生 Driver 补丁也在文本中返回快照绑定，见下文。

对于驱动支持的 `pid + element_token` 调用，Host 按会话/provider/PID 缓存真实 `get_window_state` 绑定，将缺少的窗口 ID 解析给 PiP 自身的策略检查和活动记录使用；不改写实际驱动参数、不解析或伪造 token。缓存最多 16 个窗口、每窗口 2000 个元素、60 秒有效，新快照替换旧绑定。PiP 不解析跨会话/provider、过期和冲突绑定；直接调用的最终有效性由 Cua 检查。指引优先语义 AX 路径，不因缺少冗余 window ID 就诱导 Agent 改用像素点击。

## UI 与生命周期

- 默认按原始宽高比显示，长边最高 400px；Agent 指定 `previewSize` 后使用指定卡片宽高。画面始终完整显示，小视口自动缩小，卡片比例与应用不同时可能留边。
- 整卡可拖动，释放后吸附会话内容区最近的左/右边缘；侧栏伸缩、输入框高度或窗口尺寸变化时保持吸附，不进入导航栏或右侧面板。侧栏全屏覆盖主会话时暂时隐藏预览，后台监控继续。
- 仅 hover / 键盘 focus 时显示一个关闭 icon，按钮背景高斯模糊；无标题栏或底部状态栏。点击画面聚焦准确窗口，拖拽不会触发聚焦。
- `turn/end` 不关闭预览，但会释放本轮临时桌面操作权限。会话切换不释放 watcher；归档、删除、显式关闭、定时到期或插件卸载才释放录制。
- Host 按会话保存目标、最新帧和期限；客户端按会话保留位置。前端刷新可从仍运行的 Host 取回预览，位置在客户端刷新后重置；Host 重启后需要 Agent 重新打开。
- 原生 SCStream 以 30fps 为目标，只输出选中窗口的 JPEG 帧，最长边 1024px，不录制音频、麦克风或系统光标。Host 对正在显示的会话最多消费 30fps，后台会话约 1fps 消费最新样本；原生录制在会话切走时仍保持。SSE 只是传输层，不是视频编码协议。
- 同一窗口/分辨率在多个会话间共享一条原生流，分别维护读取游标。关闭最后一个引用、归档会话、切换目标或卸载插件时停止相应流。Host 退出后本地连接 EOF 会结束 helper，超时则强制结束，避免遗留录制。
- 客户端断线会重连，不支持推送才退回串行轮询。原生端和传输端只保留最新待发帧，不累计过时画面。
- `capturedAt` / `updatedAt` 来自原生新样本，重复读取缓存不会增加帧数或更新时间。原生 idle 心跳与新帧分开；`captureHealth.sampleAt` 是原生采样回调时间，`checkedAt` 只是 Host 收到心跳的时间。系统仍可能重复提交内容相同的新样本，帧数递增不能证明秒表数字递增。
- 临时缺窗、流连接中断及超时由 Host 最多恢复两次（500ms、1500ms 退避），即便重查发现同一个 window ID 也会释放失败 source 后重建。重试预算不因普通工具调用重置。用户/系统停止共享、权限拒绝和无法确定可恢复的原生错误不自动重启；耗尽预算后停止录制，并使依赖录制的窗口批次不可用；不阻止直接 Cua 输入。显式重开才重置预算，Agent 不得循环重开来绕过错误。
- 故障时显示“正在恢复窗口录制 / 窗口录制已停止 / 窗口录制不可用”，不把元数据暂缺断言为窗口已关闭。录制代次变更、停止或失败时丢弃旧图；空白/暂停流立即提示中断。无法恢复时报告预览故障，直接 Cua 仍可继续；直接调用成功不会将失败的 PiP 伪报为恢复。
- 切换目标立即清除旧帧；关闭、重开、切换会话后的过期请求不能把旧结果写回新状态。

## 依赖与边界

应用操作继续由 `dsh-computer-tools` 配置的 Cua provider 提供。应用发现/启动和显式窗口操作使用本机 `CuaDriver.app` CLI；PiP 像素只来自随插件构建的 `DSH Window Capture.app`，不修改或重新签名正式驱动。

插件仅对自身发起、由宿主 parent token 关联的嵌套 Cua 调用执行后台策略和受管会话预检。直接 MCP/native provider 调用及 DSH Code Mode 子调用保持独立，PiP 不追加输入限制。录制、观察与窗口批次失败均不改变 provider 自身的可用性。

**单窗口录制不等于任意应用都支持后台输入或持续重绘。** Cua 动作须遵守用户的任务范围、实际 provider 能力和坐标约定。PiP 仍使用单窗口 SCStream，不因直接桌面操作切换成整屏视频。窗口最小化、受保护画面和锁屏时不能保证产生新画面。

### 原生采集与权限

要求 macOS 14+ 和 Xcode Command Line Tools（构建时）。唯一像素源是 `SCContentFilter(desktopIndependentWindow:)` 与持久 `SCStream`；不创建 display filter，不调用激活、AXRaise、整屏截取或 shell screenshot。通过同一授权路径的 `SCShareableContent` / `SCWindow` 定期验证窗口归属和同步尺寸，不再依赖 `CGWindowList` 字典转换判断窗口是否关闭。

helper 为独立 ad-hoc 签名包，经 LaunchServices `open -n -g` 后台启动，授权归属固定为 **DSH Window Capture**。不直接 spawn helper，避免误用 Codex/终端/DSH 宿主的授权。Host 与 helper 通过随机 0700 目录内的 0600 Unix socket 通信，随机 token 验证握手，不暴露 TCP 端口。关闭/崩溃时断开连接以终止 helper。

后台采集只预检授权，不反复弹权限窗口；遇到 `permission_denied` 时，可显式运行下述授权命令并在系统设置中完成授权，再重新打开预览。**直接运行二进制 `--probe` 的结果不能代表 DSH 的权限**，必须使用下面同样经 LaunchServices 启动的脚本。构建脚本按内容指纹复用未变更的原生产物，避免普通 JS 构建改变签名；修改原生代码重新签名后可能需要再次授权。开发脚本要求 Node.js 24+。

```bash
pnpm --filter @just-genius/dsh-cua-pip capture:probe
# 仅在明确需要申请权限时执行；不重置正式 Cua Driver 的权限。
pnpm --filter @just-genius/dsh-cua-pip capture:permissions
```

之前的 [Cua Driver 单窗口 MP4 补丁](../../patches/cua-driver-0.28.1/README.md) 保留为独立产物，不是这条 PiP 实时流的依赖，也不需要安装 `CuaDriverLocal.app`。

## 开发与验证

```bash
pnpm --filter @just-genius/dsh-cua-pip test
pnpm --filter @just-genius/dsh-cua-pip typecheck
pnpm --filter @just-genius/dsh-cua-pip test:native
pnpm --filter @just-genius/dsh-cua-pip build
node scripts/check-client-modules.mjs dsh-cua-pip
# 使用实际 DSH Host 地址；不要把代理端口当作 Host。
node plugins/dsh-cua-pip/scripts/verify-live.mjs http://127.0.0.1:<DSH-host-port>
```

测试只覆盖纯函数和接口，不渲染组件或断言 DOM。30 秒用 fake timers 验证。可用 `node plugins/dsh-cua-pip/scripts/verify-native.mjs <pid> <window-id> <evidence-directory>` 对已有窗口做 8 秒只读流采集，同时记录 10 秒的前台应用通知/50Hz 采样，不启动、点击、复位或前置应用。

2026-09-19 的直接 helper 只读 Clock 检查收到 228 个原生样本，1024×768，平均间隔约 33.8ms；500 次前台采样及激活通知均未观察到 Clock 前置。采集图像左上角可见系统共享标记。此轮所有图像内容相同，不能证明秒表在后台递增。

**后续实际 DSH Host 验证揭示权限归属差异：没有收到帧，报录屏授权不足。** Host 30 秒按期关闭（误差 1ms），1650 次前台采样中没有 Clock 前置。为此最终 v4 改用 LaunchServices 独立身份，预检明确显示 `screenRecording:false`，已发起该身份的系统授权请求。授权前 DSH 内真实流与后台动作完整 case 均不能宣告成功；此前直接 helper 的成功不能替代生产链路验收。未做浏览器端到端。

用户授权后的复验：独立身份 `screenRecording:true`；v4 实际 DSH Host/SSE 在 30 秒内收到 848 帧、1024×768，约 28.4fps，无错误；定时关闭延迟 1ms，关闭后 0 活动流且 helper 退出。1650 次前台采样和激活通知均未观察到 Clock 前置。首末帧可见窗口共享标记，但秒表数字同为 `00:42.13`。两次只读动作状态均为 `ax_unresolved`，三条后台输入路径被驱动拒绝。因此采集/传输/关闭已验证，**完整后台动作与秒表递增仍未通过**，没有使用 foreground 回退。[证据汇总](../../docs/cua-pip-native-window-evidence-2026-09-19.json)。

v5 根据用户后续授权改为 `background-first-desktop-fallback-v1`，新增显式桌面模式及会话/目标/时限约束。函数和 Host 接口测试验证降级、释放、取消、并发及坐标隔离，不据此声称已完成某个应用的真实前台操作。原生 helper 未改动，不为这项策略修改重新签名或请求录屏权限。

v6 标识为 `2026-09-19-observed-window-monitor-v6`，增加原生流 readiness 门禁、最多两次自动恢复、实际 PiP 图像观测和按会话/provider 的 AX token 解析。health 必须同时报告 `monitor.readyGate:true`、`monitor.observe:"native-image"`、`monitor.modelRequestGate:true`、`recovery.maxRetries:2` 和 `actionBindings:"canonical-session-provider-v2"`。本次修改原生元数据读取及错误分类，重新构建 helper 后须复查其独立录屏授权，不重置正式 Cua/Codex 权限。

v7 标识为 `2026-09-19-bound-window-control-v7`，health 增加 `windowControl`，标明 `computer_window`、视觉转 AX、6 步上限和不支持原始指针。本次未改原生录制 helper，不重新签名；独立录屏权限复查为 true。真实 Host 的 Grok Bot 30 秒只读取流收到 841 帧、1024×748，无错误，1650 次焦点采样无目标前置。该应用处于其他 Space，驱动仍拒绝 AX/指针/键盘路线，所以没有操作它。

另用本轮创建的临时 AppKit 窗口完成一次真实“图片坐标 → AX”点击：计数从 0 变成 1，AX 复读和新原生图像均确认，1000 次焦点采样无测试窗口前置。测试窗口与 helper 均已关闭，没有修改现有应用内容。这验证输入适配和原生图像，不冒充完整模型/生产审批闭环；后者另由 Host 接口测试覆盖。

开发仓库可运行这项原生测试（会创建并仅操作临时测试窗口，不操作现有应用）：

```bash
node --experimental-transform-types plugins/dsh-cua-pip/scripts/verify-window-actions.mjs .tmp/window-actions-v7
```

要求 Node.js 24、Xcode Command Line Tools、Cua Driver，以及 helper 的录屏权限。代码模式的模型图像交付门禁、跨会话保护及审批拒绝使用函数/接口测试，不通过浏览器渲染测试。

### v6 验收

1. 先运行 `capture:probe`，确认 LaunchServices 身份的 `screenRecording:true`。若为 false，在系统设置的“隐私与安全性 → 屏幕与系统音频录制”重新授权 **DSH Window Capture**，然后再 probe。只授权 helper，不重置正式 Cua 或 Codex。
2. 新开 PiP 后调用 `observe`：应得到实际图片、`recording.ready:true`、非空 `observation`。`computer_window.act` 仍须等待图片进入模型请求；直接 Cua 输入不因 `pip_observation_pending` 被拦截。比对应用语义验证效果；连续帧或不同哈希不能单独算作任务成功。
3. 将目标窗口放在其他应用后方，确认 PiP 显示目标而非前台桌面。已有窗口可用 `verify-session.mjs` 做 30 秒只读 Host/SSE 验收，输出帧身份、哈希、恢复状态和焦点采样；不运行截图里的业务任务。
4. 用户停止系统共享后，应显示“录制已停止”、`recording.ready:false`，窗口批次不可用，不能自动重启；直接 Cua 输入仍能派发。权限拒绝显示独立权限提示。临时连接故障最多重建两次，恢复后旧观测失效。函数与接口测试覆盖这些故障注入，无需终止用户应用。
5. 无窗口 provider、多个 provider、未暴露 `start_session` 或绑定失败时，直接 Cua 仍按原参数调用；包括 Code Mode 子调用。宿主其他 guard 的拒绝仍然生效。

**构建成功不能证明运行中的 Host 已更新**，必须检查 `/cua-pip/health` 的版本、helper 路径与能力，再执行 case。

Host bundle 使用 `clean:false`，避免已安装 DSH HMR 的 `change` watcher 漏掉删除后重建文件。若健康检查仍显示旧版，可在构建完成后 `touch plugins/dsh-cua-pip/lib/index.js` 触发该插件重载。重载会释放 PiP 的 watcher 和关闭定时器，已有预览需重新显式打开；不会结束 Cua MCP 会话或操作目标应用。

[本次审查与修订](../../docs/cua-pip-review-2026-09-19.md) · [早期可行性调研](../../docs/cua-session-pip-feasibility-2026-09-17.md)
