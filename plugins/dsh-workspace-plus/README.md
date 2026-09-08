# @just-genius/dsh-workspace-plus

工作区增强：一个工作区挂多个文件夹，加上工作区/会话行的右键与双击菜单。

前身是 `dsh-multi-repo`（多文件夹工作区），现在把 dsh-workspace-menu 的菜单能力
也并了进来，两个插件不再需要同时安装。

## 多文件夹工作区

1. 点「添加工作区」先弹本插件窗口
2. 点「添加文件夹」才打开访达 / 系统选择器，每次加一个目录
3. 第一个文件夹默认是主仓；可随时改。主仓是官方 workspace、会话 cwd 和 workspace-write 范围
4. 其它文件夹仍算工作区范围（可读、可协调），写文件走工具拒绝后再申请放行
5. 绑定写进 `~/.dsh/workspace-plus/bindings.json`，并注入系统提示：列出全部文件夹，并说明可写范围只跟主仓
6. 侧栏工作区行悬停列出全部路径（主仓在前）；点行上的编辑按钮改名称、文件夹和主仓
7. 工作区折叠且其中有会话进行中时，项目行显示进行中圆点

## 行菜单

Project / 工作区行（双击或右键）：

- 置顶 / 取消置顶
- 重命名
- 在资源管理器中打开
- 复制路径
- 新建会话
- 从工作区列表中移除（保留磁盘）

Chat / 会话行（双击或右键）：

- 置顶 / 取消置顶
- 重命名
- 标记未读 / 已读
- 归档会话
- 分叉会话
- 复制会话链接
- 复制会话标题
- 在新窗口中打开
- 打开所在目录

每一项都能在 DSH 设置 → 通用设置 → 工作区增强 里单独关掉。

**不做永久删除。** 会话只提供归档，不提供「删除会话（含磁盘记录）」；
工作区只提供「从列表中移除」，不删除磁盘目录。

## 使用

```sh
dsh plugin --profile web add ./plugins/dsh-workspace-plus
```

装完**重启 DSH web**。

## 布局

| Half | Source | 做什么 |
| --- | --- | --- |
| node | `src/index.ts` | 采纳文件夹、绑定存储、系统提示、`/dsh-workspace-plus/*` |
| browser | `src/client/index.tsx` | 拦截 `workspaces.create`、添加/编辑窗口、侧栏行装饰、行菜单 |

## 说明

- “在资源管理器中打开”由 Host 调用系统文件管理器：Windows 用资源管理器，macOS 用 Finder，Linux 自动选择 `xdg-open` / `gio` / 常见文件管理器。路由带 Host/Origin 信任围栏。
- 置顶和未读状态存在浏览器 localStorage（`dsh-workspace-plus:v1`）。
- 新窗口打开依赖 `?session=<id>` 深链。
- 从 `dsh-multi-repo` 升级：首次加载会把 `~/.dsh/multi-repo/projects.json` 复制成新存储，旧文件保留不动。
