# workspace-plus 兼容性与会话标题调研

日期：2026-09-10，Asia/Shanghai。

范围：本仓库 workspace-plus、共享 runtime、本机安装的 DSH 一手源码、只读缓存统计、函数/接口隔离复现。未启动浏览器 E2E，未升级依赖，未修改生产代码、运行配置或会话记录。

## 结论

**不是一个开关或一次重装能解决的问题。** 本机 DSH 为 `0.1.5-alpha.2`，共享 runtime 的官方类型仍为 `0.1.1-rc.2`；宿主插件已经加载，但插件部分调用、目录入口与排序方式没有跟上当前契约。[版本][version] [类型基线][runtime-package] [宿主调查][host-report]

已通过函数级复现确认：

1. **新建会话调用了已不存在的 `workspaces.startSession`。** 当前能力属于 `uiWorkspace`。
2. **行识别没有处理真实 React Fiber 的 `return: null`。** 搜索结果还使用插件不认识的 `result` 属性，可能没有菜单或触发行扫描异常。普通会话的 `node` 结构仍能识别，并非全部行结构都变了。
3. **会话置顶只改后台顺序，当前 DSH 却优先使用前端排序账本。** 因此可能显示置顶成功，但位置不变或随后被最近更新排序覆盖。
4. **会话显示项目名有独立的 DSH 标题投影原因。** 无持久化标题时，官方显示函数退回 cwd 的目录名；旧空会话的冷加载、分叉会话的冷加载均存在可复现的触发路径。不能把所有这类行都解释成 workspace-plus 把标题改成了项目名。

另有必须一起治理的宿主问题：自定义路由未接入当前 DSH Cookie 认证；改主目录遗留旧绑定；多文件夹提示词可能错误描述实际 cwd/权限。细节见[宿主补充报告][host-report]。

## 2026-09-10 实施结果

本报告确认的第一批问题已经落地修复：

- 会话新建、打开、分叉、归档迁到 `uiWorkspace`，旧能力面保留受控 fallback。
- 行解析支持当前搜索结果，正确处理 Fiber `return:null`，空白 New Session 行不再接管菜单；工作区装饰按 ID 匹配，不再依赖重名标题。
- 会话置顶迁移为工作区作用域，并在能力存在时同步 DSH 的 `setSessionOrder` 视图账本；操作失败不再先写本地成功状态。
- 增加冷会话标题兼容层：Host 只读折叠正式标题、首条用户消息 fallback 和 blank 状态，Client 仅覆盖同一 `updatedAt` 的缺失投影，不写回日志。
- 单文件夹创建也同步用户填写的标题；切换主目录通过 `previousRoot` 原子替换插件绑定。
- 新绑定强制绝对、存在、目录且 primary 属于目录集合；路径身份不再无条件转小写。
- 多文件夹说明迁到 runtime context，经单一变量注入用户路径，兼容 complete persona 且不臆测 sandbox 权限。
- 所有自定义路由接入 Connection 浏览器认证；文件管理器操作等待退出码为 0，不再把 spawn 当成功。

包级验证为 workspace-plus 71/71、runtime 7/7，两个包类型检查和构建通过，客户端模块清单门禁通过。仓库级依赖门禁仍被既有的缺失目录 `plugins/dsh-mobile-web/package.json` 阻断。按项目规则未做浏览器 E2E，也未重启正在运行的 DSH。

尚未落地的跨项目项：非本机 native picker 场景的完整 directoryFlow 替换、DSH-Desktop 同源会话新窗口桥、把冷标题修复正式上收 DSH list 上游。当前 macOS loopback 桌面运行使用 native picker，原有拦截路径仍有效。

## 功能矩阵

“接口兼容”仅表示一手源码契约匹配，不代表完成了真实界面的全部操作验收。

| 功能 | 当前判定 | 建议 |
| --- | --- | --- |
| 工作区新建会话 | 确定失效：旧方法不存在 | 共享 runtime 适配 `uiWorkspace.startSession`。[调用][actions-new] [官方入口][navigation] |
| 普通工作区/会话右键菜单 | 常见行形状仍匹配；遍历存在异常边界 | 修复 null 终止、限制扫描范围、未知结构不接管。[识别][rows] [官方普通行][native-session-row] |
| 搜索结果菜单 | 未适配 `SearchResultItem({result})` | 增加受验证的 result 身份解析，按 ID 回查列表；不可借用父工作区身份。[搜索行][search-row] |
| 会话置顶 | 后台顺序与视图顺序不一致 | 在视图排序阶段稳定分区 pinned/unpinned；不能只反复调用 insertSessionBefore。[插件置顶][actions-pin] [官方排序][view-order] |
| 工作区置顶 | 能移动到首位，但不是持续排序约束 | 明确多置顶顺序和取消置顶语义，失败后不要保留成功状态。[actions-pin][actions-pin] [菜单状态][dispatch] |
| 重命名会话、归档 | 当前方法仍存在 | 保留官方接口；增加错误与未就绪测试，不应归入“全部 API 失效”。[重命名][rename] [官方绑定][native-actions] |
| 分叉会话 | 创建接口兼容，导航不完整 | 走 `uiWorkspace.forkSession`，同时处理布局导航及过期请求；不要只调用 sessions.open。[调用][actions-fork] [官方导航][navigation] |
| 未读标记 | 仅插件本地标记 | 明确它不等于 DSH 的 completed/pending 状态；定义打开后是否清除。[本地状态][features] |
| 复制标题 | 复制的是 fiber 行投影，可能已经是目录名 | 使用 session ID 查当前快照，区分真实 title 与 displayTitle；数据源缺标题需从源头补齐。[复制动作][dispatch] [官方显示][display-title] |
| 复制链接/新窗口 | 链接依赖临时 origin；桌面新窗口语义不符 | `window.open` 被桌面源码拦截为系统浏览器；需要桌面桥支持，或明确改名为“在浏览器打开”。[深链][deep-link] [桌面拦截][desktop-window] |
| 深链导航 | 最多轮询约 7.5 秒，最后只刷新一次 | 改为订阅列表就绪状态，并通过 uiWorkspace 导航；目标不存在/归档要有反馈。[深链处理][deep-link-handler] |
| 添加多个文件夹 | native picker 路径可被现有补丁拦截；browse 路径不经过它 | 使用官方两处 directoryFlow slot，统一处理拾取、取消和失败。[native][native-picker] [browse][browse-picker] [slot 契约][directory-slots] |
| 单文件夹自定义名称 | 创建分支直接返回 original，忽略窗口填写的名称 | 无论文件夹数量，都执行标题同步；绑定持久化可以仍仅用于多文件夹。[创建分支][create-patch] |
| 编辑/悬浮路径/运行状态 | 依赖 DOM 子项位置、工作区名称和旧 hover 识别 | 改为 workspace ID 定位；官方 HoverCard 并不承诺 `aria-label="Copy: path"`；后续争取行扩展 slot。[装饰][chrome] [官方工作区行][native-project-row] |
| 改主目录、系统提示、打开目录 | 多项条件缺陷已复现 | 稳定绑定身份、真实权限事实、路径校验、命令退出状态；详见宿主报告。[host-report][host-report] |
| 自定义 HTTP 端点 | 未复用当前认证边界 | 统一接入 Connection 的 requestRejection；这是安全缺陷，不是导致功能被认证拦截的证据。[host-report][host-report] |

## 标题 Case

### 1. 项目名从哪里来

实际安装的官方调用链：

```text
session/title 持久化事件
  -> Host title projection
  -> session.list 的 projections.values.title / control projection frame
  -> Client SessionManager.buildListSnapshot().title
  -> ClientSessions.displayTitleOf(title, cwd, id)
  -> ui-workspace sessionNode.title
  -> 侧栏会话行
```

其中 `displayTitleOf()` 的优先级为 `title -> basename(cwd) -> id`，而不是工作区的用户自定义名称。因此如果你看到的“项目名”恰好等于目录名，就与这条 fallback 路径一致；如果显示的是不同于目录名的自定义工作区名，还需要单独核对，不能用本结论直接覆盖。[显示函数][display-title] [客户端投影][manager] [行派生][session-node]

workspace-plus 的 `rows.ts` 只读取并标记行，不负责写普通会话标题；`WorkspaceRowChrome` 添加按钮、状态点和路径内容。没有发现“把所有会话标题写成 workspace.title”的代码。[rows][rows] [chrome][chrome]

### 2. 旧空会话冷加载会变成项目名行

“冷会话”指记录在磁盘上、尚未挂载为当前 Host 内存会话的记录。

`ApiSessionList.projectionsFor()` 对旧格式缓存允许 `cachedPredecessorTitle()` 返回 **仅 title** 的提示值，不返回 `sessionListMetadata`。后者的格式不能直接信任，因此不能简单取消校验。[冷列表][cold-list] [旧缓存策略][predecessor]

当旧记录实际为空、缓存 `title: null` 时，流程为：

```text
旧缓存：title=null, sessionListMetadata.blank=true
  -> 旧格式严格校验不通过，退回仅 title 的提示
  -> list 获得 { title: null }，没有 sessionListMetadata
  -> summarizeCold 默认 blank=false
  -> 客户端缺 title，displayTitle=项目目录名
  -> 原本应隐藏的非当前空会话，作为普通会话显示
```

直接调用本机官方 `ApiSessionList.prototype.summarizeCold`，用内存 cache double 模拟上述条件，得到：

```json
{
  "sessionId": "s-1",
  "running": false,
  "blank": false,
  "cwd": "/projects/example",
  "projections": { "asOfSeq": -1, "values": { "title": null } }
}
```

这是**官方函数在特定输入下的确定性复现**，不是浏览器截图验证。要确认某个实际行，需要再核对该 ID 是否冷加载、是否进入当前 list、是否仍在磁盘上。

本机只读统计提供了与该机制相符的候选数据：

| 项目 | 数量 |
| --- | ---: |
| 缓存文件 | 327 |
| 缓存有非空真实标题 | 214 |
| 缓存 title 为 null | 113 |
| 缺 formatVersion 的旧缓存 | 296 |
| 旧缓存中 blank=true 且 title=null | 103 |
| 上述记录未归档 | 52 |
| 上述未归档记录仍记入现有工作区 | 7 |

统计来源是 `~/.dsh/storages/session_projcache/sessions/` 与 `workspace.json`，没有输出标题/对话正文到报告。**52 和 7 是候选记录数，不是已确认受影响的可见行数。** 其余 title=null 缓存中，8 条是当前格式空记录，2 条是已开始 turn 但没有合格用户输入的记录，不能简单称作“标题生成失败”。

### 3. 分叉会话也有冷加载缺标题路径

同一官方方法对 `header.isSeeded === true` 的冷会话直接不提供缓存 projections，因此即使该分叉在磁盘/缓存上有标题，初始列表仍可能只有 cwd。用 seeded header 和返回非空标题的内存 cache double 调用官方函数，结果没有 projections，`blank=false`。[冷列表][cold-list]

这与“打开后标题恢复”“重启后部分旧分叉显示目录名”的现象相符，但本次没有逐条验证用户的具体分叉。该分支涉及继承事件数和缓存身份校验，不能通过忽略 lineage 校验强行读旧缓存解决。[缓存身份][cache-identity]

### 4. 正确修复层次

1. **先修列表元数据，而不是批量重命名。** 对缺失当前元数据的会话，使用官方 session query/格式归一化流程计算真实 title 与 blank；空会话隐藏、真实会话恢复标题应分开处理。
2. **遵守缓存身份与 inheritedEventCount 校验。** 对 seeded 会话必须取得真实继承边界后再折叠，不能使用未经验证的旧 title/blank。
3. **做有界的补齐队列。** 可评估 `sessionQuery.observeSession(id, { projectionMode: 'all', signal })`，读取 projection 后释放 observation；限制候选数、并发与时间。此接口可能准备/迁移记录并计算完整投影，不能把它当成零成本 list 查询，本次没有在用户记录上调用。[官方观察接口][observe] [官方历史使用][history-source]
4. **优先在 DSH list 上游或受维护的桌面 runtime 补丁修复。** workspace-plus 可增加诊断/受控修复入口，但只改它的菜单文案不会改变官方侧栏数据源。
5. **缺标题时才提供保守兜底。** 未命名 + 短 ID 或第一条合格用户消息摘要均可作为呈现方案，但应标识为派生，不通过 rename 写成 `source:user`。用户手动标题优先且不得覆盖。[官方 rename 语义][title-rename]

本次向受保护的 `/api/session/list` 发起无 Cookie 只读调用得到 `unauthorized`，未尝试绕过认证；因此尚不能定位用户所指每一行的实时 list/投影状态。仅凭已有磁盘标题，也不能断言当前 renderer 必然已经收到标题。

## 插件修复方案

### 第一批：小范围恢复与安全修复

- 在 `packages/runtime` 补齐结构化 UiWorkspace 能力：`startSession/openSession/forkSession`。插件统一经过共享适配；旧宿主 fallback 只在方法实际存在时启用，不新增插件对官方包的直接依赖。
- 把行身份解析抽成容忍未知输入的纯函数：null/undefined 都结束；支持普通 node 和受验证的 search result；作用域限于工作区侧栏；最终 ID 与当前数据列表交叉确认。
- 重命名/复制标题按 ID 从当前 sessions 快照读取，避免以陈旧 fiber 文本作为真值。
- 动作成功后再提交 pin 状态，或明确失败回滚；无 workspace、不可排序或无打开能力时禁用对应动作，不显示虚假成功。
- 所有宿主路由复用当前 Connection 认证；收紧 scan/bind 的绝对路径和目录校验。

验收：新/旧能力面、未知行、search result、null fiber、请求失败、未授权请求，都由包级函数/接口测试覆盖。

### 第二批：目录入口、绑定和置顶

- 接入 `sidebar.workspaces.directoryFlow` 与 `conversation.hero.workspace.directoryFlow`。这两者都是 single slot，要通过 composition 明确替换官方 native/browse occupant，不能在同一槽中盲目并存。目录选择能力与绑定提交分开，取消/重复打开/失败重试有独立状态。
- 绑定采用稳定身份或显式 previousRoot 原子替换；改主文件夹不能暗示已有 session.cwd 已迁移。单文件夹创建也同步名称；普通工作区重命名与绑定名称保持一致。
- 真正的置顶定义为 `稳定的 pinned 分区 + 用户选择的普通区排序`。DSH 现有 native 视图没有给本插件公开逐行 pin/sort 扩展契约，优先争取上游 slot/排序扩展。
- 若必须在插件内立即实现完整置顶，可替换公开的 `sidebar.workspaces` 区域、自持视图排序，但必须保留官方搜索、分组、拖动、归档、空会话与可访问性能力。这属于独立中等改造，不应伪装成一次 insertBefore 修复。

仓库已有未接入的 `session-pins.ts` 和测试，可复用其作用域与稳定分区规划，但当前 `features.ts/actions.ts/RowMenuOverlay.tsx` 未导入它。只接入后台 move planner 仍不能解决前端排序覆盖。[现有规划][session-pins] [当前状态][features] [官方排序][view-order]

### 第三批：上游协作

- DSH：修复冷会话 title/blank 元数据不完整问题，并提供稳定的 workspace/session 行身份、菜单、附加信息与排序扩展点。
- DSH-Desktop：为同源会话提供显式新窗口/聚焦桥；外部链接继续保持协议和来源检查。不能把全部 window.open 都无条件放行。
- 依赖按仓库每周更新策略单独升级、验证和记录日期。本轮不通过升级 lockfile 掩盖具体问题。

## 验证与边界

使用本机 Node `v24.18.0` 执行：

| 验证 | 结果 |
| --- | --- |
| `pnpm --filter @just-genius/dsh-workspace-plus test` | 40/40 通过，包含任务开始前已有的未跟踪测试 |
| `pnpm --filter @just-genius/dsh-workspace-plus typecheck` | 通过 |
| `rowInfo` 输入未知行 + `return:null` | 复现 `Cannot read properties of null (reading 'memoizedProps')` |
| 新建会话输入当前纯 WorkspaceController 能力面 | 复现 `startSession is not a function` |
| 官方 `reconciledSessionOrder(['pinned','normal'], ['normal','pinned'])` | 返回 `['normal','pinned']`，证明后台移位不足以改变视图 |
| 官方 `displayTitleOf` | 缺标题返回 `example`；真实标题存在时返回真实标题 |
| 官方冷列表函数 + 旧空会话/seeded fixtures | 分别复现 blank=false/title=null、无 projections |

复现只调用纯函数或以内存 doubles 驱动接口；从 bundle 提取函数使用 TypeScript AST，没有 render 组件或断言 DOM。既有测试通过并不覆盖上述输入。没有构建覆盖当前运行中的 lib，没有重启 DSH。

本次公开网页检索未取得可用正文；所有技术判断均落到本机实际安装的一手源码，不以外部文章或“最新版本应该已修好”代替证据。宿主注入清单中旧 pure-core 包与残留符号链接属于待核验项，不能仅凭它们认定整个客户端未加载。[宿主安装边界][host-report]

## 源码索引

[host-report]: /Users/jiahaoqian/proj/DSH-Plugs/docs/workspace-plus-host-compatibility-2026-09-10.md
[version]: /Users/jiahaoqian/.dsh/runtime/node_modules/@deepseek-ai/dsh/package.json:4
[runtime-package]: /Users/jiahaoqian/proj/DSH-Plugs/packages/runtime/package.json:30
[actions-new]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/actions.ts:84
[actions-pin]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/actions.ts:93
[actions-fork]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/actions.ts:123
[rename]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/actions.ts:71
[rows]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/rows.ts:26
[chrome]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/WorkspaceRowChrome.tsx:163
[features]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/features.ts:94
[dispatch]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/RowMenuOverlay.tsx:324
[deep-link]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/actions.ts:60
[deep-link-handler]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/index.tsx:175
[create-patch]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/index.tsx:128
[session-pins]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/client/session-pins.ts:82
[navigation]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:60
[native-actions]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:2754
[native-session-row]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:935
[native-project-row]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:675
[search-row]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:879
[session-node]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:417
[view-order]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1344
[display-title]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.js:41
[manager]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/manager.js:802
[cold-list]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js:125
[predecessor]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js:188
[cache-identity]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js:361
[observe]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-query/lib/index.js:1048
[history-source]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/history.js:269
[title-rename]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-title/lib/index.js:285
[directory-slots]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:1
[native-picker]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-directory-picker-native/lib/client.js:62
[browse-picker]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/lib/client.js:1020
[desktop-window]: /Users/jiahaoqian/proj/DSH-Desktop/src/main.ts:141
