# 代码仓库结构调研 — 需求验证

对照：`docs/repo-structure-requirements.md` §3 问题清单、§5 成功标准 S1–S15  
正文：`docs/repo-structure.md`  
磁盘：`/Users/morisi/Space/DSH-Plugs`（跳过 `node_modules/`、`.pnpm-store/`；`lib/` 只核入口与门禁）

验证方式：只读核对正文与磁盘；单独执行两道门禁脚本（未跑完整 `pnpm build` / `pnpm -r typecheck`）。不改业务/构建代码。发现事实错误已改正文。

---

## 1. 成功标准核对表（S1–S15）

以**修正后**的 `docs/repo-structure.md` 为准。

| ID | 结果 | 正文位置 | 核对说明 |
| --- | --- | --- | --- |
| S1 | 通过 | 文首、§4 职责表、§9 | 仓库地图：职责一句话，无插件教程、无重构方案 |
| S2 | 通过 | §1.1 | 根下除 `node_modules`、`.pnpm-store` 外 17 项均列出并标角色，与 `ls` 一致 |
| S3 | 通过 | §1.2 | `pnpm-workspace.yaml` 仅 `plugins/*`、`packages/*`；`apps/`、`public/`、`scripts/`、`docs/` 标明非包 |
| S4 | 通过 | §2.1、§3.2 | plugin 表 12 行 = 磁盘 `plugins/*` 一级目录，一行一个 |
| S5 | 通过 | §3.1、§5 | `packages/runtime`、`packages/ui` 各一行，含 npm name 与职责；磁盘仅此两目录 |
| S6 | 通过 | §3.2 | 每插件标有 client，并写 ① `dsh.client` ② 入口 ③ `cordis.patch.yml`；12 包磁盘三项均在 |
| S7 | 通过 | §3.2、§8 | 标准包 `src` → `lib` + `main`/`exports`；synapse 单独写根 `index.js` / `client.js` |
| S8 | 通过 | §6.1–6.3 | 根六脚本均解释并指向 `scripts/*.mjs`；缺 script 时 `pnpm -r` 跳过语义已写 |
| S9 | 通过 | §6.4–6.5、§7 | 复述 `workspace:*` runtime、禁插件直依/直 import、`DSH_LATEST`、例外表、client `require`/`inject`；已补 `probe-commit.ts` |
| S10 | 通过 | §5.3 | 11 包 runtime+ui；仅 synapse 两者都无；ui 为 `devDependencies` |
| S11 | 通过 | §1.5 | 根无 `tsconfig.json`；基座选项与各包 `extends` / 覆盖分组与磁盘一致 |
| S12 | 通过 | §3.3–3.4 | 幽灵包 `dsh-notify-jump`、`dsh-session-archive`；磁盘遗漏点名 `dsh-synapse`。README「Plugins」13 个标题，无 synapse |
| S13 | 通过 | §3.2 synapse 行、§6.6、§8.4 | synapse 标例外并列缺项；变体单独成行（含 wechat 未 bundle ui、三包 host `neutral`） |
| S14 | 通过 | 全文 | 中文；`node_modules` / `.pnpm-store` / `lib` 内容不当结构主体 |
| S15 | 通过 | §1–§8 | Q1–Q6 均有对应章节/表，无「见源码」空答 |

**成功标准：15 通过 / 0 失败**（修正后）。

---

## 2. §3 问题清单闭合

| 问 | 结果 | 说明 |
| --- | --- | --- |
| Q1 | 通过 | 根项、workspace、根 package、`.npmrc`、TS 基座均与磁盘一致 |
| Q2 | 通过 | 12 插件枚举、name/version/职责、入口/`dsh.*`/脚本、幽灵包与遗漏包、synapse 例外 |
| Q3 | 通过 | 仅 runtime/ui；exports；谁可直依官方包；依赖方向；钉版本与例外表 |
| Q4 | 通过 | 六脚本、先后关系、缺 script、两道门禁范围/跳过/硬规则、tsdown 变体 |
| Q5 | 通过 | AGENTS 原文 + 可执行硬规则 + inject 并存说明 |
| Q6 | 通过 | 两半模型、骨架、`dsh.*`/`exports`/`files`、变体、新建清单 |

---

## 3. 清单与磁盘抽查

### 3.1 插件 12 = 12

| 目录 | name / version | 与正文 |
| --- | --- | --- |
| `dsh-codex` | `@just-genius/dsh-codex` 0.2.1 | 一致 |
| `dsh-debug-mode` | `@just-genius/dsh-debug-mode` 0.1.0 | 一致 |
| `dsh-desktop-update` | `@just-genius/dsh-desktop-update` 0.2.0 | 一致 |
| `dsh-flow` | `@just-genius/dsh-flow` 0.1.0 | 一致 |
| `dsh-memory` | `@just-genius/dsh-memory` 0.1.0 | 一致 |
| `dsh-model-custom-ex` | `@just-genius/dsh-model-custom-ex` 0.1.0 | 一致 |
| `dsh-multi-repo` | `@just-genius/dsh-multi-repo` 0.1.0 | 一致 |
| `dsh-plugin-config` | `@just-genius/dsh-plugin-config` 0.1.0 | 一致 |
| `dsh-synapse` | `dsh-synapse` 0.4.1 | 一致 |
| `dsh-sync` | `@just-genius/dsh-sync` 0.1.0 | 一致 |
| `dsh-wechat-chat` | `@just-genius/dsh-wechat-chat` 0.1.0 | 一致 |
| `dsh-whale-girl` | `@just-genius/dsh-whale-girl` 0.1.0 | 一致 |

无 `dsh-notify-jump` / `dsh-session-archive` 目录。

### 3.2 共享包 2 = 2

| 目录 | name / version | 与正文 |
| --- | --- | --- |
| `runtime` | `@just-genius/dsh-plugin-runtime` 0.1.0 | 一致；无 README |
| `ui` | `@just-genius/dsh-plugin-ui` 0.2.0 | 一致 |

### 3.3 门禁实测（验证阶段）

```
node scripts/check-dependency-contracts.mjs  → 退出码 1
  - plugins/dsh-synapse/package.json 缺 workspace:* runtime
  - plugins/dsh-synapse/client.js 直连 @deepseek-ai/
  - plugins/dsh-codex/scripts/probe-commit.ts 直连 @deepseek-ai/

node scripts/check-client-modules.mjs  → 退出码 1
  - @just-genius/dsh-multi-repo 泄漏 require("@just-genius/dsh-plugin-runtime/client")
```

11 个标准包均有 `lib/client.js`；synapse 无，被 client 检查跳过。

---

## 4. 修正项（已写入 `docs/repo-structure.md`）

原稿相对磁盘的事实错误 / 遗漏 / 误导：

1. **依赖合约覆盖不全**：只写 synapse 会使合约失败。磁盘上 `dsh-codex/scripts/probe-commit.ts` 同样命中源码正则。已写入 §6.4、§7.2、§8.4、附录 R2/R5。
2. **host `platform`**：写成「多数 node，仅 codex 为 neutral」。实际 `dsh-desktop-update`、`dsh-model-custom-ex` 的 host tsdown 也是 `neutral`。
3. **ui alwaysBundle**：写成各标准包 client 配置都 bundle ui。`dsh-wechat-chat` 只 bundle runtime，ui 仅用于 tsdown 的 `dshCssModules`。
4. **门禁退出码**：原稿声明未跑。验证阶段已跑两道脚本并回写 R5 / §11（仍未跑完整 `pnpm build` / `-r tsc`）。

未改业务代码。根结构、12+2 清单、name/version、client 三项、workspace 边界、TS 基座分组、README 幽灵/遗漏包等其余断言与磁盘一致。

---

## 5. 剩余风险

| ID | 风险 | 状态 |
| --- | --- | --- |
| R3 | `apps/` 意图未知 | 正文已标未知；无权威注释 |
| R5 残余 | 全量 `pnpm build` / `pnpm typecheck`（含 tsc）未跑 | 两道门禁已实测失败；tsc 段对导航无阻塞 |
| 例外表 | `dsh-client-schema-form` 无包引用 | 脚本有常量；未来消费者未知 |
| 幽灵包 git 史 | 需求排除 `.git` | 未查 |
| synapse 加料 | `.github/`、`docs/`、`styles.css` 等 | 已标例外形态；未当标准骨架展开 |

---

## 6. 总结论

修正后的 `docs/repo-structure.md` **可用于导航该仓库**：能定位 workspace 边界、12 插件 + 2 共享包、入口与 client 判定、根脚本与门禁、以及 synapse / multi-repo / probe-commit / wechat-chat 等合法变体与当前合约失败点。

不要按 README 插件列表当完整清单（缺 synapse、多两个幽灵包）。不要假设根 `pnpm typecheck` / `pnpm build` 当前会通过。
