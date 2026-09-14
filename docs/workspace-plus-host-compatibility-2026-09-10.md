# workspace-plus 宿主兼容性补充调研

日期：2026-09-10；本机证据采样时区为 Asia/Shanghai。

范围仅包括多文件夹绑定、adopt、系统提示、打开目录、安装与注入清单、共享 runtime 宿主边界。不调查客户端行、菜单、会话标题或置顶排序。综合报告见 `docs/workspace-plus-compatibility-2026-09-10.md`。

## 结论

1. **不是宿主插件整体未加载。** 实际桌面子进程为 PID 67822，运行 `~/.dsh/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 61155 --no-open`；安装版本为 **0.1.5-alpha.2**。web profile 已包含 workspace-plus 的本仓库链接和 bundle，三个既有 HTTP 端点均能进入方法处理。[安装版本][version] [profile][profile]
2. **多文件夹目前只是插件自有绑定与提示词，不是 DSH 原生多根工作区。** 官方工作区仍只有一个规范化 `path`，会话归属要求其 canonical cwd 与该路径相等；实际写入边界来自会话 cwd 和 sandbox policy，不会随绑定 JSON 自动改变。[绑定写入][bind] [官方工作区][workspace] [权限解析][policy]
3. **已复现的宿主缺陷**：改主目录遗留旧绑定；副目录会话得到错误的 cwd/可写范围提示；绑定接受不合法路径；目录名中的 `{{...}}` 导致官方提示词渲染报错；打开目录在进程启动后即误报成功；自定义路由绕过新版浏览器认证。完整 persona 丢弃插件 section 也是已确认机制，但未确认用户受影响会话是否启用了它。

## 功能兼容性矩阵

“条件缺陷”表示代码和隔离复现已确认，但不意味着用户当前每个会话都触发。

| 功能 | 判定 | 证据与实际边界 |
| --- | --- | --- |
| web profile 安装与宿主加载 | 基本兼容，现场确认 | profile 的 dependency 与 bundles 均包含插件；链接指向本仓库；`lib/index.js` 存在；三个端点 HEAD 返回 405 而非 404。[profile][profile] [插件清单][manifest] |
| 宿主 `inject`、路由注册 | 基本接口兼容 | `systemPrompt`、`webServer` 服务和 exact route 注册仍存在；插件通过共享 `HOST_SERVICES` 使用它们。[插件入口][entry] [共享边界][runtime] [官方路由][webserver] |
| 客户端安装/注入元数据 | 格式兼容，有待核实项 | `platform: web`、`exports["./client"].default` 符合当前宿主扫描契约；`ui-slots` 是无 `./client` 的 pure-core 包，不能仅凭包存在认定有对应客户端插件节点。未据此判定整个插件失活。[manifest][manifest] [扫描规则][modules] [slots 清单][slots] |
| adopt 已存在的绝对目录 | 基本兼容 | 插件仅 realpath + 目录检查，返回 `{name,path}`；不创建官方 workspace，也不自动扫描 Git/兄弟目录。官方注册是独立操作。[adopt][scan] [官方 create][create] |
| 绑定保存与改主目录 | 有确认缺陷 | 直接调用可保存相对/不存在路径；A 改为 B 后，旧 A 绑定仍在。详见下文。[bind][bind] |
| 多文件夹提示词，普通 persona | 接口兼容，语义有缺陷 | `context.agent.session.header.cwd` 仍有效；但副目录会话被绑定主目录覆盖为错误描述，且没有读取实时权限模式。[提示词][prompt] [agent context][agent] [policy][policy] |
| 多文件夹提示词，完整 persona | 条件缺陷 | 官方 `complete: true` 最终仅保留完整 section，workspace-plus section 被丢弃。[完整 section][complete] |
| 子目录 cwd / 路径大小写 | 明确限制/跨平台缺陷 | 查找只匹配目录本身，不继承祖先绑定；路径比较无条件小写，可能合并大小写敏感文件系统上的不同目录。[查找][lookup] [比较][compare] |
| “在文件管理器中打开” | 本地机制可用，结果语义有缺陷 | `spawn` 成功即报告 `opened:true`，未等待命令成功；在服务器上执行，不会打开远端浏览器所在机器的文件管理器。[opener][opener] |
| HTTP 信任与认证 | 已确认不兼容新版认证边界 | binding/open 只有 Host/Origin 检查，scan 连该检查也没有；均未调用 Connection 的 cookie 认证。[路由][routes] [插件信任检查][trust] [官方认证][auth] |
| `DSH_HOME` 与旧存储迁移 | 默认目录兼容，边界不一致 | 默认 `~/.dsh` 一致；插件不按官方规则处理空白、`~` 和相对 home。首次读取可能迁移旧文件，本次未执行真实绑定读取。[存储 home][home-local] [官方 home][home-official] |

## 确认问题与建议

### P1：自定义路由未复用浏览器认证

官方 `webServer` 是纯分发层，认证由 Connection 的路由实施；其 `requestRejection()` 同时检查 Host/Origin 和签名 Cookie。插件复制了旧信任检查，但未复用认证。scan 完全没有该检查，binding/open 的同源检查也不能代替身份认证。[官方路由][webserver] [官方认证][auth] [插件信任检查][trust]

现场只发送 HEAD，无 Cookie，无认证绕过，无状态修改：

| 请求 | 返回 |
| --- | --- |
| `HEAD /api` | 401 |
| `HEAD /dsh-workspace-plus/scan` | 405 |
| `HEAD /dsh-workspace-plus/binding` | 405 |
| `HEAD /dsh-workspace-plus/open-in-explorer` | 405 |
| 跨站 Origin + `sec-fetch-site: cross-site`，HEAD scan | 405 |
| 相同跨站标记，HEAD binding | 403 |

这是认证缺失的证据，**不是“认证阻断插件功能”的证据**。结合 handler 实现，可确认插件没有认证保护；未调用真实写入或打开目录接口。建议在 `packages/runtime` 提供宿主 Connection 适配，在所有既有路由入口统一调用 `connection.requestRejection(req)`，未能获得认证服务时 fail closed。长期可迁移至 `/api/...` 的 `connection.fetch.register()`；其路径必须位于 `/api` 下，不能原样注册现有顶层路径。[官方可复用接口][connection-contract]

### P1：绑定主目录与实际会话工作区混淆

`findBindingForCwd()` 会把副目录 B 上的会话匹配到主目录 A 的绑定；`renderPrompt()` 随后宣称“session cwd / workspace-write 为 A”。官方权限解析实际采用 `session.header.cwd`，仍为 B。read-only 或 danger-full-access 模式下，插件对“主目录可写、副目录须提权”的固定叙述同样不可靠。[查找][lookup] [提示词][prompt] [官方权限][policy]

改主目录也没有更新旧绑定身份：`bindBinding({root:A, primaryPath:B, repos:[A,B]})` 以 B 为新 root，只删除已有 B，未删除输入旧 root A。纯内存复现结果为 `storedRoots: [B,A]`。[bind][bind]

建议把“官方 workspace 身份/会话 cwd”和“用户偏好的主文件夹”分开建模。已有会话的 cwd 不应因 UI 改主文件夹而被暗示已改变；需要新 cwd 时走官方新建工作区/会话流程。绑定更新应使用稳定 binding/workspace 身份或显式 `previousRoot`，在同一存储操作中替换旧记录。提示词只陈述文件夹关联；权限事实复用官方实时 policy，不自行宣称授权。官方 attach 也不能把 cwd=B 的历史会话直接挂到 path=A 下。[官方归属校验][workspace]

### P2：路径校验与提示词插值不一致

- `adoptFolder()` 未先验证 fully-qualified path，真实相对路径可被解析成宿主进程 cwd 下的目录；`bindBinding()` 则连“存在且为目录”也不验证，realpath 失败直接保留原字符串。官方 workspace create 会拒绝相对、不存在、非目录路径。建议 bind 也强制走同一个绝对路径/realpath/目录验证器，错误归类为输入错误，不依赖客户端先 scan。[scan][scan] [bind][bind] [官方规范][canonical]
- `findBindingForCwd('/A/sub')` 对 `/A` 绑定返回 null，是当前精确匹配边界；是否改为祖先匹配需要明确产品语义。若要支持，应使用最长祖先匹配和冲突规则，不能任取第一项。[lookup][lookup]
- `samePath('/A','/a') === true` 已复现，但官方身份规范是 realpath 后字符串相等。不要对全部平台强制 lower-case；至少在共享适配中与官方 canonical path 语义一致。[compare][compare] [canonical][canonical]
- 文件夹显示名或路径含合法文件名文本 `{{repo_name}}` 时，插件直接拼入 section，官方严格插值将它当成变量并报 `unknown prompt variable`。已用插件生成的正文调用实际安装包 `renderPrompt()` 复现。建议把完整文件夹文本作为 `systemPrompt.variable()` 的值，让 section 只引用插件拥有的固定变量；官方变量替换结果不会再次扫描插值。[prompt][prompt] [官方插值][interpolate]

### P2：完整 persona 会压掉工作区 section

实际安装 `SystemPrompt.prototype.assemble` 的隔离调用确认：同时存在 workspace-plus section 和 `complete:true` persona 时，结果只剩 persona。这不是 section API 被删除，也不能通过改 `order:41` 修复。[complete][complete]

建议将这类每会话事实迁入 `systemPrompt.context()`，并尊重 `includeRuntimeContext:false` 的显式关闭，不强行绕过完整 persona。需要纯完整提示词的部署，应由 persona 模板显式引入工作区变量。本次未读取用户 persona 配置，不能断定这是当前具体失效会话的原因。[官方 context][context] [persona 开关][persona]

### P2：打开目录把“进程启动”当作“打开成功”

`spawnOpener()` 在 `spawn` 事件立即 resolve，后续非零 exit 因 `settled` 被忽略。模拟 `spawn -> exit(1)`，对不存在路径调用 handler，仍得到 HTTP 200 和 `opened:true`；没有启动任何真实 OS 进程。Linux 的候选回退因此只能覆盖“进程无法启动”，覆盖不了 `xdg-open` 启动后失败。[opener][opener]

建议先验证路径，明确区分“打开目录”与“定位文件”，等待命令退出结果或返回较弱的 `launched` 语义；Linux 在非零退出时继续后备命令。远程/headless 部署应返回能力不可用或提供可复制路径，不承诺能打开用户本机 Finder。该问题是插件自身错误处理，不是已证实的 DSH opener API 变更。

## 安装与验证边界

- 安装链路符合当前官方约定：profile ordered bundles -> 包 `dsh.bundle.patch` -> Cordis entry；客户端由 entry 对应包的 manifest 与 `./client` 导出发现。插件清单和 bundle patch 没有整体格式失配。[profile][profile] [manifest][manifest] [patch][patch] [官方 boot][boot] [modules][modules]
- 共享 runtime 的官方 peer/dev 类型仍为 `0.1.1-rc.2`，现场宿主为 `0.1.5-alpha.2`。**类型检查通过不等于新宿主运行契约兼容，但版本不同本身也不是已经证明的故障原因。** 优先在共享层增加能力探测和宿主契约测试，不在此次调研更新依赖。[runtime peers][runtime-peers] [version][version]
- `ui-slots` / `client-web-react` 已补查链接和实际解析锚点，**不能从悬空链接推出浏览器缺模块**：
  - 共享层 `~/.dsh/profiles/node_modules/@deepseek-ai/` 下两者均为指向当前 runtime pnpm flat tree 的悬空链接。
  - `createRequire(realpath(anchor)).resolve(...)`：从实际 DSH CLI、ui-workspace、ui-renderer 三个安装包锚点解析两者均 `MODULE_NOT_FOUND`；从 web profile 锚点，`ui-slots` 可解析到本仓库 pnpm 的 **0.1.1-rc.2**，`client-web-react` 仍不可解析。相同四个锚点均可解析当前 **0.1.5-alpha.2** 的 api-workspace-controller。
  - 这是 **Node 解析基线**，不是浏览器 module table。实际安装的模块加载器对 inject 中没有 graph row 的项会跳过；真正的 `require()` 先查静态 seed，再查已物化模块/注册 factory。只有三者都没有才报错。因此“ui-slots 不在动态 graph”本身不足以证明 workspace-plus 失活。[模块加载实现][module-loader]
  - 当前官方 ui-workspace 的 client inject 包含 ui-renderer，而 ui-slots 仅在 devDependencies；profile-local ui-slots 为 pure-core、无 `./client`。应核验构建产物的外部模块请求与实际 seed，再决定如何清理该清单边；本次没有获取受认证保护的 boot graph。[slots][slots] [官方 ui-workspace 清单][workspace-manifest] [模块契约][module-contract]
- 构建与升级时间不一致已确认：本仓库 `lib/index.js`、`lib/client.js` mtime 分别为 **2026-09-09 16:56:04、16:56:05**；实际 `.dsh/runtime/package.json` mtime 为 **2026-09-10 11:05:14**。旧产物跨宿主升级运行，是需要契约验证的事实；重新 build 只能生成产物，不能自动修复被删除/改变的调用，也不能单凭时间差判定根因。
- 未确认而不作为根因：当前会话是否启用 complete persona；真实 `DSH_HOME` 是否使用特殊值；实际重复 apply/HMR 是否触发 section/route 冲突；远程显示环境是否可用。
- 本次验证包括源码核对、6 次只读 HEAD、以 VM 注入内存 fs/模拟 child_process 的函数与 handler 复现、调用实际官方提示词函数。没有浏览器 E2E、依赖更新、真实绑定 API 写入、会话/用户数据修改或生产代码修改。建议后续测试均放包级 `test/`，覆盖函数/接口，不 render 组件、不断言 DOM。

## 证据索引

以下均为本仓库或本机安装的一手源码；链接行号对应此次采样。下列可读取的当前官方包短路径 `/Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/` 已核实指向当前 `.dsh/runtime` 安装；上文单列了悬空链接，以及 profile-local slots 指向仓库旧 devDependency 的例外。

[version]: /Users/jiahaoqian/.dsh/runtime/node_modules/@deepseek-ai/dsh/package.json:4
[profile]: /Users/jiahaoqian/.dsh/profiles/web/package.json:10
[manifest]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/package.json:22
[patch]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/cordis.patch.yml:8
[entry]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/index.ts:24
[runtime]: /Users/jiahaoqian/proj/DSH-Plugs/packages/runtime/src/host.ts:91
[runtime-peers]: /Users/jiahaoqian/proj/DSH-Plugs/packages/runtime/package.json:30
[scan]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/scan.ts:13
[bind]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/store.ts:170
[lookup]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/store.ts:158
[compare]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/shared.ts:84
[home-local]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/store.ts:25
[prompt]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/index.ts:58
[routes]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/index.ts:142
[trust]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/index.ts:433
[opener]: /Users/jiahaoqian/proj/DSH-Plugs/plugins/dsh-workspace-plus/src/index.ts:336
[workspace]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:111
[canonical]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:35
[create]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:365
[policy]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js:132
[agent]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent/lib/index.js:258
[webserver]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:226
[auth]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:552
[connection-contract]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts:83
[complete]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:331
[interpolate]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:103
[context]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:258
[persona]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-persona/lib/index.js:35
[home-official]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js:63
[boot]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:843
[modules]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:637
[module-contract]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules/lib/types/client/manifest.d.ts:38
[module-loader]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:252
[slots]: /Users/jiahaoqian/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-slots/package.json:1
[workspace-manifest]: /Users/jiahaoqian/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/package.json:28
