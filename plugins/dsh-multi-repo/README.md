# @just-genius/dsh-multi-repo

一个工作区可以挂多个文件夹（和 Codex 多仓工作区一样），不扫描 git。

1. 点「添加工作区」先弹本插件窗口
2. 点「添加文件夹」才打开访达 / 系统选择器，每次加一个目录
3. 第一个文件夹默认是主仓；可随时改。主仓是官方 workspace、会话 cwd 和 workspace-write 范围
4. 其它文件夹仍算工作区范围（可读、可协调），写文件走工具拒绝后再申请放行
5. 绑定写进 `~/.dsh/multi-repo/projects.json`，并注入系统提示：列出全部文件夹，并说明可写范围只跟主仓
6. 侧栏工作区行悬停列出全部路径（主仓在前）；点行上的编辑按钮改名称、文件夹和主仓
7. 工作区折叠且其中有会话进行中时，项目行显示进行中圆点

## 使用

```sh
dsh plugin --profile web add ./plugins/dsh-multi-repo
```

装完**重启 DSH web**。然后：

1. 侧栏点添加工作区
2. 点「添加文件夹」选项目目录，可重复添加
3. 需要时点「设为主仓」，再点「打开工作区」
4. 侧栏项目行的编辑按钮可以改名称、文件夹和主仓

## 布局

| Half | Source | 做什么 |
| --- | --- | --- |
| node | `src/index.ts` | 采纳文件夹、绑定存储、系统提示、`/dsh-multi-repo/*` |
| browser | `src/client/index.tsx` | 拦截 `workspaces.create`、添加/编辑窗口、侧栏行装饰 |
