# @just-genius/dsh-flow

Leader 规划、子 Agent 执行、流程图实时可调 —— 一个 DSH 插件。

主 Agent（Leader）只做规划：它把任务拆成一张 DAG，每个节点派给一个子 Agent 去跑，
然后根据子 Agent 的产出调整这张图。执行过程在右侧边栏独立的 **Flow** Tab 里以流程图
（React Flow）实时呈现，可与对话同时查看。

## 开关：默认关闭，用户显式开启

Flow 模式**默认是关的**。与 Debug 一样，从输入框命令菜单选择 `/flow` 即可开启，
同时打开侧边栏 Flow Tab；输入框显示可关闭的 **Flow chip**。

命令菜单显示本地化名称（中文为「流程」）和单色流程图标，chip 使用同一款单色图标；
Flow Tab 保留彩色图标。命令由客户端注册，带参数的输入通过插件接口执行，避免重复菜单项。

也支持直接输入（`/流程` 与 `/flow` 等效）：

```sh
/flow                 # 进入
/flow 修这个登录 bug  # 进入，并把后面的文字交给 Leader 当任务
/flow off             # 退出
```

`/flow` 是 slash command，整行都会被命令吃掉。后面跟着任务时，插件会把剩余文字再
`steer` 成一条用户消息（和 `/debug <说明>` 一样）；否则看起来就是「发了没反应」。

点击 Flow chip 关闭模式，或输入 `/flow off`。右侧边栏的新建 Tab 页面也提供 Flow
入口；单独打开或关闭流程图 Tab 不改变模式。

关闭期间不注入 Leader 提示词，Flow 规划工具拒绝执行，其他工具不受限制。

开启后 Leader 只能调用 `flow_plan`、`flow_status`、`flow_next`、`flow_patch`、`flow_confirm`。
执行守卫拒绝其他工具调用，包括读取、搜索和执行类工具；所有任务都交给子 Agent。
规划前先向用户澄清子任务划分标准，一般按任务所需材料的内容分类。

PTC / code 模式下，这五个工具通过 `run_code` 内的 SDK 调用。Flow 放行 `run_code`
调用入口，内部的每次工具调用仍受同一条 Leader 白名单约束。

退出时会自动取消所有在跑的子 Agent —— 没有 Leader 看结果的孩子不该继续跑。

## 工作方式

`/flow` 之后：

```
Leader（当前会话的 Agent）
  │ 仅可执行五个 Flow 规划工具
  │ 调查、读取、修改和验证都交给子 Agent
  ▼
Host 编排器
  │ 只派发当前就绪的下一步（默认并发 1）→ 等该子 Agent settle → 唤醒 Leader
  ▼
子 Agent（每个节点一个，独立 session）
  │ 简报自带上游结果；任务太大时可 flow_expand 拆子节点，跑完再 settle
  ▼
Leader 验收
  │ flow_status 看产出 → 通过则 flow_next；失败则 flow_patch
  ▼
Flow 标签页（sidebar.right.pane.tab）
    节点着色 = 状态，边 = 依赖，点开看简报/产出/失败原因
```

关键循环：**Leader 规划并逐步验收，Host 只在被要求时派发下一步，画布只做查看与局部干预。**

`flow_plan` **不会**一次把所有独立节点铺开。默认并发是 1：先跑第一个就绪步骤，跑完叫醒 Leader。Leader 检查结果后调用 `flow_next` 才开始下一步。

**人工确认是按需的**，不是每一步都停：
- Leader 或子代理调用 `flow_confirm`（带一句问题）
- 或规划时给节点标 `confirm: true`（该节点结束后暂停）
- 此时画布才出现「通过并继续」；你也可以在对话里回答，再由 Leader `flow_next`

节点 settle 之后：
- 通过 → `flow_next`
- 失败 → `flow_patch`：
  - `retry` —— 带着改写后的 prompt 重跑（旧 run 已 settle，新 run 天然干净）
  - `skip` —— 标记跳过；下一步仍要 `flow_next`
  - `add` —— 插入补救步骤（比如失败后加一步"定位根因"）
  - `cancel` / `remove` —— 停掉或删掉

失败的节点**不会自动重试**：重试什么、怎么改 prompt，是 Leader 的判断，不是编排器的默认行为。

### 中途切换

模式在对话进行中切换时，已经发给模型的那段提示词改不了，所以切换会被暂存在
`agent/pre-step` 边界提交 —— 也就是"下一步生效"，跟 `/debug` 的行为一致。
在切换生效前反悔（比如 `/flow` 之后马上 `/flow off`），暂存的切换会直接取消。

## 安装

```sh
pnpm install
pnpm build
dsh plugin --profile web add ./plugins/dsh-flow
```

因为 package 声明了 `dsh.bundle.patch`，安装会自动写入 bundle 层；
**重启 DSH web**（刷新页面不够）。

卸载：

```sh
dsh plugin --profile web remove @just-genius/dsh-flow
```

## 工具

| 工具 | 作用 |
|---|---|
| `flow_plan` | 提交整张 DAG，并只启动第一个就绪步骤。立刻返回。 |
| `flow_status` | 读图：状态 + 已完成节点的完整产出（可选 `nodeId` 只看一个节点）。 |
| `flow_next` | 验收通过后，启动下一个就绪步骤。Host 不会自动往下走。 |
| `flow_expand` | 运行中的子代理把自己的节点拆成子任务。 |
| `flow_report` | 运行中的子代理上报关键进展。 |
| `flow_confirm` | 按需请求人工确认。Leader 或运行中的子代理可调用；调用后停手。 |
| `flow_patch` | 改图：`retry` / `skip` / `cancel` / `add` / `remove`。 |

Leader 的五个规划工具要求 Flow 模式已开启；子代理的工具按其正在执行的节点校验权限。
退出 Flow 模式会取消所有在跑的子 Agent 并丢弃计划。

`flow_plan` 会在派发前校验：重复 id、悬空依赖、自依赖、环 —— 任何一项都会带着具体原因
被拒，而不是跑一半才崩。

## 界面

- **Flow 侧栏 Tab**：使用右侧边栏的独立标签页，不占用 Chat / 轨迹视图切换。
  节点按拓扑深度分列，状态用颜色区分，边跟随上游节点状态（运行中会流动）。
- **模式选择与 chip**：命令菜单选择 `/flow` 或直接输入命令开启，输入框显示 Flow chip；
  点击 chip 退出，并取消当前执行中的子 Agent。chip 和画布共享当前会话的状态轮询。
- **点节点**：详情显示完整任务简报、产出摘要、失败原因、子 Agent session id，
  以及「重试 / 跳过 / 暂停 / 继续 / 停止」。只有请求了人工确认时，顶部才会出现确认条。
  侧栏较窄时详情放在流程图下方，展开侧栏后可并排查看。
- **卡片上的悬浮按钮**：鼠标移到节点卡上，**右下角**浮出图标按钮 —— **跳过**（浅蓝，
  ⏭）、**暂停 / 继续**（白，⏸ / ▶）、**停止**（红，■）。颜色跟着动作走，不跟着位置走。
  纯图标按钮靠 `aria-label` 和 `title` 给出名称，所以悬停仍有文字提示。
  - 执行中：暂停、停止。不给「跳过」，跳过一个在跑的子代理只是换个说法的停止。
  - 已暂停：跳过、继续。
  - 等待中 / 就绪：跳过（就绪还能停止，它可能马上就被派发）。
  - 已完成、已跳过、失败：不出按钮。失败节点归 Leader 用 `flow_patch` 重试，
    因为重跑要改 prompt，是判断，不是点击。
- **暂停 vs 停止**：暂停停掉这个子代理并把节点标为「已暂停」—— 不是失败，流程仍在
  进行，下游继续等它；再点「继续」带着同一份简报重新派发（和重试一样是新 run）。
  停止把它标为失败，交给 Leader 处理。
- **降级提示**：拿不到 subagent service 时，图照常显示，但顶部会说明不会派发。

## 设计说明

**为什么不监听 `subagent/end` 事件？**
那个事件是按 delegating parent 的作用域分发的，插件级 listener 未必收得到。编排器改为
自己握着 `subagents.start()` 返回的 `run.result` Promise —— 它无论如何都会 settle，
是唯一可靠的状态来源。

**为什么每个节点 settle 都要叫醒 Leader？**
下一步不会自动开始。Leader 必须看完产出再 `flow_next`（或 `flow_patch`）。默认同
时只跑一步，所以一轮用户任务会按「规划 → 步骤 1 验收 → 步骤 2 验收 → … → 总结」
推进，而不是一次并行铺开再最后汇总。

**`flow_status` 会不会截断？**
会，但是给画布和给模型是两套上限。Host 会保存每个子 Agent 的完整产出（安全上限
20 万字符）。画布摘要约 2000 字；`flow_status` 整图每个节点约 1.2 万、整份约 4.8 万；
带 `nodeId` 时单节点约 8 万。需要全文时对那个节点再调一次 `flow_status`。

**为什么画布不做拖拽改拓扑？**
拓扑的所有权在 Leader。两套编辑入口会互相打架，而 Leader 改图还能带上推理（为什么失败、
为什么改 prompt）。画布只保留不争抢所有权的局部操作。

**为什么卡片上没有「重试」？**
重试要改写 prompt —— 那是 Leader 的判断，不是一个点击能代替的。卡片只做用户自己能
负责的三个动作：跳过（放弃这步）、暂停 / 继续（什么时候让这个子代理跑）、停止（放弃并
记为失败）。

**为什么暂停不是真的挂起？**
子 Agent 用一次性 run，没有中途挂起的能力。暂停是「停掉这个子代理，但节点不失败」：
流程仍在进行，下游继续等，点继续时用同一份简报重新派发。想要真正的断点续跑需要
continuable 子代理，那是另一套生命周期。

**状态存在哪？**
Host 进程内存。插件卸载或进程重启即丢失 —— 图是"这一轮任务的形状"，不是长期资产。
需要跨重启保留时再引入 `storageDomain`。

## 开发

```sh
pnpm --filter @just-genius/dsh-flow build      # 构建两个半身
pnpm --filter @just-genius/dsh-flow typecheck  # 类型检查
pnpm --filter @just-genius/dsh-flow test       # 调度代数单测
pnpm --filter @just-genius/dsh-flow watch      # watch 模式
```

### 源码结构

| 文件 | 职责 |
|---|---|
| `src/shared.ts` | Host/Client 共享的 wire 词汇（必须是无损 JSON） |
| `src/types.ts` | Host-only 运行态（live Agent、`SubagentRun`、AbortController） |
| `src/mode.ts` | 会话级模式状态机：暂存 / 提交 / 取消切换（有单测） |
| `src/graph.ts` | 纯函数：校验、环检测、ready 集、拓扑分层（有单测） |
| `src/orchestrator.ts` | 派发、结算、重调度、按波唤醒 |
| `src/wake-policy.ts` | 何时唤醒 Leader（有单测） |
| `src/policy.ts` | Leader 契约文案（仅在模式开启时注入） |
| `src/tools.ts` | `flow_plan` / `status` / `next` / `patch` / `clear` |
| `src/index.ts` | Host apply：注册工具 / 路由 / `/flow` 命令 / 工具守卫 |
| `src/client/` | React Flow 画布 + 节点卡 + 布局 + 轮询 |

### 一处构建约定

React Flow 的 `style.css` 不能在运行时 `require` —— 本仓库的 client 模块表只接受
React、React DOM 和声明过的 DSH client injection。构建时把它内联成一个带
`data-plugin-css` 标签的 `<style>`，和 `dshCssModules` 处理 `*.module.css` 的方式一致，
HMR receiver 也会同样清理它。见 `tsdown.client.config.ts`。

## 已知边界（原型）

- 图状态不持久化（见上）。
- 子 Agent 用一次性 run，不用 continuable —— 重试即新 run，没有追问/打断能力。
- 不支持画布拖拽改拓扑。
- 并发上限全局生效，不能按节点设。
