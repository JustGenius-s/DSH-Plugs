# workspace-plus 重构方案（面向 DSH 0.1.7）

日期：2026-09-23，Asia/Shanghai。
对象：`plugins/dsh-workspace-plus`（当前在 `~/.dsh/profiles/web/cordis.patch.yml` 中被 `disabled: true` 停用）。
目标：**只在官方 UI 上加内容，不改官方行为**；把「置顶区」做成项目与会话都能置顶的独立区域。

## 0. 一句话结论

官方 0.1.7 把 workspace-plus 当年的两大支柱都吸收进了内核（**会话置顶**、**行菜单 slot**），
同时补上了我们当年缺的扩展点（`data-slot` 锚点、`data-row-key` 行标识、两个 directoryFlow hole）。
因此重构的正确形态是：**删掉全部「和官方抢活」的补丁，只保留官方没有的四件事**——
置顶区、行菜单增强、多文件夹绑定、会话导出。

## 1. 已核实的事实（本机一手源码 + 真实 DOM）

### 1.1 官方 0.1.7 已内置的能力

| 能力 | 证据 | 结论 |
| --- | --- | --- |
| 会话置顶 | `UiWorkspace.pinSession/unpinSession`；`WorkspaceSnapshot.pinnedSessionIds`；持久化在 `~/.dsh/storages/workspace.json` 的 `global.pinnedSessionIds`（本机当前 1 条） | **插件不再自持会话置顶** |
| 会话菜单行 | slot `sidebar.workspaces.session.menu.item`，官方注册 `pin`(100)/`rename`(200)/`fork`(300)/`archive`(400) | 插件只补官方缺的行 |
| 会话行悬停按钮 | slot `sidebar.workspaces.session.row.action`，官方注册 `archive`(100)/`pin`(200) | 同上 |
| 目录选择 | single hole `sidebar.workspaces.directoryFlow` / `conversation.hero.workspace.directoryFlow`；空 hole ⇒ 官方自动隐藏「添加工作区」入口 | 取代原来的 `patchPickDirectory` 猴补 |
| 归档过滤视图 | `stores.ts` 的 `archivedFilter`（default/show/only） | 插件不必再做归档视图 |

### 1.2 官方仍然没有的能力（= 我们要做的）

| 缺口 | 证据 | 我们的做法 |
| --- | --- | --- |
| **置顶区** | `sidebar.workspaces` 是 single slot；侧栏只有 `brand.mark/brand.name/toggle.badge/panellist/workspaces/settings/footer.action`，**`workspaces` 之上没有任何洞** | 见 §2：锚定「官方浏览器容器之外、`regionArea` 之内」 |
| **项目（工作区）行额外菜单** | `ProjectRowItem` 里 `rename`/`delete` 是硬编码数组，无 slot | DOM 增强，按 `data-row-key="workspace:<id>"` 定位 |
| **多文件夹工作区** | 官方 `WorkspaceView` 仍是单 `path`，会话归属要求 canonical cwd 相等 | 保留现有 binding 存储 + 提示词 |
| **会话导出 Markdown** | 官方无 | 原样保留（与侧栏无关的纯 Host 能力） |

### 1.3 关键锚点：`data-slot` 与 `data-row-key`

真实 DOM（本机 1280×720，官方侧栏）实测：

```
div.hHd-Xa_root            ← 侧栏根（flex column）
├─ div.hHd-Xa_logoRow      (h 60)
├─ div.hHd-Xa_newSession   (h 38)
├─ div.hHd-Xa_panelList    (h 36)
├─ div.hHd-Xa_regionArea   ← flex:1, flex-direction:column, overflow:hidden   ★ 我们的挂载点
│  └─ div[data-slot="sidebar.workspaces"]  ← display:contents，官方浏览器（其子节点才是 bhn1Oq_root）
└─ div.hHd-Xa_footArea     (h 50)
```

- 官方**每一个渲染位点**都带 `data-slot="<slotKey>"`（本机共 41 处），是稳定标识。
- 官方行带 `data-row-key`：`workspace:<id>` / `session:<id>` / `overflow:<id>` / `empty`。
- 官方 CSS class 全是哈希（`YDXeBa_sessionRow`、`bhn1Oq_root`），**不可依赖**；`data-slot`/`data-row-key` 才是契约。
- 行内结构：会话行 `[slot 状态点][title][time][rowActions]`；项目行 `[folder][chevron][projectText][rowActions]`；
  `rowActions` 内含 `[官方 hover 按钮…] + div[data-slot="session.row.action"]`。

## 2. 置顶区方案（C：独立浮层，不接管官方 slot）

**挂载点**：`regionArea`（`.hHd-Xa_regionArea`，即 `[data-slot="sidebar.workspaces"]` 的父节点），
把置顶区作为它的**第一个子元素**插入，官方 slot 容器保持原位。

为什么这样最干净：

1. `regionArea` 是 `flex-direction: column` + `flex: 1` + `overflow: hidden`，
   置顶区作为首个 flex 子项 ⇒ 天然位于官方列表上方，官方列表自动下移。
2. **不接管任何 slot**（不用 `priority` 遮蔽官方 `WorkspaceBrowser`），官方搜索/分组/tree/拖动/归档/空会话/a11y/动画全部原样保留。
3. `regionArea` 自己有 `overflow: hidden`，置顶区**不在官方滚动容器内**，不会跟着会话列表滚走。
4. 置顶区是一块**独立列表**，不参与官方排序账本 ⇒ 不可能和官方排序打架（这正是旧版置顶翻车的根因）。
5. 退出/停用插件时只需移除这一个 DOM 节点，官方结构零残留。

**显示条件**：`wide === true`（折叠成 rail 时不显示）；折叠态由 `[data-sidebar-collapsed]` 或 `.hHd-Xa_collapsed` 判定。

**内容**（按用户选择）：

- 项目置顶：置顶区里的**快捷入口**（点击 `uiWorkspace.openWorkspace(id)`）。**官方列表里的原位置不动**，不调 `insertBefore`。
- 会话置顶：**复用官方 `pinnedSessionIds`**，跨工作区聚合展示（官方只在各自 group 内置顶；置顶区把它们聚到一处）。
  会话行显示 `工作区名：会话标题`，点击 `uiWorkspace.openSession(id)`。
- 数据源统一走官方 `workspaces.list.getSnapshot()`，不再新造 localStorage 排序账本。

**持久化**：项目置顶继续由插件 Host 侧存 `~/.dsh/workspace-plus/pins.json`（官方没有工作区置顶）；
会话置顶**不再写入** pins.json，改为读写官方 `pinnedSessionIds`（复用即不重复造）。

## 3. 行菜单增强方案

| 行 | 通道 | 保留的菜单项 |
| --- | --- | --- |
| 会话行 | **官方 slot** `session.menu.item` + `session.row.action`，用 `order` 排在官方之后 | 标记未读/已读、导出 Markdown、打开所在目录（重命名/归档/分叉/置顶官方已有，不再重复注册） |
| 项目行 | DOM 增强（官方无 slot），按 `data-row-key="workspace:<id>"` 定位 | 置顶/取消置顶、在 Finder 打开、复制路径、新建会话、（+ 编辑多文件夹绑定） |

移除：
- `rows.ts` 的 React fiber 扫描 → 换成 `data-row-key` 解析（纯函数，可测）。
- `patchPickDirectory` / `patchCreate` 猴补 → 换成 `directoryFlow` hole 占位。
- 冷会话标题补齐（`session-title-repair.ts`）、会话复活修复（runtime `session-revival.ts`）→ **本次删除**，需在 0.1.7 上重新验证是否仍需要（用户已确认不保留）。

## 4. 文件级改动清单

### 新增
| 文件 | 职责 |
| --- | --- |
| `src/client/anchor.ts` | 纯函数：从 `data-row-key`/`data-slot`/`aria-label` 解析行身份、槽位与浏览树；无 DOM 副作用，可单测 |
| `src/client/sidebar-host.ts` | 定位挂载点（滚动容器）与挂载生命周期 |
| `src/client/PinnedPanel.tsx` | 置顶区 UI（项目 + 会话聚合），portal 到 `regionArea` 首位 |
| `test/anchor.test.js` | `data-row-key` / `data-slot` 解析的包级函数测试 |
| `test/pinned-panel.test.js` | 置顶区数据装配（纯函数）测试 |

### 重写
| 文件 | 变化 |
| --- | --- |
| `src/client/index.tsx` | 去掉两个猴补；改为注册 `directoryFlow` hole + 官方 menu slot 条目 + 挂载置顶区 |
| `src/client/rows.ts` | fiber 扫描 → `data-row-key` 解析 |
| `src/client/RowMenuOverlay.tsx` | 只负责**项目行** DOM 菜单；会话菜单交给官方 slot |
| `src/client/features.ts` | 特性开关按新集合收敛 |
| `src/client/PinnedSection.tsx` | 由「改官方 tree 顺序」改为「独立置顶区」→ 内容并入 `PinnedPanel.tsx` 后删除 |

### 删除
`src/client/session-title-repair.ts`、`packages/runtime/src/session-revival.ts` 及其测试、`src/client/pins.ts` 中依赖旧排序账本的部分、
`PinnedSection.module.css` 中改写官方 tree 的规则（`order`/`data-workspace-plus-pin-layout`）。

### 不变
`src/index.ts`（Host 路由 + 提示词）、`src/store.ts`、`src/scan.ts`、`src/open-path.ts`、
`src/workspace-prompt.ts`、`src/session-export*.ts`、`src/request-auth.ts` 全部保留。

## 5. 验收

1. `pnpm --filter @just-genius/dsh-workspace-plus test`（当前基线 188/188 通过）
2. `typecheck` + `build` + `pnpm check:client-modules`
3. 实机：在 `cordis.patch.yml` 把 `dsh-workspace-plus` 改回 `disabled: false`，重启 web，
   验证置顶区出现在侧栏列表上方、项目/会话来去自如、官方列表功能无回归。
4. 确认 `data-pins.json` 里的旧会话置顶能迁移到官方 `pinnedSessionIds`（一次性）。

---

## 6. 实施结果（2026-09-23 完成）

按本方案落地，并通过实机验收。

### 代码

| 项 | 结果 |
| --- | --- |
| 新增 | `anchor.ts`（`data-row-key`/`data-slot` 纯函数解析）、`sidebar-host.ts`（置顶区挂载/卸载）、`pinned-model.ts`（置顶区数据装配）、`PinnedPanel.tsx`、`workspace-menu.ts`（官方项目菜单监听）、`WorkspaceMenuRows.tsx`、`SessionMenuExtra.tsx`（官方会话菜单 slot 条目）、`toast.ts` |
| 重写 | `index.tsx`（去掉两个猴补）、`actions.ts`、`features.ts`、`locales.ts`、`MenuSettingsItem.tsx`、`pin-state.ts`、`pin-store.ts`、`pin-persistence.ts` |
| 删除 | fiber 扫描 `rows.ts`、`pins.ts`、`PinnedSection.*`、`RowMenu*.tsx`、`WorkspaceRowChrome.*`、`session-commands.ts` 的旧动作面、`session-title-repair.ts`、`session-titles.ts`、`session-reference.ts`、`session-pins.ts`、runtime 的 `session-revival.ts` 及其测试 |
| 保留不动 | `scan.ts`、`store.ts`、`open-path.ts`、`workspace-prompt.ts`、`request-auth.ts`、`session-export*.ts` |
| 共享层 | `packages/ui` 透出官方 `MenuItemButton`；新增 `IconPinFill16`（用官方 pin 图形，视觉一致）；runtime 移除 `session-revival` 导出 |

### 验证

| 验证 | 结果 |
| --- | --- |
| `pnpm --filter @just-genius/dsh-workspace-plus test` | 121/121 通过（原 188 项中，删掉模块的测试一并移除，新增 `anchor`/`pinned-model`/`workspace-menu` 测试） |
| `typecheck` | 通过 |
| `build` | 通过（client 412 kB） |
| `check-client-modules` | 通过（client 只 require 种子模块） |
| `check-dependency-contracts` | 通过 |
| runtime 测试 | 20/20 通过 |

### 实机验收（真实 DSH GUI，1280×720）

- 置顶区出现在侧栏浏览区顶部：`hHd-Xa_regionArea` 的第一个子节点，官方浏览器节点原位不动，24 个官方行全部健在。
- 置顶区渲染 9 行（1 个项目 + 8 个会话），会话显示 `工作区名 · 标题`，每行有「取消置顶」。
- 官方项目行菜单：`重命名 / 删除工作区` + 插件 5 项（`置顶项目 / 编辑多文件夹… / 在资源管理器中打开 / 复制路径 / 新建会话`），以官方行样式渲染。
- 官方会话行菜单：`置顶会话 / 重命名 / 分叉会话 / 归档会话` + 插件 3 项（`标记为未读 / 导出为 Markdown / 打开所在目录`）。
- 刷新页面后置顶区正常重挂，**只有 1 个挂载容器**，无重复。
- 控制台无本插件报错（仅浏览器 `ERR_NETWORK_CHANGED` 噪声，来自重启后的连接重试）。
- **会话置顶迁移**：`pins.json` 已转为 v3（只剩 1 条工作区置顶，无遗留会话行），官方 `pinnedSessionIds` 从 1 条变为 8 条（7 条迁移 + 1 条原有），与备份文件核对**无丢失**。

### 与方案的偏差

1. **项目行菜单改为「注入官方菜单」**（用户指定「需要复用官方的菜单；往里加」）。
   实测官方菜单是 portaled `div[role="menu"]`、无 aria 关联，但其 `pointerdown`(0ms) 早于菜单出现(~3ms)，
   可在 capture 阶段记录行身份；注入的行用官方 `MenuItemButton`，因此共享官方键盘遍历。
2. **保留了置顶区的等待状态点**（`pending.ts`）。原计划随「删除 0.1.5 补丁」一并移除，
   但置顶区把会话搬出了它原本的工作区分组，若不显示「等你处理」会与官方侧栏不一致，故保留并接入。
3. **删除范围扩大到会话标题补齐的整条链路**：`session-title-repair.ts` 之外，
   Host 侧 `/dsh-workspace-plus/session-titles` 路由与 `session-titles.ts`/`session-reference.ts`
   也已无消费者，一并移除（避免留死路由）。

---

## 7. 复查调整（2026-09-23 第二轮）

按用户复查意见调整置顶区形态。

### 三项调整

| 要求 | 做法 |
| --- | --- |
| 放到工作区 header 下面 | 挂载点从「`sidebar.workspaces` 的父节点首位」改为「浏览列表**滚动容器的第一个子节点**」 |
| 正常可以滚动 | 该容器本身就是官方滚动容器（`overflow-y:auto`），面板在其中自然跟随滚动 |
| 可以折叠 | 标题行改成 `aria-expanded` 按钮，折叠时只剩一行 + 条目数；状态按浏览器持久化 |
| （用户补充）不吃工作区排序也行 | 已核实**不吃**：官方拖拽排序按 id 计算，不依赖子元素索引 |

### 官方结构（实测）

```
div.<hash>_root                      flex column
├─ div.<hash>_sectionHeader          「工作区」标题 36px，不滚动
└─ div.<hash>_listArea               flex:1
   └─ div.<hash>_treeBody            flex:1
      └─ div.<hash>_list             ← 真正的滚动容器 overflow-y:auto
         └─ div[role="tree"][aria-label="会话"]   ← 浏览列表
```

滚动容器实测 `scrollHeight 1209 / clientHeight 458`，是唯一的滚动层。

### 本轮修掉的一个真 bug（实测发现）

搜索激活时官方把 `role="tree"` 整个换成**另一棵树**（`aria-label="搜索结果"`，class `searchTree`），
且随每次按键重建。我用 DOM 探针验证：插进去的节点**被 React 直接抹掉**。

因此挂载判据不能是「页面上的第一个 `role=tree`」，必须是「**浏览树**」——
按 `aria-label` 白名单（`会话` / `Sessions`）匹配，未知的树一律不接管。
实测：浏览态有面板 → 搜索态面板消失 → 清空搜索后面板自动回来。

### 验收

| 项 | 结果 |
| --- | --- |
| 面板位于 header 下方 | header bottom 202 → panel top 206 |
| 面板是滚动容器首子节点 | `bhn1Oq_list.firstElementChild === panel` |
| 跟随滚动 | `scrollTop 0→150`，面板 `top 206→56`（位移 150，一致） |
| 折叠 | 高 307 → 35，行隐藏，显示计数 9 |
| 折叠持久化 | localStorage `pinsCollapsed: true`，刷新后仍折叠 |
| 搜索态 | 浏览态显示 → 搜索态隐藏 → 清空后恢复 |
| 官方列表 | 24 行完好 |
| 测试 | 139/139 通过（新增 `features` 测试与浏览树识别测试） |
| 门禁 | typecheck / build / check-client-modules / check-dependency-contracts 全绿 |

---

## 8. 多文件夹工作区回归修复（2026-09-23 第三轮）

用户反馈「多仓工作区项目的功能没加上或者没适配」—— **属实，是我的疏漏。**

### 根因

第二轮重写时我删掉了 `patchPickDirectory` + `patchCreate` 两个猴补，
**但没有用官方 `directoryFlow` hole 补回来**。后果：

- 「添加工作区」直接走官方**单目录**选择器，多文件夹工作区**根本创建不出来**；
- `askCreateBinding()` 成了死代码（无调用方）；
- 「编辑多文件夹…」调了 `askEditBinding()`，但对话框的 `shell.overlay` 挂载也被我
  替换成了 hole 注册，**没有任何东西渲染它** → 菜单点了没反应。

「添加工作区」仍然"能用"，只是静默退化成单目录 —— 这正是这类回归最难发现的地方。

### 修复

占官方两个 `directoryFlow` hole（`single` slot），priority `-10` 低于官方 picker 后端的默认 0，
因此拿到该 cell：

| 项 | 做法 |
| --- | --- |
| 官方保留 | 「添加工作区」入口仅在 hole 被占用时出现；owner 仍负责 busy 态、可重试错误对话框、「重新选择」 |
| 插件新增 | `open` → 拿到路径之间的交互：可放多个文件夹并指定主仓 |
| 对话框 | 只在 `shell.overlay` 挂**一份**，hole 与项目行菜单两个入口共用（同一个 `flow.ts` 单请求 store） |
| 采用 | 仍是 owner 的 `createWorkspace({ path })`；插件用幂等的 `workspaces.create` 落绑定，不需要轮询或猴补 |
| 真实选择器 | 对齐官方 native picker：优先 `globalThis.__DSH_DIRECTORY_PICKER__`，退回 `uiWorkspace.pickDirectory()` |

### 顺带修掉的两个真 bug

1. **绑定残留**（端到端实测发现）：用官方「删除工作区」删掉行后，插件的绑定仍在
   `bindings.json` 里；重新添加同一目录会静默把旧的多文件夹配置带回来。
   修法：新增 `prune` 动作 + `pruneBindings()`，客户端在拿到**非空**工作区快照后对账清理。
   **空列表一律不清理** —— 空快照是"尚未连接"，不是"全部已删除"，否则任何重连竞态都会清空用户数据。
2. **realpath 比较不对称**：`pruneBindings` 只对 live 路径做 realpath，却与未 realpath 的
   存储路径比较。macOS 上 `/var` vs `/private/var` 会被当成两个目录，
   **把仍然存活的工作区绑定删掉**。修法：两侧都 realpath。

这两个 bug 都是我自己写的测试先失败暴露出来的（第一个先表现为测试挂起，是我测试里
`resolve.code = x` 写错——赋值到 resolve 函数上而不是 settle promise；修好测试后才暴露出 realpath 问题）。

### 验收

| 项 | 结果 |
| --- | --- |
| 「添加工作区」弹插件多文件夹窗口 | 是（`添加文件夹` / `打开工作区`，不再是官方单目录） |
| 「编辑多文件夹…」预填已有绑定 | 是（lingshan 的 3 个真实文件夹 + 主仓标记 + 保存） |
| 端到端创建多文件夹工作区 | 成功（绑定 2 个文件夹，官方工作区行建立且标题同步） |
| 取消路径 | 窗口关闭、入口仍在、无卡死 |
| 空 live 列表不清理 | 是（Host 与 client 双重拒绝） |
| 测试 | **151/151** 通过（新增 `directory-flow`、`binding-routes`、prune 相关测试） |
| 门禁 | typecheck / build / check-client-modules / check-dependency-contracts / runtime 20/20 全绿 |

### 遗留

`prune` 路由属 Host 侧代码，**只在 DSH 启动时加载**：运行中的服务仍是旧 Host half
（实测 `POST /dsh-workspace-plus/binding {action:'prune'}` 返回 `invalid binding action`）。
需要重启 DSH web 后才生效；客户端侧调用已就绪且做了降级（失败不影响其它功能）。

---

## 9. 置顶区形态第二轮调整（2026-09-23 第四轮）

用户提的两点，都已落地并实机验收。

### 1. 置顶项目要包含全部会话，而不是把置顶会话铺开

**改前**：置顶区把「被置顶的项目」和「被置顶的会话」并列平铺。会话被从它所属的项目里拎出来
单独一行，项目本身不可展开。用户的感受就是"置顶项目无法展开会话记录，而是单独铺开"。

**改后**：`pinned-model.ts` 的返回类型从 `PinnedRow[]` 变成一棵树 ——
`PinnedProjectRow.sessions` 携带**该工作区的全部可见会话**：

| 规则 | 说明 |
| --- | --- |
| 项目 = 分组 | 挂着它工作区的所有会话，不只是置顶的那几个 |
| 组内顺序 | 置顶的排最前（按官方 pin 顺序），其余按 `updatedAt` 倒序；时间相同用 id 兜底，避免两次渲染抖动 |
| 一个会话只出现一次 | 工作区被置顶时它只在该分组里；未被置顶的项目的置顶会话才单独成行 |
| 过滤一致 | 归档 / 空白(New Session) / 子代理会话都不显示，与官方侧栏一致 |
| 不截断 | 官方分组默认只显示前 5 个（其余要「展开」），置顶区不做这个截断 |

实测：PPlus 组显示**全部 15 个**会话（官方同一时刻只显示 5 个 + 「展开其余」）。

### 2. 折叠图标放右侧 + 两行样式与悬停按钮统一

| 项 | 做法 |
| --- | --- |
| 整体折叠 | 标题（左）与折叠箭头（右）拆成**两个独立按钮**，箭头用 `margin-left:auto` 靠右 |
| 项目折叠 | 折叠箭头作为**行内悬停按钮**，与「取消置顶」并排 —— 与会话行的按钮同一套渲染 |
| 行样式统一 | 项目行与会话行共用**同一个 `.row` 外壳**：同高 30px、同圆角 6px、同 hover 底色 |
| 悬停按钮统一 | 抽出 `<RowAction>` 单一组件；按钮条 `flex: 0 0 44px` **固定宽度**，所以一个按钮的行与两个按钮的行标题对齐一致 |
| 层级区分 | 只靠**字重**（父行 500 / 子行 400）与图标，不用行高或圆角 —— 那会让面板看起来像两个列表 |
| 计数位置 | 折叠后（整体或单个项目）才显示计数；展开的项目行因此和会话行完全一致 |

实测两者几何完全一致：`{h:30, radius:6px, actionsBasis:44px}`，`identicalGeometry: true`。

### 验收

| 项 | 结果 |
| --- | --- |
| 项目分组含全部会话 | 是（PPlus = 15 个，非 5 个） |
| 组内置顶优先 | 是（置顶会话置顶、标 `pinned`） |
| 会话不重复出现 | 是（`workspace:w1` 分组内已含，不再单独成行） |
| 项目级折叠 | 折叠后 0 行、`aria-expanded=false`、显示计数；展开恢复 15 行 |
| 整体折叠 | 高 35px、0 行、显示总数 25；展开恢复 25 行 |
| 折叠持久化 | localStorage `pinsCollapsed` + `collapsedProjects`，刷新保持 |
| 行几何一致 | 是（`identicalGeometry: true`） |
| 测试 | **159/159**（`pinned-model` 测试按树形重写，新增项目折叠状态测试） |
| 门禁 | typecheck / build / check-client-modules / check-dependency-contracts 全绿 |

### 测试先发现的一个真 bug

重写 `pinned-model` 时，重复的项目 pin id 会渲染**两个相同分组**（我用 Set 记录"已分组"，
但没有对 pin 列表本身去重）。新测试立刻暴露，已修。

---

## 10. 细节打磨（2026-09-23 第五轮）

用户提了四点，都已落地并实机验收。

### 1. 标题溢出时 hover 走马灯

对齐官方会话行的实现：同样的常量（溢出阈值 `8px`、速度 `0.03 px/ms`）、同样的
`scrollLeft` 机制、同样的边缘渐隐（`data-scrolled` / `data-clipped` → `mask-image`）。

| 行为 | 说明 |
| --- | --- |
| 进入 | 以**恒定速度**爬行到文本末端，然后停在指针下 |
| 移开 | **一步回到起点**，静止时的省略号恢复满强度 |
| 溢出 ≤ 8px | 不动 —— 只差几像素的移动读起来是抖动，不是"揭示" |
| `prefers-reduced-motion` | 直接跳到末端，不做动画 |

实测：`scrollLeft` 105 → 114 → 141 → 202 匀速推进；移开后回到 0 且 mask 清除。

### 2. 项目行不再有叉叉和常驻箭头

| 改前 | 改后 |
| --- | --- |
| 行右侧有「折叠置顶」+「取消置顶」两个按钮 | 右侧只有官方式样的 `…` 菜单 + 新建会话 |
| 常驻一个展开箭头 | **点行即展开/收起** |
| 文件夹图标固定不变 | **悬停时文件夹换成箭头**（与官方同构） |

与官方项目行的结构逐项对照后确认一致：两个独立的前置槽
（`folderSlot` 显示 / `chevronSlot` 隐藏），行高 34px。

顺带补上官方的一个细节：**项目包含当前会话时文件夹变主题色**，
实测色值与官方完全相同（`rgb(65,118,230)`）。

### 3、4. 项目行 / 会话行显示与官方一致的功能

行右侧改成官方那套：`…` 菜单 + 该行最主要的操作。

- **项目行**：`…` 菜单、新建会话。
- **会话行**：`…` 菜单、归档、取消置顶。

菜单条目由**一份清单**（`row-menu.ts`）产出，面板与注入官方菜单的那几项不会不一致。
面板里列出的都是已置顶项，所以置顶行显示「取消置顶 / 取消置顶会话」——
除这一处状态差异外，其余条目与官方菜单逐项相同。

新增的两个弹窗（重命名、删除工作区确认）走 `dialogs.ts` 的单请求 store，
挂在 `shell.overlay`，**不与请求它的行共享生命周期**：置顶行被取消置顶后会立刻卸载，
弹窗挂在行里会跟着消失。

### 三个只有实机才暴露的 bug

| bug | 症状 | 根因 |
| --- | --- | --- |
| 菜单点了没反应 | 弹窗永远不出现 | `getDialogs()` 返回**同一个被原地修改的对象**，`useSyncExternalStore` 认为快照没变，React 不重渲染 |
| 修完上一条后页面崩 | React #185「最大更新深度超限」 | 改成**每次返回新对象**，React 认为每次渲染都在变，无限循环 |
| 折叠箭头不出现 | 图标槽始终是文件夹 | 两条 `display` 规则同优先级互相覆盖 |

第二、三条都说明**快照标识必须"只在内容变化时换新对象"**：两个方向错了都是静默失败，
所以 `dialogs.ts` 缓存快照，只在 `emit()` 里替换。测试同时锁住两个方向。

### 验收

| 项 | 结果 |
| --- | --- |
| 走马灯匀速推进 + 移开归位 | 是（105→202，回 0 且 mask 清除） |
| 项目行无叉叉、无常驻箭头 | 是 |
| 点项目行即展/收 | 是（`aria-expanded` 切换，折叠后显示计数） |
| 悬停文件夹→箭头 | 是（与官方同为双槽 `display` 切换） |
| 项目行右侧 = 官方样式 | 是（`…` + 新建会话，16×16） |
| 项目菜单 = 官方 2 项 + 插件 5 项 | 是（实测 7 行） |
| 会话菜单 = 官方 3 项 + 插件 4 项 | 是（实测 7 行） |
| 菜单点击不误触发打开会话 | 是（`navigated: false`） |
| 新建会话按钮不误切换折叠 | 是（已展开仍保持展开） |
| 重命名 / 删除确认弹窗 | 是（预填标题、自动聚焦、Escape 可关） |
| 测试 | **177/177**（新增 row-menu 7 项、dialogs 7 项） |
| 门禁 | typecheck / build / 两个 contract 检查 / runtime 20/20 全绿 |

---

## 11. 菜单图标对齐（2026-09-23 第六轮）

用户指出：新增的菜单行没有图标，而官方那两行（重命名 / 删除工作区）有，视觉上不齐。

### 做法

清单里存**图标名字**（`RowIcon` 字符串联合），不存组件 —— 这样 `row-menu.ts` 仍是纯数据、
可在 Node 里测试（导入图标组件会把样式表带进来，Node 加载不了）。
名字 → 字形的映射集中在 `menu-icons.tsx`，两个菜单（面板自己的、注入官方菜单的）共用同一份。

图标**语义优先对齐官方**，同义行用同一个字形：

| 动作 | 图标 | 来源 |
| --- | --- | --- |
| 重命名 / 重命名会话 | 铅笔 | 官方同款 |
| 删除工作区 | 垃圾桶（**红色** + danger 悬停底色） | 官方同款 |
| 归档会话 | 归档盒 | 官方同款 |
| 分叉会话 | 分支 | 官方同款 |
| 取消置顶 / 置顶 | 实心图钉 / 空心图钉 | 官方同款，随状态切换 |
| 编辑多文件夹 | 双滑杆 | 新增 |
| 在资源管理器中打开 | 右上箭头 | 复用 |
| 复制路径 | 复制 | 复用 |
| 新建会话 | 新会话 | 官方同款 |
| 标记未读 / 已读 | 圆点 / 圆圈对勾 | 新增，随状态切换 |

顺带修掉一个之前漏掉的差异：面板自己画的菜单**没有给「删除工作区」传 `danger`**，
所以它不像官方那样是红色。已对齐（实测 `rgb(236,19,19)`，与官方同色）。

### 尺寸对齐（实测，不是估的）

对着官方实际渲染的 DOM 量了一遍，发现两处我原本估错了：

| 位置 | 官方 | 我（改前） | 我（改后） |
| --- | --- | --- | --- |
| 项目行 `…` 按钮 | 16 | 14 | **16** |
| 项目行 新建会话 | 16 | 14 | **16** |
| 会话行 `…` 按钮 | 16 | 14 | **16** |
| 会话行 归档 / 置顶 | 14 | 14 | 14 |

官方项目行的 `…` 和新建会话都**不传 size**（用字形默认值 16），而会话行的归档 / 置顶**显式传 14** ——
同一行里两种尺寸并存，照着量才不会猜错。

另外把归档图标从 20 网格（viewBox `0 0 20 20`）换成官方那枚 16 网格（viewBox `0 0 16 16`）的素材，
否则同样渲染成 14px 时笔画粗细与官方不一致。现在所有图标的 viewBox 统一是 `0 0 16 16`。

### 验收

| 项 | 结果 |
| --- | --- |
| 项目菜单 7 行都有图标 | 是（图标盒 16×16，字形 14） |
| 会话菜单 7 行都有图标 | 是 |
| 标签左边缘对齐 | 是（7 行唯一值 **51px**） |
| 删除工作区为红色 | 是（`rgb(236,19,19)`，与官方同色） |
| 行内按钮尺寸 = 官方 | 是（逐项实测一致） |
| 图标 viewBox 统一 | 是（全部 `0 0 16 16`） |
| 测试 | **182/182**（新增图标契约 5 项） |
| 门禁 | typecheck / build / 两个 contract 检查 / runtime 20/20 全绿 |

新增的图标契约测试会检查**清单里声明的每个图标名在渲染层都有对应 case** ——
漏一个不会报错，只会静默渲染成空槽，让那一行的文字错位，所以值得单独锁住。

---

## 12. 图标全部改用官方 + 修hover消失（2026-09-23 第七轮）

### 1. 图标一律用官方的

用户要求：**图标换成官方的**。做法上不是把官方素材抄进我们自己的图标集，而是**直接转发官方组件**：

```ts
export {
  IconArchiveOutlineRegular as OfficialArchiveIcon,
  IconPinFillRegular        as OfficialPinFillIcon,
  ...
} from '@deepseek-ai/dsh-client-ui-primitives'
```

抄一份形状的坏处是**会漂移** —— 官方哪天改了图标，我们那份不会跟着变，于是两个表面又长得不一样了，
而"长得一样"正是这件事的全部目的。

于是 `packages/ui/src/icons/index.tsx` 相对基线**只多了一个图标**：
`IconDotSolid16`（未读标记）。官方图标集里没有任何 dot / badge / unread 变体（按名字搜过全部官方包），
而未读标记是本插件自己的概念，不是主机某个图标的换皮，所以没有可转发的对象。

### 关键坑：裸名只在 .d.ts 里，运行时不导出

官方图标导出成三件套：

| 名字 | 运行时是否存在 |
| --- | --- |
| `IconWorkspaceTreeOutlineArtwork` | 是 |
| `IconWorkspaceTreeOutlineRegular` | **是（1px 描边）** |
| `IconWorkspaceTreeOutlineMedium` | 是（1.3px 描边） |
| `IconWorkspaceTreeOutline`（裸名） | **否** —— 只存在于 `.d.ts` |

导裸名**类型检查能过**，运行时却拿到 `undefined`，React 报的是
「Element type is invalid」（#130），而不是"找不到导入"。我第一版就这么写的，
页面直接崩了，是浏览器控制台把这个揪出来的。现在统一用 `Regular`（描边与库里其他图标一致）。

### 2. hover 到菜单上就消失

用户报的 bug，实测**能稳定复现**：

菜单浮层开在行**下方 4px**，这 4px 既不属于触发按钮也不属于菜单，是行自己的 padding。
共享 `Menu` 支持"指针离开锚点 200ms 后关闭"，本来是给那种间隙留出穿越时间的，但这里被两件事打败：

| 原因 | 说明 |
| --- | --- |
| `pointerleave` 按**触发按钮**的盒子判定 | 按钮只有 16px 高、行却有 34px，指针还没走到间隙，大部分行区域就已经算"出去了" |
| 手可以**在间隙里停顿** | 读数、或者单纯不着急，停超过 200ms 就关了 |

实测数据：快速穿过间隙 → 菜单存活；**在间隙里停 300ms → 关闭**。

修法不是把宽限期调大（那只是把窗口放宽），而是**换掉这个关闭语义**：
面板的菜单是**点击**打开的，指针离开本来就不该关它。现在改为**点击外部 / Escape / 选中项**关闭
（即共享 `Menu` 的默认行为），时间竞态直接消失。

另外行在菜单打开期间会给自己打标记（`data-workspace-plus-menu-open`），
这与官方的 `menuOpen` 对应，让按钮条保持布局、行保持高亮，用户始终知道打开的菜单属于哪一行。

### 验收

| 项 | 结果 |
| --- | --- |
| 项目菜单 7 行图标 | 全部官方组件，14px |
| 会话菜单 7 行图标 | 全部官方组件，14px |
| 行内按钮尺寸 vs 官方 | 16 / 16 / 14 逐项一致，viewBox 全部 `0 0 16 16` |
| 间隙停留 650ms | **保持打开**（修复前 300ms 即关闭） |
| 慢速走完整个菜单 | 10/10、11/11 全部存活 |
| Escape 关闭 | 是 |
| 点击外部关闭 | 是 |
| 再点触发按钮关闭（真 toggle） | 是 |
| 选中菜单项关闭并执行 | 是 |
| 关闭后标记清除 | 是（`hasAttr: false`，按钮条 `display: none`） |
| 嵌套会话行不误标项目行 | 是（key 按 kind 命名空间隔离） |
| 图标文件相对基线的差异 | 仅 +1（`IconDotSolid16`） |
| 测试 | **187/187**（新增 menu-open 回归 5 项） |
| 门禁 | typecheck / build / 两个 contract 检查 / runtime 20/20 全绿 |

新增的回归测试专门锁住这个 bug：**断言面板源码里不再出现 `closeOnPointerLeave`**。
这一行很容易在重构时被顺手加回来，而症状（菜单在手里消失）不会在单测里自然暴露。

---

## 13. 官方项目行菜单：行不挂载 + 移上去就消失（2026-09-23 第八轮）

用户反馈"**还是没修好**"，两个症状：菜单浮层移到上面就消失、新增的行有时不挂载。
上一轮我**误判了范围** —— 我测的是置顶区自己的菜单（那处确实修好了），而用户操作的是
**官方项目行（工作区行）的 `…` 菜单**，我的行是**注入**进去的。这是两条不同的代码路径。

### 根因：React 树边界

官方 `Menu` 靠 React 合成事件判断指针是否离开：

```js
onPointerLeave: closeOnPointerLeave ? () => { if (open) armClose() } : void 0
```

它把 trigger 和 portaled list 放在**同一个 wrapper `span`** 上，注释写得很清楚：
「trigger 和 portaled list 在这里算同一个区域」。**但这只在同一个 React 树里成立** ——
React 的 enter/leave 模拟沿 React 父链走，portal 保留 React 位置，所以那个 list 确实是 wrapper 的 React 子节点。

而本插件注入的行，是那个 list 的 **DOM 子节点**，却是**另一个 React root** 的 React 子节点。
指针一移上去，React 认为目的地"在 wrapper 之外"，触发 `pointerleave` → 200ms 后菜单关闭。

**实测**（同一时钟埋点）：

| 条件 | 菜单寿命 |
| --- | --- |
| 只有官方 2 行 | 一直开着 |
| 注入我的 5 行（共 7 行） | **221ms**（指针完全静止） |

这也解释了"有时不挂载"：我的行与官方菜单在同一次 commit 里争抢 DOM，渲染结果不稳定。

### 修法（按用户选择的方案 B：保留注入，拦截兜住）

官方项目菜单**没有槽位**，注入是唯一能加行的办法，而 React 树边界从这边移不掉。
能做的是**别在指针明明还在菜单里的时候告诉官方"它离开了"**：

在 `document` 上以**捕获阶段**监听 `pointerout` / `pointerleave`，当满足
「本插件正在装饰这个菜单」**且**「指针去往该行 ∪ 该菜单之内」时 `stopPropagation()`，
React 就看不到这次 leave。捕获阶段是必须的 —— React 挂在 root container（document 的后代），
冒泡阶段拦截就太晚了。

**关键细节（第一版做错了）**：区域必须是**行 ∪ 菜单的并集**，不能只看菜单内。
实测表明**触发关闭的那次事件，目的地是行的按钮条** —— 也就是触发按钮与菜单之间那 4px 的过渡带
（属于行自己的 padding）。只看菜单内会放它过去，React 照样开始倒计时，之后进入菜单**不会取消**它，
菜单还是在 200ms 后死掉。第一版就是这个错，第二次实测才暴露。

释放时机：装饰结束（菜单关闭 / 组件卸载）立刻 `release()`，否则会一直拦截整个应用的指针移动。
另外 `release()` 必须在"已经是 null 就直接 return"之前执行，否则关闭时会把 guard 一直挂在那。

### 定位过程中的两个自我纠错

| 我的假设 | 实测结果 |
| --- | --- |
| `sync()` 在"菜单未出现"的 mutation 里抹掉了 `requested` | **否** —— pointerdown 后单次 mutation 菜单就在了 |
| 加 `menuOpen` 保持按钮显示能修好 | **否** —— 过渡带在按钮盒子之外，与按钮是否显示无关 |
| "8/8 次只有 2 行" = 注入永久失效 | **否，是我的实验污染**：我把功能开关改成 `false` 后只改 localStorage **没有重载**，后续测量跑在功能关闭的页面上 |

第三条尤其值得记：**改配置后必须让页面重载生效**，否则会得到自相矛盾的证据。

### 验收（干净条件下，逐项实测）

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| 连续 5 次开菜单的行数 | 时有时无 | **7/7/7/7/7** |
| 停在注入的行上 1200ms | 221ms 即关闭 | 保持打开 |
| 慢速走完 7 行（含 5 行注入） | 中途消失 | **7/7 全部存活** |
| 移开鼠标 | 关闭 | **仍然关闭**（guard 没把菜单困住） |
| Escape | 关闭 | 关闭 |
| 点击外部 | 关闭 | 关闭 |
| 点我的行执行动作 | — | 执行并关闭（实测「复制路径」） |
| 未装饰的菜单 | — | 完全不受影响（判据要求 `decorating`） |
| 测试 | 187 | **195**（新增 guard 回归 8 项） |
| 门禁 | — | typecheck / build / 两个 contract 检查 / runtime 20/20 全绿 |

新增测试专门锁住两件事：**区域是行 ∪ 菜单的并集**（第一版做错的地方，附实测注释），
以及**监听必须是捕获阶段**（冒泡阶段会晚于 React，根本拦不住）。

---

## 14. 会话行菜单补图标（2026-09-23 第九轮）

用户指出：会话行的菜单也需要图标。

`SessionMenuExtra.tsx` 确实在渲染**纯文字行** —— 上一轮我把图标加进了项目菜单和置顶区菜单，
唯独漏了这条路径。原因是它有**自己的一份行清单**（三个 `if` 各自 push），而不是走 `row-menu.ts`。

### 顺带修掉的结构问题

与其在这里再抄一份图标映射，不如让它和另外两个表面**共用同一份清单**：
`row-menu.ts` 里本来就已有这三个动作及其图标名，只是这个文件没用。

新增 `pluginSessionRows()`，与既有的 `pluginProjectRows()` 对称：按设置开关**过滤**、
按当前状态**换标签与图标**、按能力**置灰**。两处菜单现在都从它派生，
测试断言两者产出的 `(id, labelKey, icon)` 三元组逐项相同。

### 区分「设置开关」与「能力」

这三个行原先用 `enabled` 同时表达两种含义，现在分开：

| 情况 | 表现 | 原因 |
| --- | --- | --- |
| 设置里关掉 | **移除该行** | 用户明确不要它 |
| 正在导出 / 没有工作目录 | **置灰该行** | 暂时做不到；移除会让菜单在操作过程中变形，下面的行跟着跳 |

### 与前一个 bug 的关键差异

会话菜单**没有**遇到"移上去就消失"的问题，因为官方把它作为 React 孩子渲染：

```js
children: renderSlot("sidebar.workspaces.session.menu.item", ...)
```

**同一个 React 树** → React 的 enter/leave 模拟能正确覆盖 → 不需要 `menu-pointer-guard`。
项目菜单之所以需要，是因为它**没有槽位**、只能 portal（见第 13 节）。
这条差异反过来印证了第 13 节的根因判断：问题出在 React 树边界，不在菜单实现本身。

### 验收（实测）

| 项 | 结果 |
| --- | --- |
| 会话菜单 7 行图标 | 全部有 |
| 新增三行的图标宽度 / viewBox | 14 / `0 0 16 16`（与官方会话行一致） |
| 标签左边缘对齐 | 唯一值 223px |
| 慢速走完 7 行（含新增 3 行） | 7/7 全程存活 |
| Escape 关闭 | 正常 |
| 正在导出 → 该行置灰 | 是（`disabled`，不移除） |
| 没有工作目录 → 该行置灰 | 是 |
| 设置关掉 → 该行移除 | 是 |
| 面板菜单与官方菜单的插件行一致 | 是（测试逐项比对三元组） |
| 测试 | 195 → **200** |
| 门禁 | typecheck / build / 两个 contract 检查 / runtime 20/20 全绿 |

---

## 15. 置顶区菜单改用官方 Menu（2026-09-23 第十轮）

用户指出：置顶区的菜单浮层也要保持一致，不该再写一套。

### 确实是两套

| | 用的 Menu | 行的渲染 |
| --- | --- | --- |
| 官方项目行 / 会话行菜单 | 官方 `Menu` | 官方 `MenuItemButton` |
| 置顶区的两个菜单 | **共享层自绘的 `Menu`**（302 行 + 255 行 CSS） | **手写 `<button>`** |

而且官方**同时导出了** `Menu` 和 `MenuItemButton`，以及**同名同构**的类型
（`MenuEntry` / `MenuItem` / `MenuSeparator` / `MenuLabel`）—— 也就是说那份自绘版从一开始就是多余的。
它已经开始漂移：官方的 `Menu` 用 `MenuItemButton` 渲染行，自绘版手搭 `<button>`，
于是键位漫游（keyboard walk）、选中后焦点归还这些行为天然对不上。

### 做法：转发，而不是对齐

把共享层的 `Menu` 换成官方组件的再导出，并**删掉那份自绘实现**：

- 删除 `packages/ui/src/primitives/Menu.tsx`（302 行）
- 删除 `Menu.module.css`（255 行）
- 删除只被它使用的 `pointer-grace.ts`（53 行）

一行样式都没重写 —— 因为**样式来自官方 bundle 自己注入的 `<style>`**，
这纠正了我一开始的担心（`primitives-fit.ts` 记载过"转发官方组件会丢样式表"）。

### 验证：逐字节对比，而不是看着像

同一页面上分别打开**面板菜单**和**官方项目行菜单**，读 `getComputedStyle`：

| 指标 | 面板菜单 | 官方菜单 |
| --- | --- | --- |
| 浮层背景 | `rgba(248, 249, 250, 0.58)` | 相同 |
| 圆角 / 阴影 / 内边距 / z-index | `16px` / 有 / `3px` / `1100` | 相同 |
| 行高 / 内边距 / 字号 / 圆角 | `34` / `6px 8px` / `13px` / `8px` | 相同 |

`identicalMenuChrome: true`、`identicalRowChrome: true`。

### 交互回归（替组件最容易踩的坑）

| 项 | 结果 |
| --- | --- |
| 点触发按钮再点一次 → 关闭 | 是 |
| Escape → 关闭 | 是 |
| 慢速走完 7 行 → 全程存活 | 是（7/7） |
| 点击外部 → 关闭 | 是 |
| `menuOpen` 行标记：打开时标记 1 行、按钮条 `flex` | 是 |
| 关闭后标记清除 | 是 |
| 7 行图标齐全 | 是 |

### 跨插件影响

`Menu` 是共享层导出，别的插件也在用。改完逐个 typecheck：
dsh-codex / dsh-computer-tools / dsh-model-custom-ex / dsh-plugin-config / dsh-quick-notes
**全部 0 错误**，全仓库 `pnpm -r typecheck` 通过。
（各处只用到共享层的子集 props，而官方的是超集，所以调用点无需改动。）

产物体积 481.51 kB → **465.82 kB**，少掉的就是那份重复实现。

### 验收

| 项 | 结果 |
| --- | --- |
| 浮层 chrome 与官方逐项相同 | 是 |
| 行 chrome 与官方逐项相同 | 是 |
| 自绘 Menu / CSS / pointer-grace 已删除 | 是（610 行） |
| 全仓库 typecheck | 通过 |
| workspace-plus 测试 | **200/200** |
| 门禁 | build / 两个 contract 检查 / runtime 20/20 全绿 |

---

## 16. 去掉「标记为未读」、新增「复制会话引用」（2026-09-23 第十一轮）

两项需求：

1. 会话行**去掉**「标记为未读」
2. 会话行**新增**「复制会话引用」—— 把该 session 的实际引用复制到剪贴板

### 一、去掉未读

未读不是只删一行菜单项那么简单，它有一套自己的状态与 UI：插件的 `unreadSessions` 标记、
行上的视觉、一个设置开关、以及一个**本地自绘的图标**（`IconDotSolid16`）。
全部一并清掉，避免留下"行没了但状态还在"的死代码：

| 删除项 | 位置 |
| --- | --- |
| 动作清单里的 `unread` | `row-menu.ts`（`PLUGIN_SESSION_ACTIONS`） |
| `unread` 的标签/图标翻转逻辑 | `pluginSessionRows()` |
| `sessionUnread` 开关 + 设置项 | `features.ts` / `MenuSettingsItem.tsx` |
| `unreadSessions` 持久化字段 + `setUnreadSessions` + `toggleId` | `features.ts` |
| 注入接口的 `toggleUnread` / `isUnread` | `SessionMenuExtra.tsx` / `index.tsx` |
| `RowIcon` 的 `dot` / `checkCircle` 两个名字 | `row-menu.ts` |
| **本地图标 `IconDotSolid16`** | `packages/ui/src/icons/index.tsx` |

最后一条值得单说：`IconDotSolid16` 是**当时为了未读标记手工加进共享图标集的唯一一个图标**，
官方图标集里没有对应物。功能删掉后它无人引用，一并移除 ——
**本地图标集恢复零新增**，所有行图标都是转发官方的。

兼容性：旧版本留下的 `unreadSessions` 字段在加载时被忽略、不再回写，
新增测试专门锁定这一点（喂一份旧数据，断言字段不存在且相关函数已消失）。

### 二、复制会话引用

引用格式是 DSH 自己的：`dsh-session:` + id 的 JSON 经 **base64url**，
渲染成 `@[label](uri)` 的 Markdown mention —— 这正是 composer 里 `@` 提及时用的形式。
实测复制到的内容：

```
@[重构 workspace-plus 置顶区域](dsh-session:InNlc3Npb24tODYwZWNiOWEtMGI5Ni00MDdjLTlhMTktNWMxNjZkMDJhZDQ2Ig)
```

**实现在共享层**（`packages/runtime/src/client.ts`），与 host 侧那个同名导出配成一对：

| | 实现 |
| --- | --- |
| host（`./host`） | 转发官方的 `formatSessionReferenceMention` |
| **client（`./client`）** | **自己实现** —— 官方那份走 `Buffer`，而浏览器没有 |

`Buffer` 这点是**实测**的，不是推断：在真实 DSH 客户端里 `typeof Buffer === 'undefined'`，
`btoa` 与 `TextEncoder` 有。官方也没有任何 client bundle 携带该编码器。

因此存在**漂移风险**（我们拼出的串宿主解析不了），这是本次唯一实打实的技术风险。
应对方式是把它放进**共享层**而不是插件内，因为：

- `packages/` 允许直接 import `@deepseek-ai/*`，测试可以**逐字节比对官方实现**；
- 插件被 `check-dependency-contracts.mjs` 禁止这样做，只能自己断言自己（没有意义）。

于是有了 `packages/runtime/test/session-reference-client.test.ts`：8 个用例，
不是拿手写的期望值比对，而是**与官方实现直接对比**，并且用官方的
`decodeSessionReferenceUri` 验收我们的产物。

签名也刻意与 host 侧**完全一致**（都收 `{ sessionId, label }` 对象）：
同名但一个收对象、一个收位置参数的话，import 错了入口会**编译通过、运行时才炸**
（在字符串上读 `.sessionId`）。有测试锁住这一点。

### 三、自我纠错

| 我的假设 | 实测结果 |
| --- | --- |
| 官方编码器可以在客户端跑 | **否** —— `Buffer` 不存在，必须在共享层自带实现 |
| 在插件内写测试对比官方即可 | **否** —— 被契约检查拦下（连测试文件也扫） |
| 用 `escapeLabel` 转义 `[` 也无妨 | **是"无妨"但不对** —— 官方只转义 `\` 和 `]`；多转义能往返、但字节与宿主不同，无法靠往返测试发现，改用逐字节断言 |

### 验收（实测）

| 项 | 结果 |
| --- | --- |
| 官方会话菜单行 | `置顶会话 / 重命名 / 分叉会话 / 归档会话 / 复制会话引用 / 导出为 Markdown / 打开所在目录` |
| 「标记为未读」 | 已消失 |
| 点击「复制会话引用」 | 菜单关闭，剪贴板得到上面那串 |
| 官方 `parseSessionReferenceText` 解析剪贴板内容 | 1 条引用，id 与 label 均正确，渲染为 `@重构 workspace-plus 置顶区域` |
| 悬停在新行上 | 菜单保持打开（上一轮的守卫仍生效） |
| 新行图标 | 官方 copy 图标 |
| 与官方实现逐字节一致性 | 8/8 通过（URI、mention、label 转义） |
| 旧数据兼容 | 旧 `unreadSessions` 被忽略，不复活 |
| 测试 | workspace-plus **202/202**；runtime 20 → **28/28** |
| 门禁 | 全仓库 typecheck / build / 两个 contract 检查全绿 |
