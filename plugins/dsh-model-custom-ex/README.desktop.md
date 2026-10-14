# Model Custom Ex for DeepSeek Harness Desktop

适配已安装的官方 Desktop 0.1.7-rc.2。基于当前安装版本的官方模型编辑器构建，在“设置 → 模型 → 编辑”的模型行中加入思考强度、默认思考强度和容量预设。直接使用官方 Button、Input、Menu、Pill 组件与模型页样式。

## 功能

- 思考强度：直接多选 off / minimal / low / medium / high / xhigh / max；保留已有强度的自定义协议值，新增 off 写入 null，全部取消选择表示不支持思考。不再增加单独的思考等级或模式设置。
- 每个模型的默认思考强度：单独保存于 dsh-model-custom-ex.defaults；“跟随模型推荐”移除插件覆盖。只有当前模型支持的覆盖值才会生效。用于新会话及切换模型，已有会话的显式强度选择保持不变。
- 上下文窗口预设：32K、64K、128K、256K、272K、373K、512K、1M、2M。
- 最大输出预设：4K、8K、16K、32K、64K、128K。两个容量字段也支持自由输入及清空以继承配置。K=1000、M=1000000；预设只是输入快捷项，需要按模型实际限额选择。
- 视觉输入等模型能力继续使用官方编辑器，保留官方账号接入插槽和模型管理流程。新增选择与模型参数共用官方“保存”；点击“取消”丢弃本次草稿。
- 保存检查配置版本冲突。模型参数和默认强度分属两个命名空间；若第二步失败，页面明确提示已保存部分，重试只提交剩余修改。

## 构建

需要 Node >=22.19 和仓库依赖。读取已安装 Desktop 的官方模型页和 Schema 运行时构建独立包；不修改 Desktop 的 app.asar。由于官方没有模型字段扩展插槽，构建过程对当前官方编辑器做少量定点补充。源代码结构变化时构建会报错，避免静默错位。

~~~powershell
$env:DSH_DESKTOP_EXECUTABLE = 'E:/deepseek harness/DeepSeek Harness.exe'
pnpm --filter @just-genius/dsh-model-custom-ex run typecheck
pnpm --filter @just-genius/dsh-model-custom-ex run test:desktop
pnpm --filter @just-genius/dsh-model-custom-ex run build:desktop
node --test plugins/dsh-model-custom-ex/test/desktop-package.test.mjs
~~~

产物位于 lib/desktop，包含服务端、客户端、桌面补丁、安装说明、上游版本及 SHA-256（UPSTREAM.json）和内嵌依赖许可证，不依赖 workspace 包链接。

## 安装和使用

1. 将 lib/desktop 的完整内容复制到稳定目录，例如 ~/.dsh/plugins/model-custom-ex-desktop。
2. 打开官方桌面端“设置 → 插件 → 添加插件”，输入稳定目录的绝对路径，安装后启用。
3. 打开“设置 → 模型”，点击提供商的“编辑”。模型行默认展开，直接调整容量预设、思考强度和默认思考强度，再点击官方“保存”。

桌面端使用自己的 desktop profile。Desktop 包的补丁会停用原 ui-settings-models 节点，由基于当前官方版本构建的增强编辑器提供同一个模型页，避免重复注册。不要使用本插件根目录的旧版 cordis.patch.yml，也不要把旧 Web profile 的整个配置覆盖到 Desktop。该构建使用 cordis.desktop.patch.yml，安装包中的文件名为 cordis.patch.yml。

卸载时在官方插件管理页移除本插件及其 bundle，使桌面配置重新组合并恢复官方模型页；仅停用插件服务但保留 bundle 补丁可能仍会停用原模型页。容量和思考能力保存在 llm-pi-ai 配置中，默认强度覆盖由本插件启用时生效。

## 维护

- src/desktop/client.tsx：使用实际官方组件创建控件，并绑定编辑器草稿。
- src/desktop/editor-state.ts：强度选择、默认值草稿、冲突和保存接口。
- scripts/patch-official-editor.mjs：基于安装版本的官方编辑器做定点补充，保留官方页面布局和原有插槽。
- src/desktop/index.ts：新版 volatile 配置声明；src/desktop/default-resolver.ts：默认强度元数据覆盖及停用恢复。
- test/：纯函数、接口和独立包校验；不渲染组件或断言 DOM。

根目录旧 Web 构建仅供旧版 Web 运行时使用。Desktop 升级后应针对新安装版本重新构建，并验证官方编辑器、远程接口和配置 Schema。
