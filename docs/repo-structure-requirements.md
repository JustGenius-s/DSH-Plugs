# 代码仓库结构调研 — 需求说明

本文只定义「仓库结构调研」要回答什么、交什么、如何验收。  
**不包含调研正文**（结构图、完整包清单、逐插件目录说明由后续实现阶段产出）。

| 项 | 值 |
| --- | --- |
| 仓库 | `/Users/morisi/Space/DSH-Plugs` |
| 根包名 | `dsh-plugs`（`private: true`） |
| 口号 | one folder = one plugin |
| 包管理 | pnpm workspace（根 `packageManager`: `pnpm@11.21.0`） |
| 约束来源 | `AGENTS.md`：新插件优先复用 `packages/` 共享层，禁止直接依赖官方包 |

---

## 1. 目标

为后续写插件的人提供一份**可导航的仓库地图**：第三人打开 `docs/repo-structure.md` 后，不必再扫一遍顶层，就能定位：

- 工作区哪些路径是包、哪些只是占位或资源；
- 每个插件文件夹的职责与入口；
- `packages/` 共享层各自管什么、插件应依赖哪一层；
- 根脚本与门禁扫什么；
- 新建插件应对齐的目录与 `package.json` 约定。

调研是**结构说明**，不是产品手册、不是重构方案。

---

## 2. 调研范围与排除项

### 2.1 纳入（只读）

| 层级 | 对象 | 深度 |
| --- | --- | --- |
| 顶层 | 根目录可见项 | 一级目录/关键文件的角色标注 |
| Workspace | `package.json`、`pnpm-workspace.yaml`、`.npmrc` | 成员 glob、根脚本、registry、工具链版本 |
| TS 基座 | `tsconfig.base.json` 及各包 `tsconfig*.json` | 是否存在根 `tsconfig.json`、`extends`、`noEmit` |
| 约定文档 | `README.md`、`AGENTS.md` | 「Repository layout / What a plugin is / Shared packages」与磁盘对照 |
| 门禁脚本 | `scripts/*.mjs` | 扫哪些路径、硬规则、静默跳过条件 |
| 插件 | `plugins/*` 每个一级目录 | `package.json` 摘要（name / version / scripts / `dsh.*` / exports / 依赖）、标准目录骨架 vs 变体 |
| 共享层 | `packages/*` 每个一级目录 | 职责、exports、官方包钉版本落点、被谁依赖 |
| 非成员路径 | `apps/`、`public/`、`docs/`、`scripts/` | 是否空、是否 workspace 包、是否被脚本引用 |

### 2.2 排除

- `node_modules/`、`.pnpm-store/`、各包 `lib/` 生成物清单（可注明「存在且被 gitignore」，不展开内容）。
- `pnpm-lock.yaml` 全量传递依赖树。
- 插件内部组件树、CSS、业务状态机、交互教程。
- `.git` 历史、`.cursor`、`.hvigor` 工具私货（结构图可点名存在，不展开）。
- 官方 DSH 宿主仓库（`@deepseek-ai/*` checkout）内部结构；只记录本仓库如何引用。
- 本需求阶段不跑完整 `pnpm build`；实现阶段可引用脚本入口，验证阶段按本文档核对正文与磁盘。
- 不修改业务/构建代码；不设计新插件；不改 workspace 边界。
- 不写 npm 发布、CI、`dsh plugin add` 操作手册（入口命令可在「已知信号」点名）。

### 2.3 「一个插件」的操作定义

磁盘上 `plugins/<folder>` 即一枚候选插件。调研须区分：

- **标准 TS 插件**：`src/` + tsdown 双配置（host / client）+ `lib/` 输出 + `@just-genius/*` 包名 + `workspace:*` runtime。
- **例外形态**：无 `src/`、无 `typecheck`、无 runtime、包名无 scope、入口为根目录 `.js` 等。
- **文档幽灵**：`README` 列出但 `plugins/` 下不存在的包名。
- **文档遗漏**：磁盘存在但 `README` 插件列表未点名。

「是否有 client 端」须同时核对（缺一须标明）：

1. `package.json` 存在 `dsh.client`（`platform` / `inject`）；
2. 存在 browser 入口（约定 `src/client/index.tsx` → `lib/client.js`，或例外包的 `./client` export）；
3. `dsh.bundle.patch` 指向 `cordis.patch.yml`。

---

## 3. 必须回答的问题清单

实现阶段正文必须逐条作答。括号内为需求阶段已看到的线索，**不得当作结论抄进调研正文**，须再核文件。

### Q1. 工作区分区

1. 根目录除 `node_modules`、`.pnpm-store` 外有哪些一级项，各自角色是什么（源码 / 配置 / 空占位 / 静态资源 / 工具 / 文档）？
2. `pnpm-workspace.yaml` 的成员 glob 是什么？`apps/`、`public/`、`scripts/`、`docs/` 是否是 workspace 包？
3. 根 `package.json` 的 `private`、`type`、`packageManager`、共享 `devDependencies` 是什么？
4. `.npmrc` 指向哪个 registry？是否有 workspace 协议以外的安装约束？
5. 根是否有 `tsconfig.json`？`tsconfig.base.json` 的关键选项（`jsx`、`noEmit`、`moduleResolution`）是什么，各包如何 `extends`？

### Q2. 插件清单与职责

1. `plugins/` 一级目录完整枚举（一行一个，禁止合并）。当前磁盘线索：`dsh-codex`、`dsh-debug-mode`、`dsh-desktop-update`、`dsh-flow`、`dsh-memory`、`dsh-model-custom-ex`、`dsh-multi-repo`、`dsh-plugin-config`、`dsh-synapse`、`dsh-sync`、`dsh-whale-girl`。
2. 每个目录的 npm `name`、`version`、一句话职责（取自该包 `description` 或 README 首段，不作功能教程）。
3. 每个插件：host 入口、browser 入口、`dsh.client` / `dsh.bundle`、是否有 client、构建与 typecheck 脚本。
4. README 已列但磁盘无的插件（线索：`dsh-notify-jump`、`dsh-session-archive`）？磁盘有但 README 未列的插件（线索：`dsh-synapse`）？
5. 哪些插件偏离标准 TS 模板（线索：`dsh-synapse` 为根目录 JS、无 `@just-genius` scope、无 runtime、无 `typecheck`）？

### Q3. packages 共享层

1. `packages/` 一级目录完整枚举。线索：仅 `runtime`、`ui`。
2. `@just-genius/dsh-plugin-runtime` 的职责、`exports`（`.` / `./host` / `./client`）、谁允许直接依赖 `@deepseek-ai/*`？
3. `@just-genius/dsh-plugin-ui` 的职责、`exports`（含 `./theme.css`、`./css-modules`）、插件侧常见是 `dependencies` 还是 `devDependencies`（构建期打包）？
4. 哪些插件依赖 runtime、哪些依赖 ui、哪些两者都没有？
5. 官方 API 钉版本以脚本常量与 `packages/runtime` 清单为准（线索：`DSH_LATEST = 0.1.1-rc.2`；`@deepseek-ai/dsh-client-schema-form` → `0.1.0-rc.7`）。

### Q4. 构建 / 脚本

1. 根脚本 `build`、`watch`、`typecheck`、`clean`、`check:dependency-contracts`、`check:client-modules` 各自调用什么？
2. `build` 与 `typecheck` 和两道门禁的先后关系？
3. 各 workspace 包是否实现同名 script？缺 script 时 `pnpm -r` 的实际含义（尤其无 `typecheck` 的包）？
4. `check-dependency-contracts.mjs` 与 `check-client-modules.mjs` 的发现范围（一级子目录）、跳过条件（如缺少 `lib/client.js` 则 `continue`）？
5. 标准插件的 tsdown 双配置约定；已见变体（线索：`dsh-whale-girl` 另有 overlay 配置；`dsh-codex`、`dsh-flow` 有 `test/`）。

### Q5. 依赖约束

1. `AGENTS.md` 的文字规则是什么？
2. 插件是否必须 `dependencies["@just-genius/dsh-plugin-runtime"] === "workspace:*"`？
3. 插件的 `dependencies` / `devDependencies` / `peerDependencies` 是否禁止出现 `@deepseek-ai/*`？
4. 插件源码（排除 `lib/`、`node_modules/`）是否禁止直接 `import` / `require` `@deepseek-ai/`？
5. `packages` 内 `@deepseek-ai/dsh-*` 必须钉到哪一版？例外表有哪些条目？
6. client bundle 的 `require()` 必须落在 `dsh.client.inject` 或平台种子（`react` / `react-dom`）上；共享包 `@just-genius/dsh-plugin-*` 不得泄漏进 client `require`；官方 primitives 必须由 ui 包替换。
7. `dsh.client.inject` 声明官方包与「源码不得直连官方包」如何并存（inject 是运行时模块表，不是 npm 依赖）？

### Q6. 典型插件目录约定

1. README「What a plugin is」两半表：node（`src/index.ts` → `lib/index.js`）与 browser（`src/client/index.tsx` → `lib/client.js` + `window.__ModuleLoader__` + `ctx.slots.register`）。
2. 标准骨架应包含哪些文件：`package.json`、`tsconfig.json`、`tsdown.config.ts`、`tsdown.client.config.ts`、`cordis.patch.yml`、`src/index.ts`、`src/client/index.tsx`。
3. `package.json` 关键字段：`dsh.client`、`dsh.bundle.patch`、`exports`（`.` / `./client`）、`files`。
4. 已观察到的合法变体必须单独成行（额外 tsdown、额外 export、`test/`、`assets/`、纯 JS 根入口），不得粉饰成标准模板。
5. 新建插件的最低对齐清单：复用 runtime（及需要 UI 时复用 ui）、不直依官方包、声明 client inject、提供 bundle patch。

---

## 4. 交付物

| 阶段 | 产物 | 要求 |
| --- | --- | --- |
| 需求分析（本步） | `docs/repo-structure-requirements.md` | 本文；不含调研结论 |
| **实现阶段** | **`docs/repo-structure.md`** | 必须包含下方章节；用中文；按 §3 逐问作答 |
| **验证阶段** | 按本文 §5 逐条核对 | 检查者只对照 `docs/repo-structure.md` 与磁盘，不把本节「已知信号」当已证实事实 |

`docs/repo-structure.md` 必须包含：

1. **结构图**：根目录树（跳过 `node_modules`、`.pnpm-store`）；workspace 成员 vs 非成员对照。
2. **包清单表**：列 = 目录、npm name、version、类型（plugin / shared）、是否有 client、host 入口、browser 入口、构建命令、typecheck 命令、备注/例外。覆盖全部 `plugins/*` 与 `packages/*`；README 有、磁盘无的条目单列。
3. **依赖规则**：`AGENTS.md` + 两道检查脚本的硬规则（含版本常量与例外表）+ 谁可直依官方包。
4. **构建 / typecheck 入口**：根六脚本映射；各包是否实现同名 script；TS 基座继承关系。
5. **插件约定**：两半模型、`dsh.*` 字段、标准骨架 vs 变体。
6. **共享层职责与依赖方向**：runtime / ui 各一句话 + exports；插件 → runtime / ui。
7. **已知偏差附录**：文档 vs 磁盘、合约可能失败的包、空目录、未进 workspace 的路径。

---

## 5. 成功标准（验证阶段可检查清单）

下列每条必须能在 `docs/repo-structure.md` 中找到对应段落或表格行。

| ID | 标准 | 通过条件 |
| --- | --- | --- |
| S1 | 目标对齐 | 正文是仓库地图，不是插件功能教程或重构方案 |
| S2 | 根结构完整 | 结构图列出根下除 `node_modules`、`.pnpm-store` 外的全部一级目录与关键文件，并标注角色 |
| S3 | Workspace 边界正确 | 写明 `pnpm-workspace.yaml` 仅 `plugins/*` 与 `packages/*`；明确 `apps/`、`public/`、`scripts/`、`docs/` **不是** workspace 包 |
| S4 | 插件枚举穷尽 | 包清单 plugin 行数 = 磁盘 `plugins/*` 一级目录数；每个目录一行 |
| S5 | 共享包枚举穷尽 | `packages/*` 每个一级目录一行，写清 npm name 与职责 |
| S6 | Client 判定可复核 | 每个插件标注有/无 client，并给出 `dsh.client`、入口路径、`cordis.patch.yml` 三者依据 |
| S7 | 入口可核对 | 标准插件写明 host/browser 源文件约定与 `main`/`exports`；例外包装单独说明实际文件 |
| S8 | 根脚本映射完整 | `build` / `watch` / `typecheck` / `clean` / 两个 `check:*` 均被解释，并指向 `scripts/` 文件名 |
| S9 | 依赖规则可执行 | 复述检查脚本硬规则（`workspace:*` runtime、禁止插件直依/直 import 官方包、`DSH_LATEST`、例外表、client `require`/`inject`），不是只引用 `AGENTS.md` 一句 |
| S10 | 共享层依赖图 | 有「插件 → runtime / ui」说明；指出 ui 常见为构建期 `devDependencies` 还是运行时 `dependencies` |
| S11 | TS 基座 | 如实写根有无 `tsconfig.json`；说明 `tsconfig.base.json` 与各包 `extends` |
| S12 | 文档 vs 磁盘 | 至少点名 README 已列但磁盘不存在的插件，以及磁盘存在但 README 未列的插件 |
| S13 | 例外不粉饰 | 不符合「TS + workspace runtime」模板的插件必须标「例外」并列出缺项 |
| S14 | 语言与范围 | 正文用中文；跳过 `node_modules` / `.pnpm-store` / `lib` 内容当结构主体 |
| S15 | 六组问题闭合 | §3 的 Q1–Q6 在正文中均有对应章节或表格，无「见源码」空答 |

---

## 6. 已知信号（需求阶段只读勘察，供实现引用，不作结论）

实现阶段须用文件再核一遍后再写入正文。

- Workspace：`plugins/*`、`packages/*`。根 `build` = `pnpm -r build && check:client-modules`；根 `typecheck` = `check:dependency-contracts && pnpm -r typecheck`。
- 共享层仅两包：`packages/runtime`（`@just-genius/dsh-plugin-runtime`，README 称唯一直接适配官方 host/client API 的边界）、`packages/ui`（`@just-genius/dsh-plugin-ui`，`--dsw-*` 与 React 原语，插件构建期打包）。
- 官方钉版本信号：`0.1.1-rc.2`；`@deepseek-ai/dsh-client-schema-form` → `0.1.0-rc.7`。
- `apps/` 为空目录，未写入 workspace。`public/` 为截图（`desktop-update.png`、`model-custom-ex.png`、`session-nav.png`），非包。
- README 另述 `@just-genius/dsh-notify-jump`、`@just-genius/dsh-session-archive`，当前 `plugins/` 未见对应目录。
- README 插件列表未点名 `dsh-synapse`；该包为根目录 JS（`index.js` / `client.js` / `app.js`），无 runtime、无 `typecheck`。合约脚本按一级子目录发现 manifest，调研须核实它是否会被扫入并失败。
- 多数标准插件同时具备 `dsh.client.platform: web` 与 `dsh.bundle.patch` → `cordis.patch.yml`。
- 根无 `tsconfig.json`，仅 `tsconfig.base.json`。`.gitignore` 忽略 `node_modules/`、`.pnpm-store/`、`lib/`、`dist/`。
- `check-client-modules` 在缺少 `lib/client.js` 时 `continue`：未构建的包可能被静默跳过。

---

## 7. 风险与假设（实现阶段须显式确认或证伪）

| ID | 假设 / 风险 | 处理 |
| --- | --- | --- |
| R1 | README 与磁盘插件集合不一致（幽灵包 / 遗漏包） | 以**当前工作区磁盘**为准；文档差异写入偏差附录 |
| R2 | `dsh-synapse` 可能不满足依赖合约，或因无 `lib/client.js` 被 client 检查跳过 | 正文必须标例外，并写明两道脚本对它的实际覆盖 |
| R3 | `apps/` 意图未知（未来 app 占位 vs 遗留） | 无权威注释则标「未知」，不臆造产品规划 |
| R4 | 部分插件 `dsh.client.inject` 含官方 primitives，与 client 门禁「必须用 ui 包替换」存在张力 | 对照该包 `lib/client.js` 是否真 `require` 该 specifier |
| R5 | 结构调研不保证合约脚本当前能通过 | 需求阶段不跑完整构建；实现阶段只描述规则与覆盖面 |

---

## 8. 本文件角色

| 步骤 | 产物 | 本文件 |
| --- | --- | --- |
| 1 需求分析 | 本文 `docs/repo-structure-requirements.md` | 完成 |
| 2 实现 | `docs/repo-structure.md`（§4 章节 + §3 问答） | 不在此文件展开 |
| 3 验证 | 按 §5 S1–S15 逐项勾选 | 检查者只读调研正文与磁盘 |
