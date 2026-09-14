# dsh-tencent 实施结果

初始实施：2026-09-09；本机最终验证：2026-09-10（Asia/Shanghai）

## 交付状态

- 目标仓库：`/Users/jiahaoqian/proj/dsh-tencent`。
- 在原有 WIP 上实施，没有重置、回滚或提交用户已有改动，没有升级依赖。
- 原始基线 HEAD：`eaa54301d64fc1bf8879e841fa413cce1ab810e1`，分支 `feat/cursor-cache-oa`。
- 初始阶段在隔离副本修改和验证，再同步源码及 `lib/`；后续重试、工具计时与迟到工具续接增量直接在目标包实施。当前实际工作区完整测试连续两次 110/110 通过。
- 原有 21 个测试保留断言并移到包级 `test/`，新增测试同样位于该目录。不渲染组件、不使用浏览器。
- `lib/` 已重新构建。2026-09-10 03:46:18（Asia/Shanghai）在确认空闲后重启 DSH；已核对 profile 解析到迟到工具修复构建、新宿主启动晚于构建、固定入口正常监听。当前基线见“本次增量：迟到工具续接”，下节保留之前的启动记录。
- 本轮执行主动发起的真实 Cursor/目录请求数为 0；最新重启后的代理请求计数也为 0。没有发送企业微信消息，没有做真实性能 A/B。

## 历史现场启用：2026-09-10

以下时间均为 Asia/Shanghai。用户要求先用真实对话验证，再继续优化；本次仅处理启动与诊断准备，没有调整代理代码、配置参数或依赖。

- 02:35:47，系统记录 DSH Desktop PID `13556` 因 `EXC_BAD_ACCESS` / `SIGSEGV` 崩溃。随后检查发现宿主 PID `14082` 的父进程为 `1`，仍监听 `18765`；新桌面 PID `15339` 下的宿主 PID `15360` 报 `EADDRINUSE`。这解释了本次端口冲突的直接占用来源，不代表已定位桌面崩溃根因，也不证明所有历史冲突都有同一原因。
- 02:38:45，确认上述两个宿主的 `activeRequests=0` 后，正常退出当前桌面，并仅对核验身份后的残留宿主 `14082` 发送 `SIGTERM`。确认所有目标进程已退出、`18765` 无监听者后才重新启动；没有停止陌生服务或修改端口。
- 02:39:03，使用本次启动专属的 `DSH_CURSOR_TRACE=1` 启动 Desktop。未修改全局环境或签名应用文件；02:40:39 复查，Desktop PID `17749` 和直属宿主 PID `17760` 仍在运行，二者均继承日志开关。
- 本地状态接口所在 web 端口为 `56097`；固定代理入口仍为 `127.0.0.1:18765`，`state=listening`、`error=null`，`lsof` 确认监听者为 `17760`。基线 `activeRequests=0`、`totalRequests=0`。
- profile 将 `@tencent/dsh-tencent` 解析到 `/Users/jiahaoqian/proj/dsh-tencent/lib/index.js`。构建修改时间为 02:05:27，SHA-256 为 `0d2f3582bcf0764f33f177b3fe693544acf7d218d0b18a2b882b43eb9def6a61`，包含本次工具计时、边界观测与首响应字节保护标记。上述核对是构建路径与新进程证据，不是线上请求性能测量。
- 诊断位置为 `/Users/jiahaoqian/.dsh/storages/dsh-proxy/trace.log`。基线大小 `14559613` 字节、修改时间为 2026-09-09 19:15:26，尚无 `trace.log.1`；没有真实请求时日志未更新属预期。旧日志已完整备份到受限目录，首次新日志可能触发轮转，后续分析应检查当前文件与 `.1`，不能仅沿用旧字节偏移。

脱敏基线：`/Users/jiahaoqian/.codex/artifacts/dsh-tencent-runtime-SW7K7Z/runtime-baseline.json`。该目录中的 `trace-before.log` 是原始历史日志备份，不应直接展示或复制进报告。

当时安排由用户发起 Cursor 对话，观察结果见下节。该历史启动参数不是永久设置；若再次重启桌面，须重新核验宿主身份与日志开关。桌面崩溃及其残留宿主问题仍需单独定位，不能宣称已永久修复。

## 后续真实对话观察

2026-09-10 02:48:47–02:53:25（Asia/Shanghai），用户实际发起的样本包含 26 个 HTTP 请求：25 个交付成功、1 个 409；其中 20 次工具恢复均走快速路径，没有代理自动重试事件。本地 HTTP 交付为 0–1ms；300ms 收集窗口仍在，不能宣称已经提速。

这次 409 已由 trace 和 DSH 会话记录关联：第 7 次恢复后，两条工具结果均已在 DSH 生成，但代理在交付约 26ms 后收到被当时 ID 规则判为新工具的迟到通知，触发 `tool_late_call action=fail`，删除 held Run，随后结果请求被统一映射为 conflict。原日志未记录该通知的 exec 身份，尚不能区分真正新工具与 ID 变化的重复通知。当时 D05 只覆盖失败关闭，不覆盖可恢复迟到；该观察不是验证通过。本次已补齐续接实现和两类通知的回归，但不能反过来把旧样本视作新修复的线上验证。详细统计见 [真实对话观察](/Users/jiahaoqian/proj/DSH-Plugs/docs/cursor-proxy-live-validation-2026-09-10.md)。

上述日志观察阶段没有改动插件源码、参数、构建或运行实例；用户后续请求不计入该固定窗口。真实调用由用户发起，执行代理没有额外发送模型或目录请求。随后用户授权落地的修复与当前运行基线如下。

## 本次增量：迟到工具续接

**已实现并重新构建加载；110 项离线回归连续两次通过。修复后的真实对话效果尚待验证，不宣称所有 409 已消除。**

本次生产源码仅修改 `src/cursor/client.ts`；测试修改 `test/tool-dispatch.test.ts`、`test/cursor-route.test.ts`、`test/trace.test.ts`。没有修改配置、依赖、模型、Prompt、重试策略或 300ms 常数。

1. 已交付批次与迟到队列分离。返回的工具 ID、参数保持不变；暂停后的工具完成通知不能修改已交付工具。快照复制工具对象，避免共享引用被后续参数补全改写。
2. paused 与 running 使用一致的 call ID / 非空 exec ID 去重规则。同 exec 换 call ID 的别名通知不再导致 Run 关闭；真正的新工具进入待交付队列。
3. 恢复仍严格接受旧批次完整、唯一的结果集合，按原顺序回写，每条结果和控制帧只发送一次。迟到工具进入下一次 HTTP 响应，继续同一上游 Run，不重放旧结果或重开 Run。
4. 复用迟到队列已等待的静默时间。正常收集常数仍为 300ms；只有距最后工具通知不足 300ms 才等待剩余时间。即使静默时间已满足，也必须先完成上一批结果的本地写入和 HTTP/2 背压等待，才能交付下一批。这里的写入完成不是上游接受确认。
5. 暂停期间的正文/thinking 暂存到恢复后的 HTTP 响应，不能继续调用已完成响应的输出回调。回放缓冲不触发 `first_progress_after_resume`；`first_text_after_resume` 仍可能是本地缓存的正文，分析时必须结合 `deferred_output_replayed` 区分，不能据此声称上游即时生成。
6. 队列最多 64 个工具、512 个输出片段，工具标识/名称/参数与输出共用 1MiB 载荷预算；参数补全也检查预算。溢出明确失败，取消、替换、5 分钟 paused TTL 和关闭均清空队列；失败关闭同时丢弃未完成 checkpoint。输出回调中发生取消时，不再调用后续回调或回写结果。

新增脱敏诊断：`tool_late_call action=queue key=<12位哈希>`、`tool_duplicate`、`tool_deferred_promoted queued_ms=...`、`deferred_output_replayed`、`tool_buffer_overflow`、`run_closed`。诊断只记录状态、计数和标识摘要，不输出原始参数、结果或凭证。路由对外的通用 409 文案保持不变；没有添加失效 Run 墓碑查询或自动恢复重放。

收益是减少迟到通知造成的意外对话中断，并避免迟到队列已等待后再完整等待一遍 300ms。普通工具批次的静默窗口、模型推理时间和 DSH 外层重试未改变；没有线上提速百分比。

### 本次加载基线

以下时间均为 2026-09-10，Asia/Shanghai。

- 03:44:08 构建完成；profile 的 `@tencent/dsh-tencent` 仍通过 `link:` 解析到 `/Users/jiahaoqian/proj/dsh-tencent/lib/index.js`，构建哈希见证据节。
- 03:46:17 确认旧宿主 `17760` 的 `activeRequests=0` 后正常退出桌面，等旧桌面与宿主均退出、`18765` 无监听者后再启动；没有终止陌生进程或更换固定端口。
- 03:46:18 新桌面 `76183` 启动，03:46:19 新宿主 `76194` 启动，父进程为 `76183`。两者均继承本次启动的 `DSH_CURSOR_TRACE=1`；本地 web 端口为 `61366`。
- 03:50:53 核对：全机只有一个 DSH web 宿主，固定入口唯一监听者为 `76194`；`state=listening`、`error=null`、`activeRequests=0`、`totalRequests=0`。桌面及宿主均已持续运行超过四分钟。此短时检查不代表桌面崩溃根因已修复。
- 03:55:55 再次核对：相同桌面与直属宿主持续运行超过九分钟，唯一监听者、开关、构建哈希及零请求计数均未变；状态仍无错误。复查记录为 `runtime-stability.json`。
- 日志仍为 `/Users/jiahaoqian/.dsh/storages/dsh-proxy/trace.log`；当前大小 87053 字节，修改时间 02:53:25，内容哈希未变。尚无新模型请求时不产生新 Run 事件属预期；旧 `.1` 仍须保留并按时间窗口区分。

本地状态检查未调用模型、模型目录或上游健康检查。路径、哈希、新进程时间及状态构成本次加载证据，不是线上私有协议验证。请用一条新的用户消息继续验证；已经关闭的旧 Run 不能靠重复提交过期工具结果恢复，也不应重放已执行的工具来掩盖错误。

## 已实施

| 任务 | 状态 | 实现与验证 |
| --- | --- | --- |
| T0 基线与测试入口 | PASS | 保存带 WIP 的源码基线；复用已安装的 unrun；原有 21 项测试通过；新增行为测试确实非零退出后修复 |
| T1 入口生命周期 | PASS | 串行 sync/stop、过期启动失效、实例归属检查、旧连接独立排空；真实本地 HTTP 换端口不再死锁；真实占用仍失败；增加实际监听地址、实例 ID、generation 和 PID |
| T2 Prompt 保真 | PASS | 保留 system/developer、完整 user 轮次和工具调用关联；关闭压缩不截断增量结果；截断含标记且不破坏 UTF-16 代理对；窗口统一整数化 |
| T3 HTTP/2 池 | PASS | `origin -> Set<session>` 受控多连接池；单连接达到 stream 上限时在全局上限内扩容；lease 幂等释放、空闲回收、最大年龄退休、真实 GOAWAY、并发 stream 隔离；连接数和等待队列有上限；销毁覆盖活动与退休连接 |
| T4 工具恢复 | PASS | running/paused 都纳入 lane 所有权；主动暂停 TTL；严格匹配完整结果集合；原凭证归属；真正批量回写及背压处理；跨 Run 和跨工具轮次使用唯一对外工具 ID；held resume 复用原 stream/模型/凭证/checkpoint，短路目录、Prompt、图片和模型分组 |
| T5 重试和诊断 | PASS | 收到任意上游响应体字节后保守禁止重放，包括半帧和 heartbeat；无响应字节且无输出/工具/Checkpoint 进度的 transport/idle 至多重试一次，共享总截止时间；首字节与解析成功的完整帧分别记录；失败状态清理按请求归属隔离 |
| T6 目录与集成 | PASS | 完整 wire ID 直接 Run；缓存按 origin/clientVersion/凭证隔离；并发查询合并、stale 优先、失败退避；取消和销毁隔离；真实本地 POST → HTTP/2 tools → POST results → completion |
| T7 离线交付门禁 | PASS | 实际源码目录完整测试连续两次 110/110；源码及测试类型检查通过；构建通过；git diff --check 通过 |
| T8 工具派发计时与边界保护 | PASS | 收集/本地 HTTP 响应完成/结果回写/恢复后首正文分别计时；连续恢复关联到各自 HTTP request；单工具完成、步骤完成和 turn 结束只观测、不提前派发；晚到、多工具、重复和分片回归通过 |
| T9 迟到工具受控续接 | PASS | 已交付批次不变；exec 别名去重、有界迟到队列、残余静默时间、写入背压门禁、暂停输出缓冲；连续多轮、溢出/取消/替换/TTL 与 JSON/SSE HTTP 闭环回归通过，真实请求效果待验证 |

这里的 PASS 只指表内离线功能与资源验证，不包含现场启动复现、真实网络性能、DSH 外层重试或完整私有协议兼容性。

## 前次增量：工具派发计时

**已落地计时与回归保护，提前派发未启用。300ms quiet window 不变，不能宣称已节省这 300ms。**

核对本机 Cursor `3.19.13` 的协议及执行实现：`ToolCallCompletedUpdate` 是单工具事件，执行器在工具执行完成后发送；`StepCompletedUpdate` 只有 step ID 与耗时，已查到的成功路径在主执行循环结束后发送。两者都不能证明“这一批全部 exec 已到齐、可以在执行前提前释放”。本机 IDE 版本也不等同于代理声明的客户端版本或真实上游实现；这只是拒绝猜测性优化的依据，不是私有协议兼容性认证。脱敏代码摘录、字节位置和两个本机文件的 SHA-256 保存在 `protocol-evidence.json`。

本次源码变化：

1. `tool_batch_ready` 使用单调时钟记录 `collection_ms`（首个工具通知至批次就绪）、`quiet_ms`（最后一个工具通知至就绪）、唯一工具数和包含重复通知的事件数。
2. `tool_response_started` / `tool_response_finished` 分开记录就绪后的本地适配与 HTTP 交付时间。`finished` 来自 Node HTTP `finish`，不代表 DSH 已收到或执行了工具。关闭、取消、报错都会清理监听，不记假完成。
3. 每次 held resume 创建独立 trace start，关联当前 HTTP `request`，并以 `run`、`round` 连接各轮。首 thinking/正文标记每轮重置，文本过滤器最后释放的可见文本也计入首正文。
4. `first_progress_after_resume` 和 `first_text_after_resume` 分别提供 `resume_to_*_ms`；只有本地回写完成先于输出，才记录 `write_to_*_ms`。迟到的回写回调不能污染新一轮的计时。
5. `tool_boundary_observed` 只记录固定事件类型、轮次、pending 数和 phase，`action=observe_only`；不改变派发、deadline 或重试判断。原有暂停后晚到新工具的失败路径增加 `tool_late_call` 标记。
6. 原仅用来取长度、随整个 Run 增长的工具时间戳数组替换为计数器和当前轮次时间点，计时状态为常数空间。不据此声称可感知的延迟提升。

范围：`src/cursor/client.ts`、`src/routes/cursor.ts`、新增 `src/cursor/tool-timing.ts`；测试均在包级 `test/`。配置、请求模型、Prompt、工具结果、HTTP 对外格式、300ms 常数值和依赖均未修改。新增计时字段不进入 SSE/JSON 响应，不记录 Prompt、参数、结果、凭证；trace 仍默认关闭。

后续启用提前派发的门槛：必须获得可靠的、发生在工具执行前的全批次结束契约及实际顺序样本，并验证分片、多工具晚到、重复通知、取消和多轮恢复；没有此证据就继续保留 quiet window。日志的 P50/P95 必须区分成功/失败及各模型，不能将更早失败当作提速。

## 前次增量：重试

承接 2026-09-09 的首响应禁重试改动，本次完成边界验证与关联修复：

1. `upstreamBytesReceived` 在首次非空响应体 chunk 到达时置位；`upstreamFrameReceived` 仅在完整帧成功解析为 JSON 对象后置位。两者都不代表业务执行成功，也不等于首 token。
2. 任一响应体字节都会阻止代理自动重放。下游 SSE 注释保活不影响重试判断；上游 heartbeat 不延长无业务进度等待。未收到字节的暂时性失败保留最多一次重试，但不能保证上游尚未执行。
3. 修复路由 `session` 变量遮蔽导致的清理失效：失败请求的未完成 checkpoint 不再被下一次请求当作有效 delta 状态。
4. 新消息替换活动请求时先丢弃旧 checkpoint；旧请求迟到的失败清理不能删除新请求的会话，正常完成后的 checkpoint 仍能复用。

这里的收益是限制重复 Run 和防止错误状态造成后续失败，不是缩短首次 idle 等待。更严格的策略也可能放弃原本能靠重试成功的请求；必须结合成功率、每次用户请求的 Run 数和端到端耗时评估，不能单凭重试率下降宣称提速。没有增加超时、修改 300ms 工具收集窗口或改动 DSH 外层重试策略。

## 验收覆盖

测试名称包含验收 ID，可直接在输出中查找：

| 验收 | 测试文件 |
| --- | --- |
| E01–E07，附加 E08 | `test/entry-server.test.ts` |
| P01–P08 | `test/prompt.test.ts` |
| P09：指令变化使 delta 状态失效 | `test/cursor-route.test.ts` |
| P10/M08：首轮目录查询与 held resume 短路 | `test/cursor-route.test.ts` |
| H01–H09 | `test/connection-pool.test.ts` |
| R01–R08、R10 | `test/cursor-run.test.ts` |
| R09、R10：凭证撤销与关闭工具 | `test/cursor-route.test.ts` |
| R11/R12：上游重复使用 ID，旧结果不匹配新 Run/新轮次 | `test/cursor-run.test.ts` |
| Q01–Q09 | `test/retry.test.ts`，以及路由重试与失败进度测试 |
| Q10 | `test/trace.test.ts` |
| Q11/Q12 | `test/cursor-run.test.ts` |
| Q13：完整 heartbeat、半帧头、半帧体断流后，SSE/JSON 均不重开 Run | `test/cursor-route.test.ts` |
| Q14：无字节、半帧与完整 heartbeat 的失败进度分别记录 | `test/cursor-run.test.ts` |
| Q15：字节、帧、输出、工具调用/回写和 checkpoint 各自阻止 transport/idle 重试 | `test/retry.test.ts` |
| Q16：首响应前 idle 最多重试一次，收到 housekeeping 后 idle 不重试 | `test/cursor-route.test.ts` |
| Q17/Q18：失败 checkpoint 失效、替换请求不复用旧状态、旧清理不删新会话 | `test/cursor-route.test.ts` |
| D01/D10：连续两次恢复的独立首输出计时、文本缓冲释放、HTTP SSE/JSON 交付、隐私与对外字段隔离 | `test/trace.test.ts` |
| D02–D05：不可信结束通知不提前派发、延迟多工具、重复/参数补全/拆帧、迟到工具保留旧批次并续接同一 Run | `test/tool-dispatch.test.ts` |
| D06–D09：计时口径、早于回写完成的输出、HTTP finish 与 drain 区别、关闭/取消/错误监听清理 | `test/tool-timing.test.ts` |
| D11–D13：exec 别名与已交付参数不可变、分片迟到队列合并及残余静默时间、暂停正文/thinking 转交新响应 | `test/tool-dispatch.test.ts` |
| D14/D15：工具数/字节/输出数/合并预算/参数补全溢出，取消/替换/TTL 清理与 checkpoint 失效 | `test/tool-dispatch.test.ts` |
| D16：真实 HTTP JSON/SSE → tools → 迟到工具 → completion，只有一个 Run，结果/控制帧各一次 | `test/cursor-route.test.ts` |
| D17–D19：实际 HTTP/2 背压阻止提前交付下一批、连续迟到批次与旧 ID 拒绝、缓冲输出回调取消 | `test/tool-dispatch.test.ts` |
| 迟到事件隐私与计时：队列/提升/关闭可关联，缓存回放不记为新上游进度 | `test/trace.test.ts` |
| M01–M07 | `test/model-cache.test.ts`、`test/cursor-route.test.ts` |
| SSE 有序背压、队列上限、close；帧拆包/粘包和长度校验 | `test/sse-writer.test.ts`、`test/frame-decoder.test.ts` |

## 验证证据

本次基线、定向红/绿与最终门禁均使用本机 Node `24.18.0`，没有安装或升级依赖。

当前证据目录（迟到工具续接，110 项）：

```text
/Users/jiahaoqian/.codex/artifacts/dsh-tencent-late-tools-YXP59d
```

| 文件 | 结果 |
| --- | --- |
| `test-1.log` / `test-1.json` | 实际目标包 `pnpm test`，110 通过、0 失败/取消/跳过，退出码 0；套件耗时 7651.352ms |
| `test-2.log` / `test-2.json` | 同一完整套件再次运行，110 通过、0 失败/取消/跳过，退出码 0；套件耗时 7653.162875ms；进程自然退出 |
| `typecheck.*`、`build.*`、`diff-check.*` | 源码和测试类型检查、构建、`git diff --check` 均退出 0 |
| `red-dispatch.*`、`green-dispatch.*` | 迟到/别名通知原来关闭 held stream 的行为断言先失败，再通过；红灯不是导入错误或超时 |
| `red-callback.*`、`boundary-tests.*` | 补充取消回调与预算/背压等边界；取消回调原来仍交付第二个缓冲片段的断言失败后修复，最终完整回归通过 |
| `before/`、`after/`、`manifest.json` | 本轮前后 83 个文件快照及 SHA-256；核对 `after/` 与实际工作区一致，package/lock 未变 |
| `incremental.patch`、`patch-check.log` | 仅本次源码/测试增量，相对已含用户 WIP 的 `before/`；反向应用只读检查通过 |
| `runtime-check.mjs`、`runtime-baseline.json`、`runtime-stability.json` | allowlist 输出的进程归属、环境开关、端口状态、profile 解析、产物哈希、日志基线及间隔五分钟复查；不输出完整进程环境 |
| `pre-deploy-trace.log` | 修改前日志备份，权限 600；包含旧样本，不能作为修复后的请求证据，不直接展示正文 |

历史证据目录（工具计时阶段，94 项）：

```text
/Users/jiahaoqian/.codex/artifacts/dsh-tencent-tool-dispatch-NYhZN2
```

| 文件 | 结果 |
| --- | --- |
| `baseline.log` | 修改前实际仓库完整套件 86/86 通过 |
| `test-1.log` | 实际仓库 `pnpm test`，94 通过、0 失败/取消/跳过，退出码 0，套件耗时 5701.86775ms |
| `test-2.log` | 同一完整套件再次运行，94 通过、0 失败/取消/跳过，退出码 0，套件耗时 5680.182083ms；进程自然退出 |
| `typecheck.log` | `pnpm typecheck`：同时检查源码和 `test/tsconfig.json`，退出码 0 |
| `build.log` | 目标包目录 `pnpm build`（Node `24.18.0`），服务端及客户端构建成功，退出码 0 |
| `diff-check.log` | 实际仓库 `git diff --check`，退出码 0 |
| `red-trace.log`、`green-trace.log` | 同一工具时序断言从失败到通过；红灯退出码 1，非导入错误；其后继续补齐 HTTP 集成与文本缓冲释放覆盖 |
| `boundary-baseline.log` | 新增的 4 个派发边界用例在原 300ms 行为上已通过，最终完整回归继续通过，未用新协议假设替换旧行为 |
| `protocol-evidence.json` | 本机 Cursor 版本、2 个协议/执行源码文件哈希和 4 处有限摘录，不包含用户会话或凭证 |
| `*.json`（同名日志） | `evidence.mjs run` 保存命令、Node、退出码、signal 与总耗时；中间类型检查失败保留，最终 `typecheck.json` 为退出码 0 |
| `before/`、`after/` | 2026-09-10 本轮前后源码、测试、README、包信息、构建及相关文档快照；`before/` 已包含此前 86 项阶段的重试/状态修复 |
| `manifest.json` | 前后快照逐文件 SHA-256；生成时将 `after/` 与实际工作区逐文件比对 |
| `incremental.patch` | 仅本次源码、测试和 README 增量，相对 `before/`，不包含用户原有 WIP 本身；反向应用只读检查通过 |

前次 86 项阶段证据保留在 `/Users/jiahaoqian/.codex/artifacts/dsh-tencent-20260910-retry-boundaries-pArj6G`，包含半帧、失败 checkpoint、并发替换的红绿记录。更早材料仍保留在 `/Users/jiahaoqian/.codex/artifacts/dsh-tencent-20260909-KT0Pfn`（72 项）、`/Users/jiahaoqian/.codex/artifacts/dsh-tencent-20260909-final`（79 项）和 `/Users/jiahaoqian/.codex/artifacts/dsh-tencent-20260909-retry-gate`（80 项）。旧清单及补丁不作为当前完整源码的证明。测试套件耗时不是线上性能数据。

当前服务端产物 `lib/index.js` SHA-256（03:44:08 构建）：

```text
7b69c0252a5c7e96f0d5b8891dc86648433cd1420b269cc85ffbc710227b39be
```

## 反向审查

- 补测同配置重复保存后当前 listener 再发生错误，修复 generation 变化导致错误状态被忽略的问题。
- 补测旧 listener 的迟到 error/close，确认新 listener 状态不被清空。
- 对外工具 ID 绑定 Run 与工具轮次；内部保留原始 call ID、exec ID 和 frame 顺序。补测上游复用 ID 时的迟到结果，不能回写新任务。
- 无可恢复 exec 元数据的纯文本工具调用明确失败，不先要求下游执行再陷入不可恢复状态。真实 MCP 多工具闭环仍通过。
- 首字节、首完整帧与首正文分开计时；半帧断流不会产生完整帧事件；日志排队总量受限。
- paused timer 在恢复和关闭时清理；请求截止时间独立于工具等待 TTL；取消不转换成正常完成。
- 目录单个等待者取消不影响其他等待者；销毁后晚到结果不再写缓存。
- 新增吞异常仅用于诊断写入失败和已记录退避的后台刷新等非业务路径，不把协议异常转成成功。
- 首轮 grouped model 的目录查询与 held resume 的目录查询分开计数；恢复请求不再重复目录、Prompt、图片和模型分组准备。
- SSE 写入在下游 `drain` 前排队，队列上限触发取消；帧解析使用 chunk queue 改进常见拆包路径，不以此声称所有分片输入都已达到零拷贝。
- 一个 origin 的 HTTP/2 session 达到 stream 上限时，池在全局连接上限内创建第二条 session；H09 离线测试覆盖该扩容路径；GOAWAY、idle、age 和 dispose 仍保持退休清理。
- 收到响应字节后，SSE/JSON 的断流都明确失败，不返回空白 stop；虚拟时钟确认 heartbeat/上下文握手不续期。
- 失败 checkpoint 与替换竞态都有真实本地 HTTP → HTTP/2 的红/绿测试；正常会话继续复用，不被迟到清理误删。
- 工具阶段新增测试使用可控时钟及实际协议回复作为处理屏障，不靠减少断言或增加 sleep 跑绿；SSE/JSON 请求都检查计时元数据未泄漏到响应中。
- 本次反向检查覆盖诊断开销：移除无界时间戳数组；候选信号检查放在正文/thinking/token 快速返回之后；迟到回写捕获原 trace 与轮次；关闭路径移除响应监听。
- 迟到工具阶段补测了实际 HTTP/2 背压：上一批结果尚未完成本地写入时，即使 300ms 已过也不能交付下一批；连续三批结果 ID 严格归属各轮。
- 缓冲预算反向覆盖参数补全及工具/正文合计字节，而非只数工具；回放缓冲中途取消后无后续输出回调和结果写入。失败关闭清除未完成 checkpoint，局部回放不伪造新的上游进度。

## 启用与剩余边界

本次已按用户授权重启 DSH 加载迟到工具修复并启用诊断，固定入口和新宿主基线见“本次增量：迟到工具续接”。旧构建的真实对话已观察，修复后的新对话仍待用户发起；刷新网页不等同于替换宿主代码。

需要特别注意的行为变化：

- 默认端口仍是 `127.0.0.1:18765`，不会自动杀占用进程或改成随机端口。
- 新用户 turn 替换同 lane 的旧 run；重复、不完整、过期工具结果返回可识别冲突，不能静默重开 Run。
- 迟到的新工具可续接下一批，同 exec 的别名通知不关闭 Run；这不等于允许重复结果，也不保证兼容所有私有协议变体。超过有界队列或 Run 已失效仍明确失败。
- 对外 `tool_call_id` 是不透明的唯一标识，客户端必须原样回传；内部 Cursor exec 字段保持不变。
- `requestTimeout` 包含目录、图像准备、连接、Run 和代理重试；不为每次重试重新分配完整时限。
- 首响应体字节之后不自动重放，是保守策略，不是上游接受证明；首响应之前允许的重试也不提供 exactly-once 保证。
- SSE 保活采用注释帧，不再用等待提示或零宽 reasoning 冒充有效输出。
- 诊断代码默认关闭；本次授权启动已通过 `DSH_CURSOR_TRACE=1` 开启，日志位置遵守 `DSH_HOME`，只记录事件和长度，不记录 Token、完整 Prompt 或工具正文。另起桌面进程后应重新核验开关。
- 工具计时和信号观测已启用代码路径，但实际日志仍需上述环境变量。300ms 常数不变，迟到队列复用已等待时间；未启用基于猜测协议边界的提前派发，线上提速仍未证实。
- 内存缓存没有新增跨进程持久化。冷启动且没有可靠映射的 grouped ID 仍需一次有界目录查询。

未完成或本轮未验证：

- 用户实际运行的 `cursoride2api` 版本及同条件性能 A/B，不能宣称已经更快。
- 真实 Cursor 私有协议的全部变体、实际 DSH/企业微信完整业务闭环及 DSH 外层自动重试策略。
- 缺少显式 session header 时，仍保留原消息摘要 fallback；相同首问的独立会话无法仅靠内容保证隔离。
- KV、图像语义、schema 和工具名归一化整改未扩展；凭证文件历史权限问题未作为本轮整改。
- 2026-09-09 最早实施前的 `lib/` 原件未保留；本次 2026-09-10 的修改前 `lib/` 已保存于 `before/lib/`。两者都不能证明宿主当时内存里运行的版本。

本次回退仅撤销 `incremental.patch` 或基于 `before/` 在隔离目录重建，不重置整个仓库，不删除原配置。补丁使用 `before/` 与 `after/` 前缀，在目标包使用 `git apply --reverse -p2 --check` 可只读检查回退兼容性；真正回退前仍需排除后续用户改动冲突。实际重启应安排维护窗口。
