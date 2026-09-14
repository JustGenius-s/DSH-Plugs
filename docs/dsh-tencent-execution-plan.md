# dsh-tencent 稳定性与延迟优化执行文档

日期：2026-09-09  
目标仓库：`/Users/jiahaoqian/proj/dsh-tencent`  
交付状态：用户随后授权直接实施，源码和本地构建已更新。当前测试数量、验证日期与证据以同目录 `dsh-tencent-implementation-report.md` 为准；72/94 项是早期阶段结果，当前完整套件为连续两次 110/110。2026-09-10 读取用户真实对话日志后，已实现迟到工具续接、去重和有界缓冲，修复该类通知关闭 Run 的路径；03:46:18 在确认空闲后重启 DSH，完成新构建路径、进程归属、端口和日志开关核对。修复后的真实对话效果尚待验证，不能用旧样本证明新修复已在线上成功；实测和限制见 `cursor-proxy-live-validation-2026-09-10.md`。未进行同条件性能 A/B，不能据此宣称相对旧版提速。下文保留原执行规范及实施前调查基线。

2026-09-10 增量边界：当前重试策略已进一步收紧为“收到任意上游响应体字节后不自动重放”，包括 heartbeat 和半帧；尚未收到字节也不能证明上游未执行。字节、解析成功的完整帧和业务进度分别记录。失败/替换请求的未完成 checkpoint 会失效，旧请求不能清理替代它的新会话。下文旧重试表须结合此增量和实施报告阅读。

后续工具派发阶段：已补齐收集、本地 HTTP 交付、每轮结果回写后首进度/首正文的计时及边界回归；300ms 仍保留。已查的本机 Cursor `toolCallCompleted` / `stepCompleted` 不提供可靠的执行前全批次结束契约，因此只记录候选信号，不据此启用提前派发。该阶段 94 项回归及证据保留为历史记录，不能把诊断完备当作已提速。

当前迟到续接增量：已交付批次不可变，paused 状态按 call ID/非空 exec ID 去重；新工具放入独立有界队列，在完整旧结果完成本地回写后继续同一 Run。复用队列已等待的静默时间，不改变 300ms 常数；暂停正文/thinking 交给下一次 HTTP 响应。最多 64 个工具、512 个输出片段，共用 1MiB 载荷预算；取消、替换、TTL、溢出均清理。新 D05/D11-D19 回归覆盖真实 JSON/SSE 和 HTTP/2 背压；当前门禁和运行证据见实施报告。真正缺失、重复、过期的结果仍返回冲突；已关闭 Run 不能自动重放恢复。

## 0. 给 GPT Luna 执行者的指令

你收到的是实施任务，不是邀请重新设计。先阅读本节，再按第 11 节任务卡逐项执行；第 2～9 节提供问题依据与行为约束。不得跳过验收直接宣布完成。

**默认交付为“代码与离线验证完成”，不包括发布或真实上游实验。** 用户另外安排维护窗口和对照服务后才进入线上验证。不要自行创建自动任务、重启 DSH、停止现有进程或发送企业微信消息。

### 已冻结的决策

| 项目 | 本轮必须采用的行为 |
| --- | --- |
| 端口 | 保持 `127.0.0.1:18765` 默认值；串行化实例生命周期；真实外部占用明确失败 |
| 端口重试 | 第一版不增加自动 bind 重试；先消除自身竞态，避免把真实冲突隐藏成启动延迟 |
| 新用户 turn | 替换同 lane 的旧 run；不同 lane 互不影响 |
| 重复工具结果 | 不再写上游；返回明确冲突/过期错误，不自动创建新 Run 掩盖错误 |
| Prompt | 保留当前配置默认值；修复 instruction 保留和完整轮次边界，不引入新的摘要或压缩算法 |
| 连接池 | lease acquire/release、GOAWAY 退休、idle 回收、销毁清理；不得用 maxListeners 掩盖泄漏 |
| 批量回写 | 开启：一次 write 写入有序完整帧集合；关闭：逐帧写；两者解码后的帧序列完全相同 |
| 协议 | 保留现有请求头、frame 格式和 streamClose；本轮不猜测或修改 Cursor 私有协议 |
| 工具窗口 | 保留 300ms 收集窗口，本轮不调整该常数 |
| 重试 | 所有失败走同一纯函数决策；只允许无真实输出、无工具结果回写的暂时性连接故障/idle 至多重试一次 |
| 超时 | 每个下游 HTTP 请求有独立总截止时间，使用 requestTimeout；每次重试只用剩余预算 |
| 模型目录 | 使用已有有效映射/缓存；同键合并刷新；没有可靠映射时才有界查询，不盲目合成未知型号 |
| 依赖与 UI | 不升级依赖、不重做设置页，只做行为所需的配置与文案同步 |
| 暂缓事项 | KV 协议重写、图像语义重构、schema 改造、工具名协议改造、跨进程共享监听均不在本轮实现 |

多凭证会话归属必须保留内部 token 身份，禁止轮询后把旧 checkpoint 交给另一凭证。这里的身份信息只在内存中使用，不输出秘密。如果无法在现有结构内完成这项归属，标记 T4 阻塞并说明，不以“当前只有一个 token”为由跳过。

### 工作纪律与质量门禁

1. 每次最多实现一个任务卡。先写能暴露原始问题的函数/接口测试，再修复；红灯阶段不得停留在导入错误而宣称已复现行为错误。
2. 只修改该任务卡列出的文件；发现必须扩大范围时，先在执行记录中写出依赖关系和最小调整，再继续。与任务无关的已有 WIP 不动。
3. 每卡结束记录：状态、实际文件列表、测试命令与退出码、失败到成功的关键断言、剩余问题。仅有“已完成”三个字不算证据。
4. 任一回归失败，不进入下一张卡。不要删除用例、宽化关键断言、只改预期、吞掉异常或增加 sleep 来使测试变绿。
5. 生命周期测试必须走公开接口和真实事件或可控 transport；只断言“mock.close 被调用”不足以证明连接释放。
6. 不用 `any`、`@ts-ignore`、关闭类型检查掩盖新增接口问题。不要改已有全局 tsconfig 严格性以通过检查。
7. 测试应在 finally/after 中清理 server、stream、timer、临时目录；所有等待有上限。套件跑完后进程应自然退出，不能用 process.exit 强制通过。
8. 稳定性验收至少复跑两次完整相关套件；这两次专门用于验证异步竞态与资源清理。通过后不无理由重复。
9. 不得声称消除了上游排队或“已经比 cursoride2api 更快”。只有完成同条件真实测量后才能报告性能变化。
10. 找不到用户实际对照版本时，完成本轮代码和离线验证，明确标记“性能对照待验证”，不因此停下独立可做的修复。
11. 仓库状态和本文基线不同，先重新定位对应函数；若关键协议/架构已改，停止受影响任务卡并输出差异，继续无关卡。不要按旧行号覆盖新实现。
12. 最终先做一次专门的反向审查：对第 11 节每条验收，尝试构造失败输入；记录实际发现和处理结果。不能把编写时的自检重复命名为独立审查。

执行状态只允许：`NOT_STARTED`、`IN_PROGRESS`、`PASS`、`BLOCKED`。`PASS` 必须附证据；`BLOCKED` 必须说明哪个输入/契约缺失以及还能独立做什么。

## 1. 目标与边界

解决以下问题，按阶段分别提交，避免一次改动难以归因：

1. 插件启动偶发 `EADDRINUSE 127.0.0.1:18765`，包括重复启动、插件销毁与异步初始化交错。
2. 修复 held run 清理及工具恢复状态机。
3. 修复 Prompt 压缩导致 system 指令和会话边界丢失。
4. 完成 HTTP/2 连接池生命周期，使“批量工具结果回写”开关有实际语义。
5. 定位并减少代理引入的等待和重复执行，对照实际使用的 `cursoride2api` 版本测量。

约束：

- 原文档阶段只交付方案；后续用户已授权实施代码与离线构建，并于 2026-09-10 另行授权诊断启动，具体操作以实施报告为准。已完成真实日志观察、迟到工具续接实现及新构建重启加载；修复后的真实请求验证和性能 A/B 尚未进行。
- 执行时每个滚动 60 秒内对真实上游的请求不超过 5 次。模型目录查询、健康检查、自动重试、失败后的重放均计入同一全局额度；工具调用本身也按一次上游请求计数。T0～T7 的默认交付是离线验证，期间真实上游请求数必须为 0。只有得到后续线上实验授权后，才可访问真实上游；届时使用全局令牌桶或等价计数器兜底，按请求发出时间计算滚动窗口，不能按“请求类型”分别计数。
- 线上实验必须串行执行，单次请求完成或明确失败后才能发起下一次；两次真实上游请求的启动时间至少间隔 12 秒，遇到目录刷新、自动重试或限流等待时继续顺延。若每个配对样本需要分别请求 dsh-tencent 与对照服务，则一对样本至少消耗 2 次额度，20 对样本至少需要 40 次请求，预计最短耗时约 8 分钟；不得为了缩短实验时间并发发出。
- 不自动停止占用端口的陌生进程、不随机换端口、不静默转发给另一个宿主。
- 不把加大超时或减少输出作为“性能提升”。
- 不默认开启浏览器端到端验证。测试函数和服务接口，不渲染组件、不断言 DOM；新测试放包级 `test/`。
- 保留已有未提交改动，不使用 `git reset --hard` / `git checkout --` 恢复整个工作区。
- 本次不扩展到此前审查的凭证权限整改；不得为调试记录 Token、完整 Prompt 或工具结果正文。
- 不借机升级依赖。当前 WIP 已有 `unrun`，优先复用；需要新增依赖时另列理由和日期。

## 2. 调查基线与证据边界

源码基线：分支 `feat/cursor-cache-oa`，HEAD `eaa5430`；调查时有 12 个修改文件、未跟踪的 `src/cursor/trace.ts`。只有 HEAD 不足以重现当前行为，后续必须同时保存 WIP 差异和未跟踪源码。

前一轮检查：TypeScript 检查通过；Node 22.15 下 21 个现有测试通过、构建通过。默认 Node 20.20.2 下测试参数和构建运行时不兼容。这些是现有版本结果，不是本文修复的验证结果。固定开发运行时前应读取当前锁定工具链的 `engines`；本机已有 Node 24.18.0 可作为候选。

2026-09-09 17:57（Asia/Shanghai）只读现场：

- `18765` 监听者为 PID `71448`，命令属于 DSH Desktop 启动的 `dsh ... web` 宿主。
- 当时 `/dsh-proxy/api/status` 返回 `entry.listening=true`、`entry.error=null`，有一个活跃 Cursor 请求。
- 这是正常运行时的快照，不能证明此前报错时也只有一个宿主。
- web profile 包路径是指向源码仓库的符号链接：
  `~/.dsh/profiles/web/node_modules/@tencent/dsh-tencent -> ~/proj/dsh-tencent`。
  **直接在源码目录构建会改写安装路径可见的 `lib/`。** 单纯哈希一致不能证明宿主内存里已加载该版本。

| 结论 | 依据 | 确定性 |
| --- | --- | --- |
| `sync()` 并发会重复启动，失败回调可能清空成功实例引用 | `src/entry-server.ts`：没有串行化，成功后才保存 server；error 回调无条件置空 | 已确认代码缺陷；是否解释某次现场报错需事件日志 |
| 销毁后异步加载完成仍可能启动监听 | `src/index.ts`：`ensureLoaded().then(...)` 无 disposed/generation 检查 | 已确认竞态路径 |
| 固定入口上修改自身端口可能等待自己的响应结束 | `routes/control.ts` 等待 `sync()`；`EntryServer.close()` 等待 `server.close` 回调 | 需本地 HTTP 接口复现 |
| 新用户消息不再清理匹配的 held run | `routes/cursor.ts`：`!hasHeldRunForLane(lane)` 时才 `abandonHeldRuns(lane)` | 已确认逻辑错误 |
| 压缩会删掉开头 system，且可能保留被截断轮次的 assistant | `cursor/converter.ts`：`messages.slice(index + 1)` | 已确认逻辑错误 |
| 池内 session 持续累积每个 run 的 error listener | `cursor/client.ts`：共享 session 每次 `.on('error', ...)`，关闭时未移除 | 已确认资源管理缺陷 |
| 池过期与“批量回写”未真正执行 | `POOL_MAX_AGE_MS`、`releasePooledConnection` 未使用，`useBatchToolResume` 只有赋值 | 已确认未完成实现 |
| 日志几乎逐包写盘且重复标注 firstFrame | `onData()` 用 buffer 是否为空判断首包，正常解帧后 buffer 经常再次为空 | 代码与现有 trace 日志一致；耗时占比未测量 |
| 冷目录查询在聊天关键路径 | `handleCursor()` 先等待 `usableModels()`；目录请求上限 15 秒 | 已确认存在额外等待，不代表每次都耗时 15 秒 |
| 重试缺少输出进度与错误分类保护 | 路由 catch 可在已输出正文后重新 Run；`result.error` 又在 catch 外抛出 | 已确认路径不一致 |

## 3. cursoride2api 对照基准

本次只读参考的是公开仓库 `7836246/cursoride2api`，提交：

```text
e76251335581ad5c26624daa866bb76506326fe0
提交日期：2026-03-20
本地参考：/tmp/dsh-cursoride2api-review-20260909
```

不是对用户实际运行版本的认定。执行前必须记录用户服务对应的仓库、提交、配置及实际 wire model ID；临时参考目录也不应作为长期唯一来源。

从该提交的 `server.js`、`src/cursor-client.js`、`src/config.js` 可以确认：

| 路径 | 公开参考版本 | 当前 dsh-tencent |
| --- | --- | --- |
| 聊天前模型目录 | 直接静态映射后 Run，聊天路由不调用 getModels | 先等待缓存/目录查询 |
| 上游 HTTP/2 | 每次 Run 新连接 | 默认池化，但清理未完成 |
| 对话状态 | 新 conversationId、空 conversationState | 稳定 lane，checkpoint 状态缓存 |
| 工具恢复 | 未实现 DSH MCP held/resume 闭环 | 暂停 Run，返回 tool_calls，等待 DSH 再恢复 |
| 无输出处理 | request timeout；未见独立的 90 秒有效内容 watchdog | 有有效内容 watchdog，恢复阶段额外宽限和代理重试 |
| 错误返回 | 流式路径可能把错误放正文后以 stop 结束 | SSE error，但代理与 DSH 重试可能叠加 |
| KV 消息 | 忽略 kvServerMessage | 同样忽略 |

因此不能从该参考版本推导“必须补 KV 处理”“必须增加某个请求头”或“streamClose 一定正确”。当前代码里声称“对齐 cursoride2api”的注释，必须与实际参考分支、协议定义或脱敏抓取样本核对。

公开参考版本没有池化却可能体感更快，说明需要先检查模型选择、目录等待、工具闭环和错误语义。不能据此断定连接池无效，也不能用参考版本把错误报成功的情况计算成功延迟。

## 4. 阶段 A：固定端口生命周期

修改范围：`src/entry-server.ts`、`src/index.ts`、`src/routes/control.ts`；需要时调整状态类型和设置页错误文案。

### 实现要求

1. 将 `sync()`、`stop()` 纳入同一个串行状态转换通道。状态至少区分 stopped、starting、listening、stopping、failed。
2. 对相同目标配置，重复 sync 应合并或成为 no-op；不能再次调用 listen。
3. 使用 generation/revision 标记异步操作归属。过期操作的 listen/error/close 回调不得修改新实例状态。
4. 创建 server 后立即记录操作身份；启动失败时仅清理该操作拥有的 server，不能清空另一实例。
5. effect 销毁时立即使其初始化失效。`ensureLoaded()` 完成后先检查 effect 是否仍有效，再启动入口和机器人。
6. 区分“释放监听端口”和“等待已有连接排空”。不要在配置请求的响应路径等待承载该请求的 server 完全关闭。
7. 重新绑定时允许已有响应正常完成；宿主真正退出时再执行有界排空和本插件资源清理。不能为了热修改端口强制截断其他正常会话。
8. 第一版不增加自动 bind 重试。生命周期修复后仍发现旧宿主退出交接造成冲突时，单独给出现场日志和后续建议，不在本轮隐藏该冲突。
9. 真有其他进程长期占用时保持失败状态，说明“另一宿主或服务正在占用”。不得把任意占用者认作本实例成功监听。
10. 若发现多份包加载到同一进程，先记录实例 ID 与插件加载关系；串行化单个 EntryServer 不能解决两个独立实例竞争。按宿主加载机制解决重复加载，不默认增加全局共享代理。

故障现场最小记录：pid、实例 ID、generation、期望 host/port、状态转换、错误 code；不记录凭证。`status` 中返回实际监听地址，不能仅返回配置目标地址。

### 验收

- 并发执行多次同配置 sync，最终只有一个 listener，status 正确，stop 后端口可重新绑定。
- start 尚未完成时 stop，初始化晚返回也不重新监听。
- A 配置、B 配置、stop 交错，最终状态遵循最后有效命令。
- 使用真实本地 HTTP 请求通过固定入口修改自身端口，请求能完成，旧端口释放，新端口正常。
- 用测试服务故意占用目标端口：显示真实错误，不杀进程、不切随机端口；释放后重试成功。
- 旧 server 的 error/close 晚到时，不污染新 server 的状态。
- 测试使用系统分配的空闲端口；占用测试动态预留端口，不碰生产 `18765`。

## 5. 阶段 B：held run 与重试一致性

修改范围：`src/routes/cursor.ts`、`src/cursor/client.ts`、`src/cursor/lane.ts`、`src/cursor/usage.ts`。

### 状态与所有权

- 明确 running → paused → running → closed 转换，以及每种状态下 waiter、pending tools、定时器和 abort listener 的归属。
- 新用户消息替换同 lane 的旧工具等待。移除当前反向条件；关闭旧 run 后再获取恢复快照，防止旧 checkpoint 覆盖新状态。
- 审核已 resumed、仍留在 heldRuns 中的 running 实例：清扫不能拿“工具等待 TTL”误杀正在输出的长任务。
- paused TTL 必须有主动到期清理，不能依赖下一次请求触发 sweep。到期释放 stream 和心跳。
- 为同 lane 的并发请求定义明确策略：建议新用户 turn 替换旧 turn；同一工具结果重复提交返回明确冲突或复用已知结果，不重复执行工具。
- 初次 running run 当前未纳入 heldRuns，要一并考虑同 lane 新请求的取消归属；不要扩大到其他 lane。
- 只接受 paused run 的完整待回写 ID 集；缺失、过期、重复或其他 lane 的 ID 不得恢复错误会话。
- 记录 token 身份、模型和工具定义签名。继续同一会话时绑定原凭证；凭证撤销或模型变化时显式重建，不把别的账号 checkpoint 当成可用状态。
- lane fallback 仅依据消息内容不能保证两个相同首问的独立会话隔离。集成环境有稳定 session header 时应优先使用并验证；不得无证据修改 DSH 全局配置。
- `exposeTools=false` 要贯穿工具挂载、已有 held run 恢复和文本工具解析，而非仅传空 mcpTools。

### 工具协议与回写

- 单独提取结果帧构造与回写流程，保留实际 exec ID、call ID、成功/错误语义。
- 核对 `execClientControlMessage.streamClose` 的协议与用户实际参考版本；公开 Lite 版本不提供该闭环依据。没有协议证据时不能任意删加控制帧。
- `write()` 返回 false 时等待 drain；close、error、abort 必须能结束等待，避免永久悬挂。
- 不再吞掉 write/parse 异常后继续等 90 秒。错误应进入明确的失败和清理流程。
- 只有结果确实写入后，才记录 resume-written 时刻；“调用 write() 已返回”不能冒充网络写回完成。
- `batchToolResume` 定义为：开启时合并当前完整待回写集合的帧写入；关闭时顺序写入。两种模式帧内容、顺序和最终语义一致；不要借此改变工具执行并发或遗漏终止帧。
- 批量模式只合并本地 write，不改变协议语义；若执行者无法实现或验证，标记该卡阻塞，不自行删掉设置项降低交付要求。
- 当前 300ms 工具收集窗口另行测量；协议有明确批次结束信号时优先使用。未确认不会丢晚到工具调用前，不直接减到 0。

### 重试决策

提取纯函数，例如 `decideRetry({ errorKind, attempt, outputDelivered, toolResultsWritten, signalAborted, elapsedMs })`，所有失败路径共用，包括 Promise reject 和 `result.error`。

| 情况 | 默认决策 |
| --- | --- |
| 用户取消、被新 turn 替换 | 不重试，立即清理 |
| 401/403、模型或参数不合法、协议无法解析 | 不盲目重放；返回分类错误 |
| 已向客户端输出正文或真实 reasoning | 不在同一 SSE 内重新生成，以免拼接重复/矛盾回答 |
| 工具结果已回写，上游恢复失败 | 默认不自动重放工具；先判断 checkpoint 是否覆盖该结果 |
| 首包前连接失败或 GOAWAY 拒绝新 stream | 在请求总时限与限流预算内，最多一次可证明安全的重试 |
| 只有 heartbeat、长期无有效进度 | 明确 idle 错误；重试须满足无输出、无不可重复副作用等条件 |
| checkpoint / token 进度在变化 | 记录为进展，不与纯 heartbeat 混同；仍受整体时限限制 |

- heartbeat 表示连接存活，不能无限延长无进度等待。
- `request.setTimeout()` 是活动超时机制，不应当作完整请求的墙钟总时限；另设覆盖目录、连接、Run 和重试的截止时间。DSH 工具执行等待要有独立 TTL。
- 保留现有超时配置用于首轮诊断；先定位误判，不直接把 90 秒改成几分钟。
- 区分代理重试次数与 DSH `llm/retry`。让失败有可追踪 ID 和错误类型，避免两个层级各自重试形成倍增。
- 无法保证恢复语义时，明确失败比返回空白 stop 或伪造成功更合适。

### 验收

测试覆盖新 turn 替换、跨 lane、迟到结果、重复结果、暂停到期、运行中不误过期、取消、恢复写失败及正常多工具闭环。特别断言所有 waiter 只结束一次，没有残留心跳或挂起 Promise。

验证已输出后失败时没有第二个 Run；401 不自动重试；首包前可恢复连接故障至多一次；工具失败不会被标成成功结果。

## 6. 阶段 C：Prompt 压缩与上下文保真

修改范围：`src/cursor/converter.ts`、`src/store.ts`；需要时更新设置说明。

1. 分离 instruction 消息与对话轮次。始终保留有效 system/developer 消息和相对顺序；仅去除角色与正文完全相同的重复指令。
2. 按 user turn 切分历史，窗口从保留轮次的 user 开始，包含其 assistant 和 tool 闭环；不能从已删除 user 的 assistant 开始。
3. `historyWindowTurns` 在存储与调用边界规范成有限正整数。明确超过窗口的行为，不依赖 UI 的 min/max 属性。
4. 冷启动、状态失效恢复时，滑动窗口等于主动丢历史。本轮保留已有默认值，只修复 instruction 和轮次边界；文案明确窗口是有损行为，不额外改变默认配置或生成摘要。
5. 工具结果截断可保留首尾并显示截断标记；总长度约束包含标记，避免损坏代理对、合法结构和工具错误字段。明确该功能是否只作用于重建 Prompt。
6. 正常 held.resume 路径当前直接回写 toolResults，不经过 messagesToPrompt。不能宣传 Prompt 截断已经减少正常工具回写流量；需要有损处理时单独定义并测试。
7. `compression=false` 必须绕过所有有损截断，包括增量工具结果分支。
8. delta 模式仅在状态确实覆盖前文时使用。system、工具定义或模型发生变化时，不只发最后一句 user 而遗漏新上下文。
9. 图像遍历、schema 清洗和工具名归一化属于另一个兼容性整改范围。本轮不修改它们；在结果中保留风险，纯文本/工具基准必须分别固定输入，避免混淆。
10. 如果回归样例表明这些暂缓项实际阻断本轮工具闭环，记录最小复现，升级为明确阻塞；不要无边界扩展整改或通过删工具来绕过。

最小回归样本：

```text
system=S，developer=D
user=U1，assistant=A1
user=U2，assistant=tool_call(T2)，tool=result(T2)，assistant=A2
user=U3，assistant=A3
user=U4
```

窗口为 3 时，保留 S、D 和 U2 开始的完整轮次；没有孤立 A1。再验证长工具结果、混合文本附件、空消息、关闭压缩和 stale state 重建。

## 7. 阶段 D：HTTP/2 池与流生命周期

将池提取到 `src/cursor/connection-pool.ts`，`client.ts` 只持有 lease，方便测试接口。

- acquire 返回 session 与幂等 release；活动 stream 计数归零后启动空闲回收。
- 区分最大连接年龄和空闲超时。最大年龄到期不打断现有 stream，只停止分配新 stream，排空后关闭。
- GOAWAY 后从可用池中摘除 session；允许旧 stream 按协议结束，新请求使用新连接。
- close/error 回调仅移除仍指向该 session 的 map 条目，防止迟到事件误删新连接。
- session 级监听器数量不随历史请求累计。使用池级监听和 lease 订阅，或严格对称绑定/解绑；不能通过提高 maxListeners 掩盖泄漏。
- 清理覆盖成功、错误、取消、paused 到期、配置切换、插件销毁。池关闭要包括退休但尚未排空的连接。
- `getModels` 可复用同一传输管理，但必须保证目录请求关闭不会关闭其他 Run 所在 session。
- 限制活跃连接和队列，排队受请求时限与取消控制；不能把池化改成无限排队。
- stream 的 close / RST_STREAM / HTTP 非成功状态必须及时结束调用；不要缺失事件监听导致等待 idle watchdog。
- 解码检查 frame flags 与长度。实际返回压缩或非 JSON 错误时明确处理/拒绝，不能 catch 后静默丢帧。扩展编码支持前先确认协议。

验收使用本地 HTTP/2 测试服务或可控 session stub：重复借还、并发 stream、一条取消不影响另一条、GOAWAY 换新、旧 close 不误删新连接、idle 到期、stop 清理、异常帧与断流。检查 listener 数量稳定、资源计数回落。

## 8. 阶段 E：目录等待与可观测性

### 模型目录

- 缓存按上游地址、凭证身份及必要的 clientVersion 隔离；记录使用时间并有界回收。
- 同一缓存键只允许一个 in-flight refresh；失败应退避，不能每个聊天都重新等待 15 秒。
- 有 stale catalog 时先用旧值处理聊天，后台刷新；刷新也计入全局请求额度。
- 完整 wire model ID 或已验证的固定映射可直接 Run；不因无关目录查询阻塞。
- 需要目录才能解析的 grouped ID，优先持久化的最近有效映射；不存在时做有界查询。不能为了快而发送未经验证的合成型号。
- 后台预热不能在插件销毁后继续发请求，也不能多 token 同时突发。

### 事件记录

修复 firstFrame 判断：每个 Run/attempt 使用独立布尔值，只记录一次。移除逐包文件追加；采用串行、有界批量写，支持 debug 开关、轮转和退出 flush，尊重 `DSH_HOME`。

每条请求至少记录以下事件及单调时钟耗时：

```text
request_received
catalog_ready          cache=hit|stale|miss, wait_ms
connection_ready       reused, connect_ms
run_sent               wire_model, prompt_chars, tool_count, image_count
upstream_first_frame
first_real_thinking
first_real_text
tools_emitted          count
resume_received
resume_written         bytes, write_wait_ms
first_progress_after_resume
retry_decision         attempt, reason, allowed
request_finished       outcome, total_ms, error_kind
```

日志使用 request ID、attempt ID 和不可反推 Token 的内部凭证 ID；正文仅记录长度。`正在等待模型…` 和零宽字符 keepalive 不算真实 thinking、TTFT 或 token。

现有 trace 缺少完整错误与重试决策，且 firstFrame 被重复记录，因此不能据此计算可靠 TTFT 或归因全部慢请求。先补指标，再调参数。

## 9. 验证矩阵与性能实验

先在包级 `test/` 完成纯函数、状态机、本地 HTTP/HTTP2 接口测试。现有三个测试文件迁入该目录并更新脚本；复用已有 TS 加载工具，不渲染设置组件。注意原生 strip-types 对无扩展名内部导入的兼容性。

后续执行者的本地检查命令：

```sh
cd /Users/jiahaoqian/proj/dsh-tencent
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

构建应在隔离副本进行，避免源码 `lib/` 符号链接影响安装目录。依赖运行时须先锁定；本文没有执行上述命令。

### 分组比较

| 分组 | 内容 | 目的 |
| --- | --- | --- |
| A | 同一短文本、无工具、无图片、全新会话 | 比较基本传输和首正文延迟 |
| B | 相同多轮文本，固定首轮与后续轮次 | 比较上下文恢复和缓存效应 |
| C | 同一工具定义、可控本地工具、相同结果字节数 | 验证工具闭环，分离工具执行与恢复等待 |
| D | 模拟断流、GOAWAY、heartbeat-only、迟到工具结果 | 验证终止与重试决策，不访问真实 Cursor |

若用户实际 `cursoride2api` 不支持工具闭环，C 组只评估 dsh-tencent 修复前后，不能拿它和参考版本纯文本请求比较。

真实 A/B 固定同一机器、网络、Token、完整 wire model ID、reasoning effort、请求内容及 clientVersion；交错 A/B 顺序，串行请求。禁止让比较双方同时争用同一 conversationId。

记录：

- 首上游帧、首真实 thinking、首正文、总耗时。
- 成功率、超时率、代理/DSH 各自重试率、每用户请求实际 Run 次数。
- 目录等待、连接建立、工具执行、结果写回、恢复后首进度耗时。
- 输出长度与完整性，避免短回答/错误被当成快回答。

先做少量 smoke，确认没有重复副作用再扩展到每组至少 20 个配对样本；20 对仍只是探索性结果。展示中位数、范围和原始失败数，不据少量样本宣称稳定 p95 或提升百分比。后台轮询和自动重试必须计入每分钟 5 次额度。若尚未取得线上实验授权，执行者只能完成本地 fake transport / HTTP2 测试，并在报告中将真实 A/B 标记为 `BLOCKED（未授权）`。

通过条件：功能回归全部通过；没有新增重复 Run/工具执行；未出现 listener/连接累积；冷目录命中场景不再支付不必要等待；性能结论能由同条件样本解释。上游排队造成的慢请求应单独列出，不承诺消除。

## 10. 交付、启用与回滚

实施顺序与第 11 节任务卡一致：

1. 隔离副本、基线和测试入口。
2. 固定端口生命周期与接口回归测试。
3. Prompt 保真与配置语义。
4. 连接池生命周期。
5. held run、凭证归属与批量回写。
6. 重试决策、总截止时间与阶段日志。
7. 目录缓存与接口集成。
8. 完整离线验收报告；真实 A/B 和发布另外执行。

每个提交附：改动范围、复现样例、测试结果、行为变化和回滚方法。不要把已有 WIP 误记为本文实施的新增改动。

启用前保存旧构建及原配置的本地受限副本，记录源码提交和 WIP、构建运行时、产物哈希、宿主启动时间。不要把含密钥的配置备份提交到 Git。

由于 profile 是源码 symlink，部署必须明确替换哪个 `lib/`。选择无活跃会话的维护时机，只重启目标 DSH 宿主；刷新网页不能替换宿主内存代码。确认 listener 所属进程与实际 build ID，而不仅是包版本 `0.1.0`。

回滚只恢复本次启用的构建与必要配置，保留源码 WIP；不杀所有 node、不清空 `.dsh`、不重置整个仓库。出现串会话、重复工具、流无法终止或频繁失败即回滚，保留脱敏事件用于定位。

最终交付检查：

- [ ] 端口竞态与真实占用均有可重复测试。
- [ ] held run 归属正确、暂停到期释放、取消不重放。
- [ ] system/developer 保留，工具与轮次边界完整。
- [ ] HTTP/2 池无累计监听器，GOAWAY/close/release 幂等。
- [ ] 批量回写开关有可验证语义；不能删除开关来替代本轮实现。
- [ ] 已输出/已回写工具场景不盲目自动重试。
- [ ] 日志不逐包写盘，首包/首正文/重试可区分。
- [ ] 冷目录查询有界、刷新合并、后台请求服从限流。
- [ ] 对照版本与 wire model 已锁定，性能结果不混入失败样本。
- [ ] 仅在后续明确执行时启用新构建；本次文档交付不触发上线。

## 11. 逐项任务卡与明确预期

这是验收规范，不是测试伪代码。执行者应把下述行为转为可运行的 `node:test` 用例；不能只在报告里复述。

### T0：保存基线、隔离构建、建立测试入口

允许修改：隔离副本的 `package.json` 测试脚本、`test/`；需要时新增执行记录文档。不得修改运行中的 profile 链接。

操作：

1. 记录真实 HEAD、分支、tracked diff、untracked 清单；保存每个后续会触碰文件的原始字节及 SHA-256。
2. 建立包含这些 WIP 的隔离副本。普通 `git worktree add HEAD` 不会带入 WIP，不能当作完整基线。排除 `.git` 复制冲突、凭证、日志和 node_modules，再使用本地已有依赖或冻结锁文件安装；有网络动作时计入预算。
3. 验证隔离副本中的源码哈希与原目录一致；确认构建输出位置不会解析到原目录 `lib/`。
4. 将三个已有测试文件移到包级 `test/`，修正导入，保持所有原始断言。使用已有 `unrun` 和 `node:test` 驱动 TS 文件，测试失败须让进程非零退出。
5. 运行一次原有 21 个用例与 typecheck，留存输出；刻意让一个临时断言失败确认测试命令退出非零，再撤销该临时变更。

通过：基线可恢复、没有遗漏 WIP、运行中路径未变、原测试没有减少、失败传播正常。基线失败先归类为已有失败，不能算新实现通过。

### T1：端口状态机

允许修改：`entry-server.ts`、`index.ts`、`routes/control.ts`、对应 `test/entry-server.test.ts`。状态类型/文案仅在确需新增诊断时修改。

设计边界：

- 保留 `sync(config): Promise<void>`、`stop(): Promise<void>`、`snapshot(config)` 外部契约。
- 增加串行转换和 generation；每个 server 回调携带创建时 identity。`stop` 使 pending start 失效，并最终清理全部本实例资源。
- effect 的异步初始化使用独立生命周期标记，不依赖全局布尔值，否则重新 apply 时旧回调会误认为自己恢复有效。
- rebind 的“端口停止接受连接”不得等待当前配置响应；旧连接排空独立追踪。单独定义 shutdown 的有界排空策略。

必须通过：

| ID | 输入/事件 | 精确预期 |
| --- | --- | --- |
| E01 | 同一配置连续 10 次并发 sync | 一个实际 listener，无 EADDRINUSE，最终 status 正确 |
| E02 | listen 尚未完成时 stop | stop 返回后端口可重绑，旧初始化完成也不再监听 |
| E03 | 配置 A → B → stop 交错 | 最终无 listener；A、B 都可重绑 |
| E04 | 活跃旧 server 的晚到 error/close | 新 server 的 listening/status 不被清空 |
| E05 | 经入口 HTTP 修改它自己的端口 | HTTP 响应在测试时限内完成，旧端口关闭、新端口可用 |
| E06 | 目标端口由另一个测试 server 持有 | 保持失败；占用 server 仍可响应；不改配置端口 |
| E07 | 销毁 effect 后 ensureLoaded resolve | 不调用监听启动、不启动该次机器人实例 |

不允许：以换端口、杀 PID、延迟启动 5 秒或忽略 EADDRINUSE 替代修复。

### T2：Prompt 函数保真

允许修改：`cursor/converter.ts`、`store.ts`、`test/prompt.test.ts`；必要时修改相关设置文案。

拆出可测试的消息选择函数；原始 messages 与 options 不得被修改。边界从保留的最早 user 开始，额外保留所有有效 instruction。

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| P01 | 第 6 节样例，window=3 | S、D、U2/T2/A2、U3/A3、U4 均保留；U1、A1 不出现 |
| P02 | 只有两轮 user，window=3 | 两轮全部保留，instruction 不丢失 |
| P03 | 两条相同 system + 一条同正文 developer | 只去掉重复 system；不把 developer 合并掉 |
| P04 | window=1，有工具调用结果 | 最后一轮 user 及其完整工具闭环保留 |
| P05 | compression=false，incrementalToolResults=true，超长结果 | 不执行有损截断；内容逐字保持 |
| P06 | 无 user 或空数组 | 返回确定结果、不抛意外错误、不丢有效 instruction |
| P07 | 结果含 emoji/代理对，超过长度上限 | 截断标记可见；不产生孤立代理字符；总输出不超过定义上限 |
| P08 | 非有限/小数/小于 1 的窗口配置 | 按统一规则回退或规范为正整数，存储和运行路径一致 |

P05 不要求修改正常 held.resume 数据；该路径的回写保真由 T4 验证。

### T3：连接池

允许修改：新增 `cursor/connection-pool.ts`、`cursor/client.ts`、宿主销毁钩子、`test/connection-pool.test.ts`。

建议接口形状如下，具体类型应由 Node 类型推导，不得用 any：

```ts
interface ConnectionLease {
  session: ClientHttp2Session
  release(): void
}
// acquire(origin) -> lease
// dispose() -> 所有池内和退休连接最终关闭
```

测试注入时钟与 connect 工厂，用可控事件验证时间推进，不真的等 5 分钟。必须至少有一个真实本地 HTTP/2 多 stream 测试，防止 stub 掩盖资源问题。

| ID | 输入/事件 | 精确预期 |
| --- | --- | --- |
| H01 | 顺序借还 30 次 | 健康连接复用；session listener 数不随次数累积 |
| H02 | 同连接两个 stream，取消其中一个 | 另一个完成，session 不被误关 |
| H03 | GOAWAY 后新 acquire | 新连接；旧 stream 可结束；旧连接最后 release 后关闭 |
| H04 | 已替换 session 的 close 晚到 | 新连接仍可从池取到 |
| H05 | 无活跃 stream 且 idle 到期 | 连接关闭，从池移除 |
| H06 | 最大年龄到期且仍有 stream | 新请求不分配旧连接；旧请求不中断 |
| H07 | 同一 lease 重复 release | 计数不为负、不影响其他 lease |
| H08 | dispose、连接错误、请求取消 | 无遗留 timer/socket，相关 Promise 有界结束 |

### T4：run 所有权、工具恢复和批量回写

允许修改：`cursor/client.ts`、`cursor/lane.ts`、`cursor/usage.ts`、`routes/cursor.ts`、`store.ts` 中凭证选择；`test/cursor-run.test.ts`。

外部行为不变：DSH 收到 OpenAI tool_calls，执行后携带 tool_call_id 返回。内部必须保存 run 对应的凭证、模型、lane、工具签名与 pending IDs。原 token 失效时明确失败，不自动换号继续旧状态。

批量开关只决定写入次数：

```text
pending = [A, B]
orderedFrames = [result(A), streamClose(A), result(B), streamClose(B)]
batch=true  -> 一次 write(concat(encode(frame) for frame in orderedFrames))
batch=false -> 依次写入上述四帧，保留 backpressure 等待
```

“写回完成”定义为本地 stream 写入回调/缓冲处理完成，不宣称上游已接受；只在接收后续上游进度时记录上游恢复成功。

| ID | 输入/事件 | 精确预期 |
| --- | --- | --- |
| R01 | A lane paused；新 A user 到达 | 旧 A closed，新 run 唯一；旧 waiter 不二次完成 |
| R02 | A paused；新 B user 到达 | A 保持可恢复，B 独立启动 |
| R03 | pending=[a,b]；只回 a | 返回不完整结果错误；不回写半批、不重开 Run |
| R04 | 完整回写 a,b 后重复发送 a,b | 不二次 write、不发第二次工具执行；冲突/过期错误可识别 |
| R05 | paused TTL 到期，无其他流量 | 自动释放 stream/心跳，不等待下一次请求扫表 |
| R06 | resumed run 输出持续超过 paused TTL | 不因工具等待 TTL 被清扫 |
| R07 | batch 开/关，包含失败工具和空结果 | 解码后帧序列相同，错误工具仍为错误 |
| R08 | write=false 后 close/abort | 等 drain 的 Promise 结束，timer 与监听器释放 |
| R09 | 同 lane 后续选择了另一 token | 恢复使用原 token；原 token 被删除则失败，不混用 checkpoint |
| R10 | exposeTools=false，已有 paused run/文本工具输出 | 不恢复工具循环、不输出可执行 tool_calls，清理旧工具 run |

同 lane 的请求在初次 running 阶段也需要归属控制，不能只覆盖进入 paused 之后。重试不得绕过替换/取消判断。

### T5：重试决策、截止时间、事件日志

允许修改：新增 `cursor/retry.ts`、`routes/cursor.ts`、`cursor/client.ts`、`cursor/trace.ts`、相关 runtime/types；`test/retry.test.ts`、`test/trace.test.ts`。

把错误规范为有限枚举，例如 `cancelled`、`replaced`、`auth`、`invalid_request`、`protocol`、`transport`、`idle`、`deadline`。保留上游错误细节作脱敏诊断，不用字符串包含“timeout”作为唯一分类器。

| ID | 决策输入 | 精确预期 |
| --- | --- | --- |
| Q01 | transport，attempt=0，无输出，无工具回写，有剩余时间 | 允许一次重试 |
| Q02 | 与 Q01 相同但 attempt=1 | 禁止重试 |
| Q03 | auth / invalid_request / protocol | 禁止重试 |
| Q04 | cancelled / replaced / deadline | 禁止重试并释放资源 |
| Q05 | 已输出真实文本或 reasoning，随后 transport/idle | 禁止第二个 Run；SSE 不能拼接第二份回答 |
| Q06 | toolResultsWritten=true，随后失败 | 禁止自动重放；记录恢复失败 |
| Q07 | 仅本地等待提示，没有任何真实输出 | 提示不改变 outputDelivered 标志 |
| Q08 | 请求预算 120s，首 attempt 已用 90s | 第二 attempt 最多使用剩余 30s，不能重新获得 120s |
| Q09 | 上游错误经 result.error 返回或经 reject 返回 | 两条路径分类和重试决策一致 |
| Q10 | 多个正常帧分包/粘包送达 | 每个 attempt 仅一条 upstream_first_frame；无逐包日志 |
| Q11 | heartbeat 持续，业务进展停止 | 到期结束；heartbeat 不无限续期 |
| Q12 | stream RST/close 发生在结束帧前 | 及时失败；不空白 stop，不等 90s 才发现 |

单元测试用注入时钟验证 90/120 秒逻辑；不为了测试真的等待这些时长。正常工具等待在下游该次请求结束后由 paused TTL 管理，不吞掉下一次 HTTP 请求的独立预算。

### T6：目录缓存与接口集成

允许修改：`routes/cursor.ts`、必要时新增 `cursor/model-cache.ts`、`test/model-cache.test.ts`、`test/cursor-route.test.ts`。

使用 loader 注入测试缓存，不触碰真实 Token 或上游。保留 10 分钟现有新鲜期；新增失败退避默认 30 秒，仅影响目录刷新。

| ID | 输入/事件 | 精确预期 |
| --- | --- | --- |
| M01 | 同键 10 次并发目录 miss | loader 只调用一次，所有等待者有界返回 |
| M02 | stale cache 存在，后台 loader 挂起 | 聊天使用 stale 映射继续，不等待刷新完成 |
| M03 | 不同凭证身份/上游地址 | 不交叉复用目录 |
| M04 | 查询失败后退避期内多次聊天 | 不逐请求重查；有效旧映射仍可用 |
| M05 | 明确完整 wire ID，目录查询很慢 | Run 不因目录等待延迟 |
| M06 | 未知 grouped ID，没有可靠映射 | 有界查询或明确失败；不发送猜测型号 |
| M07 | 宿主销毁/请求取消，查询尚未完成 | 属于该生命周期的查询结束；晚到结果不污染新实例 |

集成测试至少走完整 POST → fake HTTP/2 Run → tools → POST results → completion 流程，并验证多 lane、取消、错误响应和资源清理。不用真实模型代替本地可复现测试。

### T7：交付门禁

允许修改：执行报告与本轮必要修复；不部署。

1. 在隔离副本运行完整测试两次、typecheck、build、diff-check，保存真实输出；确认退出码均为 0。
2. 核对原有 21 项断言仍覆盖原行为；每个 E/P/H/R/Q/M 验收 ID 必须映射到测试名称。某条未测不能标 PASS。
3. 审查新增 catch：每个吞异常处必须有理由；业务/协议异常不得被转换成成功。
4. 审查新 timer、event listener、session、server：逐一指出创建与清理位置，核对失败和取消路径。
5. 审查所有重试入口：包含宿主已有重试在内，报告谁负责限流、谁负责取消、上限在哪里；未做真实验证的 DSH 行为标明待验证。
6. 输出可供应用的本轮独立 patch/提交，保持原 WIP；实际应用至用户源码目录和启用构建按后续执行授权进行。
7. 提交以下报告，不得省略“未完成”字段：

```text
基线：HEAD、WIP 摘要、运行时版本
源码交付：patch/commit、本轮文件清单
T0～T7：各卡 PASS/BLOCKED 与证据路径
验收覆盖：E01～M07 对应测试名称
测试：命令、退出码、总数、两次运行时间
类型/构建：命令、退出码、产物位置
资源审查：listener/timer/session 的清理结论
行为变化：重试、端口、Prompt、批量开关
未完成：真实 A/B、用户实际 cursoride2api 版本、现场启动复现等
部署状态：未部署，原宿主是否保持运行
回滚材料：基线文件/配置/构建保存位置
```

完成标准是**每项行为有可重复证据**。文档不能替执行结果背书；缺失真实 A/B 时可以交付“功能修复与离线验证完成”，不能交付“慢与重试问题已全部解决”。
