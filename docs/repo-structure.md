# DSH-Plugs 仓库结构调研

仓库：`/Users/morisi/Space/DSH-Plugs`  
根包名：`dsh-plugs`（`private: true`，`version: 0.0.0`）  
口号：one folder = one plugin  
包管理：`packageManager` = `pnpm@11.21.0`

本文是**仓库地图**，只描述当前工作区磁盘上的源码与配置。不展开插件产品教程，不提出重构方案。`node_modules/`、`.pnpm-store/`、各包 `lib/` 生成物不当结构主体；`lib/` 仅在核对入口或门禁扫描时点名。

对应需求：`docs/repo-structure-requirements.md` 的 Q1–Q6。

---

## 1. Q1 工作区分区

### 1.1 根目录树（跳过 `node_modules/`、`.pnpm-store/`）

磁盘根下除上述两项外的全部一级目录与关键文件：

```
DSH-Plugs/
├── .cursor/                 # 空目录；编辑器私货，不展开
├── .git/                    # VCS；不展开
├── .gitignore               # 忽略 node_modules、.pnpm-store、lib、dist、*.tsbuildinfo、*.log、.DS_Store
├── .hvigor/                 # 工具私货：仅 outputs/build-logs/build.log
├── .npmrc                   # npm registry 配置
├── AGENTS.md                # 新插件依赖约定（一句）
├── README.md                # 插件索引、layout、两半约定
├── apps/                    # 空目录；不是 workspace 包；意图未知（无注释、无 package.json）
├── docs/                    # 调研文档（非包）
├── package.json             # 根 workspace：脚本与共享工具链
├── packages/                # workspace 共享层（runtime、ui）
├── plugins/                 # workspace 插件（12 个一级目录）
├── pnpm-lock.yaml           # lockfile（不解析传递树）
├── pnpm-workspace.yaml      # 成员 glob
├── public/                  # 静态截图（非包）
├── scripts/                 # 根门禁脚本（非包）
└── tsconfig.base.json       # 唯一根 TS 基座；无根 tsconfig.json
```

**角色标注**

| 一级项 | 角色 |
| --- | --- |
| `plugins/` | 源码：每个一级子目录一枚插件包 |
| `packages/` | 源码：共享层 |
| `scripts/` | 工具：根门禁 `.mjs` |
| `docs/` | 文档：结构调研与需求/验收稿 |
| `public/` | 静态资源：`desktop-update.png`、`model-custom-ex.png`、`session-nav.png` |
| `apps/` | 空占位；意图未知 |
| `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `.npmrc` | 配置 |
| `tsconfig.base.json` | 配置（TS 基座） |
| `AGENTS.md` / `README.md` / `.gitignore` | 约定 / 文档 / 配置 |
| `.git/` / `.cursor/` / `.hvigor/` | VCS / 编辑器 / 工具私货 |

`docs/` 现有：`repo-structure-requirements.md`、`repo-structure.md`、`repo-structure-verification.md`。

### 1.2 Workspace 成员 vs 非成员

`pnpm-workspace.yaml` 全文：

```yaml
packages:
  - plugins/*
  - packages/*
```

| 路径 | 是否 workspace 包 |
| --- | --- |
| `plugins/*`（12 个一级目录） | 是 |
| `packages/*`（`runtime`、`ui`） | 是 |
| `apps/` | **否**（空目录，无 `package.json`） |
| `public/` | **否** |
| `scripts/` | **否** |
| `docs/` | **否** |
| 根 `dsh-plugs` | 私有根，不是成员 glob 里的包 |

根本身不是 `plugins/*` / `packages/*` 成员，只提供共享 `devDependencies` 与编排脚本。

### 1.3 根 `package.json`

| 字段 | 值 |
| --- | --- |
| `name` | `dsh-plugs` |
| `version` | `0.0.0` |
| `private` | `true` |
| `type` | `module` |
| `packageManager` | `pnpm@11.21.0` |
| `description` | DeepSeek Harness (DSH) plugin monorepo — one folder = one plugin |

共享 `devDependencies`：

| 包 | 版本 |
| --- | --- |
| `@types/react` | `~18.3.1` |
| `@types/react-dom` | `~18.3.0` |
| `react` | `^18.2.0` |
| `react-dom` | `^18.2.0` |
| `tsdown` | `^0.22.14` |
| `typescript` | `^5.7.3` |
| `@types/node` | `^22.0.0` |

根六脚本见 §4。

### 1.4 `.npmrc`

全文仅一行：`registry=https://registry.npmjs.org/`。  
未见 `shamefully-hoist`、自定义 `link-workspace-packages` 或其他安装约束。workspace 协议（`workspace:*`）写在各包 `package.json`，不在 `.npmrc`。

### 1.5 TS 基座

- **根没有** `tsconfig.json`（磁盘确认 `ls tsconfig.json` 失败）。
- 唯一根基座是 `tsconfig.base.json`：

| 选项 | 值 |
| --- | --- |
| `target` / `module` | `ES2022` / `ESNext` |
| `moduleResolution` | `bundler` |
| `jsx` | `react-jsx` |
| `lib` | `ES2022`、`DOM`、`DOM.Iterable` |
| `strict` | `true` |
| `noEmit` | `true` |
| `types` | `[]` |
| 另有 | `esModuleInterop`、`skipLibCheck`、`forceConsistentCasingInFileNames`、`resolveJsonModule`、`isolatedModules` |

各包 `tsconfig.json` 一律 `"extends": "../../tsconfig.base.json"`，`"include": ["src"]`。`dsh-synapse` **没有** `tsconfig.json`。

包级覆盖（在基座之上）：

| 包 | 额外 `compilerOptions` |
| --- | --- |
| `plugins/dsh-codex` | 无覆盖 |
| `dsh-desktop-update`、`dsh-multi-repo` | `types: ["node"]` |
| `dsh-model-custom-ex`、`dsh-wechat-chat` | `allowImportingTsExtensions: true` |
| `dsh-debug-mode`、`dsh-memory`、`dsh-plugin-config`、`dsh-sync`、`dsh-whale-girl`、`packages/runtime`、`packages/ui` | `allowImportingTsExtensions` + `types: ["node"]` |
| `dsh-flow` | 上两项 + 再写 `jsx: "react-jsx"` |

---

## 2. 源码区二级树

### 2.1 `plugins/`（12 个一级目录，一行一个）

```
plugins/
├── dsh-codex/
├── dsh-debug-mode/
├── dsh-desktop-update/
├── dsh-flow/
├── dsh-memory/
├── dsh-model-custom-ex/
├── dsh-multi-repo/
├── dsh-plugin-config/
├── dsh-synapse/          # 例外：根目录 JS
├── dsh-sync/
├── dsh-wechat-chat/
└── dsh-whale-girl/
```

标准 TS 插件（除 synapse 外 11 个）一级可见项：`package.json`、`tsconfig.json`、`tsdown.config.ts`、`tsdown.client.config.ts`、`cordis.patch.yml`、`src/`、`README.md`。构建后另有被 gitignore 的 `lib/`。

标准插件 `src/` 二级（以 `dsh-memory` 为典型）：

```
src/
├── index.ts                 # host
├── client/
│   └── index.tsx            # browser（部分包为 index.ts）
├── *.ts                     # host / 共享逻辑
└── css-modules.d.ts         # 部分包
```

例外与加料见 §6.4。

### 2.2 `packages/`

```
packages/
├── runtime/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsdown.config.ts
│   └── src/
│       ├── index.ts
│       ├── host.ts
│       ├── client.ts
│       └── profile.ts
└── ui/
    ├── package.json
    ├── README.md
    ├── tsconfig.json
    ├── tsdown.config.ts
    ├── scripts/sync-theme.mjs
    └── src/                 # primitives、theme、css-modules、install-theme
```

`packages/runtime` **没有** README。

### 2.3 非成员路径

```
apps/          # 空
docs/          # 三份结构调研相关 md
public/        # 三张 png
scripts/
├── check-dependency-contracts.mjs
└── check-client-modules.mjs
```

---

## 3. 包清单总表

列含义：类型、是否有 client（三项依据见各行备注）、host / browser 入口、构建与 typecheck 命令。

### 3.1 共享层（`packages/*`，2 行）

| 目录 | npm name | version | 类型 | client | host 入口 | browser 入口 | build | typecheck | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/runtime` | `@just-genius/dsh-plugin-runtime` | `0.1.0` | shared | 提供 `./client` 适配器，本身不是 DSH 插件 | `src/host.ts` → `lib/host.js`（export `./host`） | `src/client.ts` → `lib/client.js`（export `./client`） | `tsdown` | `tsc --noEmit` | 无 `watch`；唯一允许直连 `@deepseek-ai/*` 的边界 |
| `packages/ui` | `@just-genius/dsh-plugin-ui` | `0.2.0` | shared | 否（UI kit） | 无 host 插件入口 | `src/index.tsx` → `lib/index.js`；另 `./theme.css`、`./css-modules` | `tsdown` | `tsc --noEmit` | 另有 `sync-theme`；无 `watch`；**无** `@deepseek-ai/*` 依赖 |

### 3.2 插件（`plugins/*`，12 行，与磁盘一级目录数相等）

Client 三项（缺一须标明）：① `package.json` 有 `dsh.client`；② browser 入口文件；③ `dsh.bundle.patch` → `cordis.patch.yml`。下表 12 包三项均具备，故「有 client」。

| 目录 | npm name | version | 类型 | 有 client | host 入口 | browser 入口 | build | typecheck | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dsh-codex` | `@just-genius/dsh-codex` | `0.2.1` | plugin | 是：① `dsh.client.platform=web` + inject；② `src/client/index.tsx` → `lib/client.js` + `exports["./client"]`；③ `cordis.patch.yml` | `main`/`exports["."]` → `lib/index.js`（`src/index.ts`） | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 另 export `./side-panels`；host tsdown 双 entry |
| `dsh-debug-mode` | `@just-genius/dsh-debug-mode` | `0.1.0` | plugin | 是（同上三项，入口 `src/client/index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 标准模板 |
| `dsh-desktop-update` | `@just-genius/dsh-desktop-update` | `0.2.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 标准模板 |
| `dsh-flow` | `@just-genius/dsh-flow` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 另有 `test/` + `test` script |
| `dsh-memory` | `@just-genius/dsh-memory` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 标准模板 |
| `dsh-model-custom-ex` | `@just-genius/dsh-model-custom-ex` | `0.1.0` | plugin | 是；browser 源为 `src/client/index.ts`（非 tsx） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 入口扩展名变体 |
| `dsh-multi-repo` | `@just-genius/dsh-multi-repo` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | inject 含官方 primitives；client tsdown **未** alwaysBundle runtime |
| `dsh-plugin-config` | `@just-genius/dsh-plugin-config` | `0.1.0` | plugin | 是；browser 源为 `src/client/index.ts` | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 入口扩展名变体 |
| `dsh-synapse` | `dsh-synapse` | `0.4.1` | plugin | 是：① `dsh.client`（`platform=web`，`immediately=false`）；② **根** `client.js` + `exports["./client"]`；③ `cordis.patch.yml`。**无** `lib/client.js` | **根** `index.js`（`main`） | **根** `client.js` | `node --check` 三文件 | **无** | **例外**：无 scope、无 `src/`、无 runtime、无 typecheck/watch/clean、无 tsdown |
| `dsh-sync` | `@just-genius/dsh-sync` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 标准模板 |
| `dsh-wechat-chat` | `@just-genius/dsh-wechat-chat` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 双 tsdown | `tsc --noEmit` | 标准模板 |
| `dsh-whale-girl` | `@just-genius/dsh-whale-girl` | `0.1.0` | plugin | 是（`index.tsx`） | `lib/index.js` | `lib/client.js` | 三 tsdown + 拷 overlay.html | `tsc --noEmit` | 另有 `tsdown.overlay.config.ts`、`assets/`、`lib/overlay.js` |

标准插件 `files` 一般为：`lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`lib/**/*.d.ts`。codex 另含 `lib/side-panels.js`；whale-girl 另含 `lib/overlay.js`、`lib/overlay.html`、`assets`、`LICENSE`。

### 3.3 README 有、磁盘无（幽灵包）

| README 标题 | 路径线索 | 磁盘 |
| --- | --- | --- |
| `@just-genius/dsh-notify-jump` | `plugins/dsh-notify-jump` | **不存在** |
| `@just-genius/dsh-session-archive` | `plugins/dsh-session-archive` | **不存在** |

`plugins/` 与 `packages/` 下均无对应目录。

### 3.4 磁盘有、README 插件列表未点名

| 目录 | npm name |
| --- | --- |
| `plugins/dsh-synapse` | `dsh-synapse` |

README「Plugins」列出 13 个名字（含两个幽灵）；未点名 synapse。

---

## 4. Q2 插件清单与职责

职责取自各包 `package.json` 的 `description`（不作功能教程）。

| 目录 | 一句话职责 |
| --- | --- |
| `dsh-codex` | Codex 风格导航、侧栏与终端集成壳 |
| `dsh-debug-mode` | Cursor 风格 debug：`/debug`、复现卡片、运行时日志码头 |
| `dsh-desktop-update` | DSH-Desktop 更新徽标与原生座位/通知（`window.dshDesktop`） |
| `dsh-flow` | Leader 规划 / 子代理执行的 DAG，React Flow 页签 |
| `dsh-memory` | 全局 markdown 记忆：设置页、AI 提议确认、系统提示注入 |
| `dsh-model-custom-ex` | 替换官方 Models 设置页，补 vision / reasoning-effort 选择器 |
| `dsh-multi-repo` | 多文件夹工作区选择器 |
| `dsh-plugin-config` | 设置 → 插件：已装清单、npm 更新、awesome-dsh-plugin 市场 |
| `dsh-synapse` | 可视化、非线性会话工作区 |
| `dsh-sync` | GitHub Device Flow + secret Gist 同步设置与 web 插件列表 |
| `dsh-wechat-chat` | 微信风格聊天气泡与会话列表 |
| `dsh-whale-girl` | 桌面宠物：浏览器页内伴侣，DSH-Desktop 则为 OS overlay |

### 4.1 `dsh.*` 与脚本（标准 11 包共性）

- `dsh.client.platform`: `"web"`
- `dsh.client.inject`: 官方 client 包名列表（各包不同；均为 `@deepseek-ai/*` 字符串，**不是** npm 依赖）
- `dsh.bundle.patch`: `"./cordis.patch.yml"`
- `exports`: `"."` → `lib/index.js`，`"./client"` → `lib/client.js`
- `scripts.build`: `tsdown -c tsdown.config.ts && tsdown -c tsdown.client.config.ts`（whale-girl 再加 overlay）
- `scripts.watch`: 对应 tsdown `--watch` 后台并行
- `scripts.typecheck`: `tsc --noEmit`
- `scripts.clean`: `rm -rf lib`
- `dependencies["@just-genius/dsh-plugin-runtime"]`: `"workspace:*"`
- `devDependencies["@just-genius/dsh-plugin-ui"]`: `"workspace:*"`（构建期打包）

synapse 偏离见 §6.4 / 附录。

---

## 5. Q3 `packages` 共享层

### 5.1 `@just-genius/dsh-plugin-runtime`（`0.1.0`）

**职责（磁盘）**：共享能力定义与 host/client 传输适配。README 称它是「唯一直接适配官方 DSH host/client API 的边界」。源码注释：`host.ts` 做 host service declaration merging；`client.ts` 是「唯一知道具体 DSH 模块布局」的 browser 边界。根 `src/index.ts` 只再导出 `profile.ts` 的类型。

**exports**

| 子路径 | 指向 |
| --- | --- |
| `.` | `lib/index.js` + `lib/index.d.ts` |
| `./host` | `lib/host.js` + dts |
| `./client` | `lib/client.js` + dts |
| `./package.json` | `package.json` |

**谁允许直接依赖 `@deepseek-ai/*`**

- 门禁 `check-dependency-contracts.mjs` **只禁止** `plugins/*` 的 `dependencies` / `devDependencies` / `peerDependencies` 出现 `@deepseek-ai/`。
- `packages/*` 可以声明 `@deepseek-ai/dsh-*`，但必须钉到 `DSH_LATEST` 或例外表。
- 当前只有 `packages/runtime` 声明了官方包（`peerDependencies` + 更长的 `devDependencies` 清单）。`packages/ui` 没有任何 `@deepseek-ai/*`。
- runtime 源码 `import type` / `export type` 自 `@deepseek-ai/cordis-plugin-loader`、`@deepseek-ai/dsh-*` 等。

官方钉版本：runtime 清单里凡 `@deepseek-ai/dsh-*` 均为 `0.1.1-rc.2`。非 `dsh-` 前缀的官方包不受该钉版本检查：`@deepseek-ai/cordis` `^4.0.1`、`@deepseek-ai/cordis-plugin-loader` `1.0.2`、`@deepseek-ai/schemastery` `^3.18.1`。

runtime **没有** `@deepseek-ai/dsh-client-schema-form`。例外表只存在于脚本常量，当前无消费者。

### 5.2 `@just-genius/dsh-plugin-ui`（`0.2.0`）

**职责**：DSH `--dsw-*` 主题 token + React 原语（Button、Input、Menu、Modal、Markdown、确认/toast、设置铬）。插件构建期打进 client bundle；独立应用可 `file:` / npm 依赖并在启动时 `installTheme()`。

**exports**

| 子路径 | 指向 |
| --- | --- |
| `.` | `lib/index.js`（`src/index.tsx`） |
| `./theme.css` | `src/theme/all.css`（源文件，不经 lib） |
| `./css-modules` | `lib/css-modules.js`（tsdown 的 `dshCssModules` 助手） |
| `./package.json` | `package.json` |

**插件侧常见位置**：11 个标准插件均把 ui 放在 **`devDependencies`**（`workspace:*`），不是 `dependencies`。与 README「插件构建期打包」一致。其中 10 个的 `tsdown.client.config.ts` `alwaysBundle` 含 `@just-genius/dsh-plugin-ui`；**`dsh-wechat-chat` 例外**：client 配置只 `alwaysBundle` runtime，源码不 import ui 组件，仅在 tsdown 配置里 `import { dshCssModules } from '@just-genius/dsh-plugin-ui/css-modules'`。

### 5.3 插件 → runtime / ui

| 依赖 | 插件 |
| --- | --- |
| runtime `workspace:*`（`dependencies`） | 除 synapse 外全部 11 个 |
| ui `workspace:*`（`devDependencies`） | 同上 11 个 |
| **两者都没有** | **仅 `dsh-synapse`** |

额外 npm 依赖（非共享层）：codex（shiki / xterm / markdown-it 等）、flow（`reactflow`）、sync 与 whale-girl（`zod`）。标准插件普遍 `peerDependencies`：`react` / `react-dom` `^18.2.0`（model-custom-ex、plugin-config 只 peer `react`）。

---

## 6. Q4 构建 / 脚本

### 6.1 根六脚本映射

| 根 script | 调用 |
| --- | --- |
| `build` | `pnpm -r build && pnpm check:client-modules` |
| `watch` | `pnpm -r --parallel watch` |
| `typecheck` | `pnpm check:dependency-contracts && pnpm -r typecheck` |
| `clean` | `pnpm -r clean` |
| `check:dependency-contracts` | `node scripts/check-dependency-contracts.mjs` |
| `check:client-modules` | `node scripts/check-client-modules.mjs` |

### 6.2 先后关系

- **`typecheck`**：先跑依赖合约，通过后再 `pnpm -r typecheck`。合约失败则不会进入各包 `tsc`。
- **`build`**：先各包 `build`，再跑 client 模块表检查。未产出 `lib/client.js` 的包在第二步被静默跳过（见下）。
- 两道门禁**互不调用**；根 `typecheck` 不跑 client 检查，根 `build` 不跑依赖合约。

### 6.3 各包是否实现同名 script；缺 script 时 `pnpm -r` 含义

| 包 | `build` | `watch` | `typecheck` | `clean` |
| --- | --- | --- | --- | --- |
| 11 个标准插件 | 有 | 有 | 有 | 有 |
| `dsh-synapse` | 有（`node --check`，非 tsdown） | **无** | **无** | **无** |
| `packages/runtime` | 有 | **无** | 有 | 有 |
| `packages/ui` | 有 | **无** | 有 | 有 |

`pnpm -r <script>`（即 recursive `run`）对**没有该 script 的 workspace 包直接跳过**，不因此失败。因此：

- 根 `typecheck` 的第二段**不会**对 synapse 执行 `tsc`；synapse 缺 `typecheck` 不会让 `-r` 报「无此脚本」。
- 根 `watch` / `clean` 同样跳过 synapse；`watch` 还跳过 runtime 与 ui。
- synapse 的 `build` **会**被 `-r build` 执行（语法检查三个根 JS）。

（本调研未跑完整 `pnpm build` / `pnpm typecheck` 的 `tsc` 段。验证阶段已单独执行两道门禁脚本，见 §6.4 / §6.5 / 附录 R5。）

### 6.4 `check-dependency-contracts.mjs`

**发现范围**

- Manifest：`plugins/`、`packages/` 的**一级子目录**各读 `package.json`（`readdir` + `isDirectory()`，不递归）。
- 源码：`plugins/` **递归**所有 `.[cm]?[jt]sx?` 文件，排除路径含 `/lib/` 或 `/node_modules/` 的。

**硬规则**

1. 每个插件 manifest：`dependencies["@just-genius/dsh-plugin-runtime"] === "workspace:*"`。
2. 插件三区（dep / devDep / peerDep）不得出现以 `@deepseek-ai/` 开头的包名。
3. `packages/*` 里每个 `@deepseek-ai/dsh-*` 必须等于 `VERSION_EXCEPTIONS.get(name) ?? DSH_LATEST`。
4. 插件源码不得 `from` / `import` / `require` / `declare module` `'@deepseek-ai/` 或 `"@deepseek-ai/`。

**常量**

- `DSH_LATEST = '0.1.1-rc.2'`
- 例外表仅一条：`@deepseek-ai/dsh-client-schema-form` → `0.1.0-rc.7`（注释：该遗留包未发 0.1.1 线；新代码应走 `dsh-client-ui-settings` 的 `SettingsSchemaService`）。

**对 synapse 的覆盖**：会被扫进 manifest（缺 runtime → 报错）和源码（`client.js` 有 `require('@deepseek-ai/dsh-client-ui-primitives')` → 报错）。**不会**因缺 `lib/` 而跳过。

**另一处源码命中（调研原稿未写）**：`plugins/dsh-codex/scripts/probe-commit.ts` 含 `require('@deepseek-ai/dsh-sdk-minimal')` 与 `require('@deepseek-ai/cordis')`。该文件是 `.ts`、不在 `lib/` / `node_modules/`，会被递归源码扫描命中。对比：`dsh-desktop-update/src/updater.ts` 用 `createRequire` 后的 `req('@deepseek-ai/dsh/package.json')`，**不匹配**脚本正则（要求字面 `require(` / `import` / `from` / `declare module`）。

验证阶段实测：`node scripts/check-dependency-contracts.mjs` **退出码 1**，三条：synapse 缺 runtime、synapse `client.js` 直连官方包、codex `scripts/probe-commit.ts` 直连官方包。

### 6.5 `check-client-modules.mjs`

**发现范围**：`plugins/` 一级子目录。

**跳过条件**：读取 `package.json` 或 `lib/client.js` 任一失败则 `continue`（静默跳过）。因此：

- **未构建**的标准插件会被跳过；
- **synapse** 入口是根 `client.js`，没有 `lib/client.js` → **整包跳过**，其 `require('@deepseek-ai/dsh-client-ui-primitives')` **不会**被本脚本看到。

**对已读到的 `lib/client.js` 的硬规则**

1. 用 `\brequire\("([^"]+)"\)` 抽 **双引号** `require`（单引号不匹配）。
2. 包名若以 `@just-genius/dsh-plugin-` 开头 → 报「shared package leaked into client require」。
3. 否则必须是平台种子 `react` / `react-dom`，或 `dsh.client.inject` 里声明的包名（`packageNameOf`：scoped 取前两段）。
4. 若 `require` 了 `@deepseek-ai/dsh-client-ui-primitives` 或其 `/client` 子路径 → 报「official primitives must be replaced by `@just-genius/dsh-plugin-ui`」。

当前磁盘上 11 个标准包均已有 `lib/client.js`。其中 10 个的 `require` 仅为 `react` / `react-dom` / `react/jsx-runtime`。**`dsh-multi-repo`** 额外有 `require("@just-genius/dsh-plugin-runtime/client")`：共享包泄漏。其 `tsdown.client.config.ts` 只 `alwaysBundle` 了 ui，没有 runtime。

`dsh-multi-repo` 的 inject 含 `@deepseek-ai/dsh-client-ui-primitives`，但当前 `lib/client.js` **没有** `require` 该 specifier，故不会触发「必须用 ui 替换」那条。synapse 源码会 `require` primitives，但被本脚本跳过。

验证阶段实测：`node scripts/check-client-modules.mjs` **退出码 1**，仅 multi-repo 这一条泄漏。

### 6.6 tsdown 约定与变体

**标准双配置**

| 文件 | 典型设置 |
| --- | --- |
| `tsdown.config.ts`（host） | entry `src/index.ts`；`format: 'esm'`；`platform` 多数为 `'node'`，**`dsh-codex` / `dsh-desktop-update` / `dsh-model-custom-ex` 为 `'neutral'`**；`dts: true`；`outDir: 'lib'`；`deps.neverBundle: true` |
| `tsdown.client.config.ts`（browser） | entry `src/client/index.tsx` 或 `index.ts`；`format: 'cjs'`；`platform: 'browser'`；banner/footer 包进 `window.__ModuleLoader__.load({ id, factory })`；`alwaysBundle` ui（及通常 runtime） |

**已见变体（单独成行，不粉饰）**

| 变体 | 包 | 事实 |
| --- | --- | --- |
| 额外 host entry / export | `dsh-codex` | host tsdown entry 含 `side-panels: src/side-panels.ts`；`exports["./side-panels"]` → `lib/side-panels.js` |
| 额外 overlay 配置 | `dsh-whale-girl` | `tsdown.overlay.config.ts`：`src/client/overlay.ts` → IIFE `lib/overlay.js`；build 还 `cp src/overlay.html` |
| `test/` | `dsh-flow` | `test/*.test.ts` + `"test": "pnpm -w exec vitest run --config ./vitest.config.ts"` |
| `test/`（JS 例外包） | `dsh-synapse` | `test/*.test.js` + `"test": "node --test test/*.test.js"` |
| `assets/` | `dsh-whale-girl` | 角色图与 HUD，写入 `files` |
| 纯 JS 根入口 | `dsh-synapse` | 无 tsdown；`index.js` / `client.js` / `app.js` |
| client 入口 `.ts` 而非 `.tsx` | `dsh-model-custom-ex`、`dsh-plugin-config` | `tsdown.client` entry 为 `src/client/index.ts` |
| 未 alwaysBundle runtime | `dsh-multi-repo` | client 配置仅 bundle ui；当前 `lib/client.js` 泄漏 runtime require |
| 未 alwaysBundle ui | `dsh-wechat-chat` | client 配置只 bundle runtime；ui 仅作 tsdown 的 `dshCssModules` 构建插件 |
| host `platform: 'neutral'` | `dsh-codex`、`dsh-desktop-update`、`dsh-model-custom-ex` | 其余标准插件 host 为 `'node'` |
| 包内 scripts | `dsh-codex` | `scripts/test-watch.mjs`、`scripts/probe-commit.ts` |
| 共享包单配置 | runtime / ui | 各自一份 `tsdown.config.ts`（ui 为双 entry 数组：组件库 + css-modules） |

---

## 7. Q5 依赖约束

### 7.1 `AGENTS.md` 原文规则

全文一句：

> When creating a plugin, check whether each required package dependency already has a shared layer under `packages/`, and use that shared layer instead of depending on official packages directly.

即：新插件先看 `packages/` 是否已有共享层，有则复用，禁止直接依赖官方包。

### 7.2 门禁硬规则（可执行复述，不只引用 AGENTS）

1. **插件必须** `dependencies["@just-genius/dsh-plugin-runtime"] === "workspace:*"`。synapse 不满足。
2. **插件的** `dependencies` / `devDependencies` / `peerDependencies` **禁止**出现 `@deepseek-ai/*`。inject 数组里的官方包名不算 npm 依赖，脚本不读 inject。
3. **插件源码**（排除 `lib/`、`node_modules/`）禁止直接 `import` / `require` / `from` / `declare module` `@deepseek-ai/`。当前违反：synapse `client.js`、`dsh-codex/scripts/probe-commit.ts`。
4. **`packages` 内** `@deepseek-ai/dsh-*` 必须钉 `0.1.1-rc.2`，例外仅 `dsh-client-schema-form` → `0.1.0-rc.7`。当前 runtime 清单符合钉版本；例外包未被任何 package.json 引用。
5. **client `require()`**（仅扫描已存在的 `lib/client.js`、仅双引号）：必须落在 `dsh.client.inject` 或平台种子 `react` / `react-dom` 上；`@just-genius/dsh-plugin-*` 不得出现在 client `require`；官方 primitives specifier 必须由 ui 包替换（即不应再 `require` primitives）。

### 7.3 inject 与「源码不得直连官方包」如何并存

- **`dsh.client.inject` 是运行时模块表**，告诉宿主 `window.__ModuleLoader__` 工厂里的 `require` 可以解析哪些官方包。它不是 npm 依赖，不出现在 `dependencies`，因此不违反规则 2。
- **源码**应 `import` `@just-genius/dsh-plugin-runtime` / `@just-genius/dsh-plugin-ui`。client tsdown 把 runtime/ui **打进** bundle（`alwaysBundle`），官方 client 包保持 external，编译后变成 `require("@deepseek-ai/…")`，由 inject 在运行时提供。
- **ui 包**在构建期打进插件，所以 client bundle 不应再 `require("@just-genius/dsh-plugin-ui")`，也不应再 `require` 官方 primitives。

张力（R4）：`dsh-multi-repo` inject 声明了 primitives，但当前产物未 `require` 它；同时未 bundle runtime，产物泄漏了 `@just-genius/dsh-plugin-runtime/client`。`dsh-synapse` 源码 `require` primitives，inject 却只声明了 `@deepseek-ai/dsh-client-runtime`，且 client 门禁因无 `lib/client.js` 跳过。

---

## 8. Q6 典型插件目录约定

### 8.1 README「What a plugin is」两半模型

| 半边 | 源 | 输出 | 角色 |
| --- | --- | --- | --- |
| node | `src/index.ts` | `lib/index.js` | Host 入口（纯 UI 插件常常是空 `apply`） |
| browser | `src/client/index.tsx` | `lib/client.js` | Browser 入口，经 `window.__ModuleLoader__.load({ id, factory })` 注册，在 `apply` 里用 `ctx.slots.register` 挂 React UI |

synapse 对应关系改为根 `index.js` / `client.js`，但仍用同一 `__ModuleLoader__` 包装（`id: 'dsh-synapse'`）。

### 8.2 标准骨架（新建应对齐）

```
plugins/<folder>/
├── package.json
├── tsconfig.json              # extends ../../tsconfig.base.json，include: ["src"]
├── tsdown.config.ts           # host
├── tsdown.client.config.ts    # browser
├── cordis.patch.yml
├── src/index.ts
└── src/client/index.tsx       # 或 index.ts
```

### 8.3 `package.json` 关键字段

- `name`: `@just-genius/dsh-<name>`
- `type`: `module`
- `main` / `types`: `lib/index.js`、`lib/index.d.ts`
- `exports`: `"."`、`"./client"`、`"./package.json"`
- `dsh.client`: `{ "platform": "web", "inject": [ /* 宿主提供的官方 client 包名 */ ] }`
- `dsh.bundle.patch`: `"./cordis.patch.yml"`
- `files`: `lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`lib/**/*.d.ts`
- `dependencies`: `"@just-genius/dsh-plugin-runtime": "workspace:*"`
- `devDependencies`: `"@just-genius/dsh-plugin-ui": "workspace:*"`（需要 UI 时）
- 三区均无 `@deepseek-ai/*`
- `scripts`: `build` / `watch` / `typecheck` / `clean` 与根编排对齐

### 8.4 合法变体（必须单独成行）

1. **额外 tsdown**：`dsh-whale-girl` 的 overlay 配置。
2. **额外 export**：`dsh-codex` 的 `./side-panels`。
3. **`test/`**：`dsh-flow`、`dsh-synapse`。
4. **`assets/`**：`dsh-whale-girl`。
5. **纯 JS 根入口**：`dsh-synapse`（无 `src/`、无 `@just-genius` scope、无 runtime、无 typecheck）。
6. **client 入口 `.ts`**：`dsh-model-custom-ex`、`dsh-plugin-config`。
7. **包内辅助 scripts**：`dsh-codex/scripts/`（`test-watch.mjs`、`probe-commit.ts`；后者直 `require` 官方包，依赖合约会失败）。
8. **未 alwaysBundle ui**：`dsh-wechat-chat`。
9. **host platform `neutral`**：`dsh-codex`、`dsh-desktop-update`、`dsh-model-custom-ex`。

### 8.5 新建插件最低对齐清单

1. 放在 `plugins/<folder>/`，自动成为 workspace 成员。
2. 复用 `@just-genius/dsh-plugin-runtime`（`dependencies`: `workspace:*`）。
3. 需要 UI 时复用 `@just-genius/dsh-plugin-ui`（`devDependencies`: `workspace:*`），client tsdown `alwaysBundle` ui（建议同时 bundle runtime，避免泄漏 `require`）。
4. 不把 `@deepseek-ai/*` 写入任何 npm 依赖区；源码不直 import / require 官方包。
5. 声明 `dsh.client`（`platform: web` + 运行时需要的 `inject`）。
6. 提供 `dsh.bundle.patch` → `cordis.patch.yml`。
7. 实现 `build` / `watch` / `typecheck` / `clean`，host + client 双 tsdown，入口落到 `lib/index.js` 与 `lib/client.js`。
8. 官方 API 版本只跟 runtime 边界走，不要在插件里自钉 `@deepseek-ai/dsh-*`。

---

## 9. 对新插件作者的导航建议

1. 先读根 `README.md` 的「What a plugin is」和 `AGENTS.md`，再读 `packages/ui/README.md`。
2. 抄最近的标准包（如 `dsh-memory` / `dsh-debug-mode`）做骨架，不要抄 `dsh-synapse`。
3. host 逻辑从 `@just-genius/dsh-plugin-runtime/host` 取类型与适配；browser 从 `…/client` 取，UI 从 `@just-genius/dsh-plugin-ui` 取。
4. 改完后在仓库根跑 `pnpm typecheck`（先合约再 tsc）和 `pnpm build`（先构建再 client 表）。确保本包产出 `lib/client.js`，否则 client 门禁会跳过你。
5. 需要 overlay / 额外 export / 测试目录时，对照 §8.4 已有变体，而不是另起一套入口约定。
6. 不要在本仓库 `apps/` 下建插件（它不是 workspace）。不要依赖 README 里尚未落地的 `dsh-notify-jump` / `dsh-session-archive`。

---

## 10. 已知偏差附录

| ID | 事实 |
| --- | --- |
| R1 文档 vs 磁盘 | README 列了 `dsh-notify-jump`、`dsh-session-archive`，磁盘无目录。磁盘有 `dsh-synapse`，README 插件列表未点名。以磁盘为准。 |
| R2 synapse / 源码合约与门禁 | **依赖合约会扫到 synapse**：缺 `workspace:*` runtime；`client.js` 直 require 官方 primitives。**另扫到** `dsh-codex/scripts/probe-commit.ts` 的官方 `require`。**client 模块表会跳过 synapse**（无 `lib/client.js`）。根 `typecheck` 的 `-r` 段因无 `typecheck` script 而跳过 synapse。 |
| R3 `apps/` | 空目录，未进 workspace，无 README/注释。意图 **未知**，不臆造产品规划。 |
| R4 inject vs primitives | `dsh-multi-repo` inject 含 primitives，当前 `lib/client.js` 未 require 它；同文件 require 了 runtime/client，与「共享包不得泄漏」冲突。synapse 源码 require primitives，inject 未声明该包，且 client 检查跳过。 |
| R5 合约是否当前通过 | **未跑**完整 `pnpm typecheck`（合约之后的 `-r tsc`）/ `pnpm build`（各包 tsdown）。验证阶段已跑两道门禁：`check-dependency-contracts` 退出码 **1**（synapse ×2 + `probe-commit.ts`）；`check-client-modules` 退出码 **1**（仅 `dsh-multi-repo` 泄漏 runtime require；synapse 被跳过）。 |
| 其他 | 根无 `tsconfig.json`。runtime 无 README、无 `watch`。ui 无 `watch`。`.cursor/` 空。`DSH_LATEST` 例外表中的 schema-form 当前无包引用。 |

---

## 11. 无法从磁盘单独闭合的项

- `apps/` 的产品意图（无权威注释）。
- 全量 `pnpm build` / `pnpm typecheck`（含各包 `tsc`）的退出码。两道门禁脚本已单独跑过，见附录 R5。
- 幽灵包是否曾存在于 git 历史（需求排除 `.git` 历史）。
- `dsh-client-schema-form` 例外是否仍会被未来代码用到（脚本有常量，清单无引用）。
