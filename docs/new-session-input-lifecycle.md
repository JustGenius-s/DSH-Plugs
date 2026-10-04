# 新建会话输入框禁用：生命周期修复

## 2026-09-16：新建无响应是另一条故障链

本次继续排查的是使用 computer use / browser use 后，点击“+ 新建会话”没有反应。
下文的 `removed` 生命周期修复只处理已创建会话的输入框禁用，不能解决这次的
Host 创建失败。

本机实际安装的 `0.1.6-alpha.1` 存在两份 `@deepseek-ai/dsh-scope`：

- Host 的 `dsh-tools` 从 runtime 的 pnpm 依赖目录加载。
- 浏览器插件从 `profiles/web/node_modules` 加载另一个同版本实体目录。

`dsh-scope` 用模块内的 Symbol 和 WeakMap 标记作用域，相同版本不等于同一实例。
`dsh-experimental-browser-use-runtime/lib/types/mcp.js` 用 profile 的 `createScope`
创建浏览器会话作用域；Host 的工具注册器无法识别这个标记，把工具写入全局。
第二次注册同名 `mcp__playwright-mcp__browser_close` 时抛出 `already registered`。
官方 `UiWorkspaceService.startSession()` 又只在控制台记录这个错误，
因此用户看到的是“点击无响应”。computer use 是现场线索；这里确定复现的是
浏览器 MCP 的作用域冲突，不把其他故障都归因于它。

### 本轮修复

- `packages/runtime/src/profile-singletons.ts` 从实际 DSH 安装和 tools 所有者解析
  Host 作用域包，只合并同版本重复实例。先验证可创建链接，再移动旧目录或链接，
  替换失败会尝试回滚。原始内容保留在 profile 的 `.dsh-singleton-backups`。
  相对符号链接按原样备份，回滚时应移回原位置，不能从备份位置直接加载。
- `plugins/dsh-plugin-config/src/profile-manager.ts` 在启动及安装、卸载、更新后检查
  作用域身份。失败或超时的操作也检查；不覆盖原命令错误，修复后标记需要重启。
- `plugins/dsh-workspace-plus/src/client/navigation-feedback.ts` 观察共享的
  `openWorkspace` 命令，覆盖官方“+”入口，通过现有 Toast 显示错误。
  保留原来的导航、空会话复用和异常传播；卸载时恢复方法，忽略过期回调。

已将同样的修复应用到本机 profile，未升级依赖、未改官方包源码、未改用户会话。
修复后的独立进程确认 Host、browser runtime、MCP client 解析到同一模块；
两个作用域可注册同名工具，工具不进入全局，释放第一个作用域不影响第二个。

**仍须完整退出并重新打开 DSH-Desktop。仅刷新页面不够。**
磁盘链接修复不会清除正在运行的 Host 的 ESM 缓存或已泄漏的全局工具。
本轮没有主动中断用户的 DSH 进程，也未声称已验证重启后的交互界面。

### 本轮验证

使用桌面应用自带 Node `26.8.2`，不启动浏览器、不渲染组件、不创建真实用户会话：

- runtime Vitest：35/35。
- runtime Node：31/31，其中实际安装宿主契约测试 10 项。
- plugin-config：12/12。
- workspace-plus：137/137。
- computer-tools：88/88。
- runtime、plugin-config、workspace-plus 构建和类型检查通过。
- 客户端模块清单检查、`git diff --check` 通过。
- 全仓依赖门禁仍被既有 `dsh-synapse` 共享依赖边界违规阻塞，未改该插件。

新增宿主契约测试使用临时 profile 和实际安装的 `ToolRuntime`、`dsh-scope`、
`UiWorkspaceService`。分别在独立进程中验证重复包故障和修复结果，避免把已缓存的
模块当成重启后的状态；同时验证官方 void 新建入口的错误提示及失败后的再次创建。
没有 `DSH_HOST_MODULE_ROOT` 时，宿主契约测试显式跳过。

```sh
DSH_HOST_MODULE_ROOT="$HOME/.dsh/profiles/node_modules/@deepseek-ai" \
  pnpm --filter @just-genius/dsh-plugin-runtime test:host
pnpm --filter @just-genius/dsh-plugin-config test
pnpm --filter @just-genius/dsh-workspace-plus test
```

## 结论与证据边界

本机 DSH `0.1.6-alpha.1` 的客户端控制器存在确定性的会话恢复缺口：
持久化会话在 Host 内存中被释放后，会被前端标记为 `removed`。该会话随后重新出现在
`session.list` 或 `api-session/added` 中，原客户端对象仍保持 `removed=true`。
官方工作区导航会复用符合 cwd、未归档且 blank 的会话，并不检查这个残留标记。
因此会选中已有空会话，却一直禁用输入框、模型和权限控件。

现场复现了上述三个控件同时禁用，工作区名称正确；只刷新前端即可恢复，后端进程未重启。
刷新前未捕获完整事件流，因此不能进一步断定是哪个插件重载或哪次 Host 释放触发了事件。
本次修复针对已通过实际宿主函数稳定复现的生命周期缺口，不声称排除了所有其他禁用原因。

## 调用链

```text
Host session/disposed
  -> ApiSessionController emits api-session/removed
  -> SessionManager.handleSessionRemoved
       removes list summary
       sets resident Session.removed = true
       deletes the manager's projection store
  -> authoritative session.list / api-session/added restores the summary
       existing Session object remains removed
  -> UiWorkspaceService.connectWorkspace reuses the blank, unarchived session
  -> InputBar sees removed=true and disables the composer
```

原 Session 和作用域会保留，尤其是当前选中会话跨列表空档时。删除 manager 的投影缓存
还会造成第二个问题：后续控制帧写入新缓存，而输入框原有的模型投影订阅仍指向旧缓存。
仅重置禁用样式或创建一个新会话并不能完整修复这个生命周期。

一手实现位置（安装包内路径）：

- `dsh-api-session-controller/lib/types/index.js`：`session/disposed` 转发为移除事件。
- `dsh-api-session-controller/lib/types/client/sessions/manager.js`：
  `handleSessionRemoved`、`handleSessionAdded`、`refreshList`、`projectionStore`。
- `dsh-api-session-controller/lib/types/client/sessions/service.js`：
  `followCurrent`、`pruneScopes`、`sweepDeferred` 保留当前会话作用域。
- `dsh-api-session-controller/lib/types/client/sessions/session.js`：
  `handleRemoved` 的 sticky 标记及 `resync` 的历史流重建。
- `dsh-client-ui-workspace/lib/client.js`：`UiWorkspaceService.connectWorkspace` 的 blank 复用。
- `dsh-client-ui-conversation/lib/client.js`：`InputBar` 的 `removed` 禁用条件。

## 修复边界

实现位于 `packages/runtime/src/session-revival.ts`，由 workspace-plus 的客户端 effect 安装。
这是对已验证宿主结构的可卸载兼容适配，不修改已安装的官方包，也不依赖直接升级依赖。

- 移除事件仍立即生效。没有服务端的正向确认，不解除 `removed`。
- 只有成功的列表刷新（包含请求期间移除事件的重放结果）或新增事件可以恢复同一对象。
- 恢复保留会话对象、作用域与输入草稿，不重复创建会话、不自动发送消息。
- 保留 resident Session 的模型/标题投影源；后续更新与既有订阅维持同一身份。
- 使用宿主 `resync` 重建历史传输。失败记录警告，不重试发送、不丢弃草稿。
- 真正删除的会话不恢复。作用域被丢弃时释放临时保留的投影。
- 归档仍由原工作区导航排除；不修改归档集合、会话顺序或持久化记录。
- 子代理的持久化地址与 parent-offline 语义仍走宿主逻辑。
- 接口不匹配、不可写或冻结的宿主不安装补丁。最后一个使用者卸载时恢复原方法，
  不覆盖其它插件随后安装的 wrapper，未完成请求不会在卸载后继续修复。

## 回归验证

逻辑测试：

```sh
pnpm --filter @just-genius/dsh-plugin-runtime test
pnpm --filter @just-genius/dsh-workspace-plus test
```

实际宿主契约测试（Node 24+；路径指向需要验证的已安装 `@deepseek-ai` 模块目录）：

```sh
DSH_HOST_MODULE_ROOT="$HOME/.dsh/profiles/node_modules/@deepseek-ai" \
  pnpm --filter @just-genius/dsh-plugin-runtime test:host
```

契约测试从安装包 JavaScript AST 定位模块导出边界，在隔离 VM 中暴露原控制器与导航类。
控制器、状态机、投影和工作区复用逻辑均为实际安装代码；只替换网络、通知基础设施及
未使用的 UI 依赖。不渲染组件、不读写用户会话、不启动浏览器。
不设置 `DSH_HOST_MODULE_ROOT` 时该组测试显式跳过，不冒充已完成宿主验证。

覆盖：原故障复现、列表恢复、新增事件恢复、模型投影身份、真实删除、失败请求、
列表响应与移除事件竞态、子代理移除、归档排除，以及补丁重入/卸载/旧请求返回。

首轮验证结果（输入框禁用修复）：

- runtime Vitest：26/26（其中新增修复用例 19 项）。
- runtime Node 测试：29/29（其中实际安装宿主契约测试 8 项）。
- workspace-plus：130/130。
- runtime 与 workspace-plus 的构建、类型检查通过。
- 客户端模块清单检查与 `git diff --check` 通过。
- 全仓检查并非全绿：`dsh-synapse` 未接入共享依赖边界，依赖门禁失败；
  `dsh-quick-notes/src/index.ts:51` 的字符串参数不满足 `SettingsNamespace`，全仓类型检查失败。
  这些不相关的现有功能未在本次修复中修改。

## 后续宿主升级

每次升级宿主后重新执行契约测试。第一项保存原缺陷的复现断言；若新版已原生修复，
它应失败并提示重新评估兼容适配，其余行为测试用于判断能否删除补丁。
不要通过无条件清除 `removed`、跳过权限/模型阻塞或强制新建会话绕过此问题。
