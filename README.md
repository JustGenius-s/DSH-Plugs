# DSH-Plugs

DeepSeek Harness（DSH）插件大仓 —— **一个文件夹 = 一个插件**。

## 目录结构

```
DSH-Plugs/
├── package.json          # 根 workspace（共享构建/类型工具链）
├── pnpm-workspace.yaml   # packages: ['plugins/*']
├── tsconfig.base.json    # 共享 TS 配置
└── plugins/
    └── session-navigator/   # 示例插件（每个插件一个文件夹）
```

## 一个 DSH 插件是什么

一个插件 = 一个 Cordis 插件 npm 包，分两半：

| 半部分 | 源码 | 产物 | 作用 |
| --- | --- | --- | --- |
| node | `src/index.ts` | `lib/index.js` | 宿主侧入口（纯 UI 插件通常是空 `apply`） |
| browser | `src/client/index.tsx` | `lib/client.js` | 浏览器侧入口，经 `window.__ModuleLoader__.load({ id, factory })` 注册，`apply` 里用 `ctx.slots.register` 挂载 React 面板 |

`package.json` 里两处关键声明：

- `dsh.client` —— 声明浏览器侧注入（`inject` 是依赖的 client 包名，`platform: web`）。
- `dsh.bundle.patch` —— 指向 `cordis.patch.yml`，安装后自动把自己的 loader 行 insert 进 profile。

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm build        # 构建所有插件（src → lib）
pnpm watch        # 监听构建
pnpm typecheck    # 类型检查
pnpm clean        # 删除所有 lib/
```

## 新增一个插件

1. 复制 `plugins/session-navigator` 整个文件夹，改成你的插件名。
2. 改 `package.json` 的 `name`（保持 `@just-genius/dsh-*` 前缀）。
3. 改 `src/index.ts`（node 半）与 `src/client/index.tsx`（browser 半）。
4. `pnpm build`。

## 把插件装进 DSH

```bash
# 本地文件夹直接 link 进 profile（相对路径自动锚定到当前目录）
dsh plugin --profile web add ./plugins/session-navigator
```

因为包声明了 `dsh.bundle.patch`，装完会自动加入 profile 的 bundle 层；**刷新网页**即可看到。

卸载：

```bash
dsh plugin --profile web remove @just-genius/dsh-session-navigator
```
