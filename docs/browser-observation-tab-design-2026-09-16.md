# Browser 观察窗 — 实现设计（看 agent 正在操作什么）

日期：2026-09-16
目标（用户明确）：**这个 tab 服务于 Browser Use，让你看到 agent 正在操作的那个浏览器实例在干什么。**

不是「再开一个浏览器给你上网」，而是 **agent 自己那个浏览器实例的观察窗**。这把设计钉死在一个约束上：**必须是同一个实例**——同一个 Chrome 进程、同一个页面、同一份状态。

配套：[可行性调研](sidebar-browser-tab-feasibility-2026-09-16.md) · [CDP 实验报告](live-browser-side-panel-research-2026-09-16.md)

## 1. 目标决定的三条硬约束

| 约束 | 原因 |
|---|---|
| **同一浏览器实例** | 观察对象就是 agent 那个实例；另起一个看的是空页面 |
| **只读观察即可** | 你的诉求是「看到在干什么」→ 不需要输入回传，复杂度大幅下降 |
| **跟随 tab 切换** | agent 会开新标签/跳转，观察窗得跟着走 |

输入回传（你在面板里点鼠标）**不是当前需求**，可后置 —— 省掉坐标映射、字母箱、光标仲裁一大堆麻烦。

## 2. 结论：只差「给现有 provider 加一个调试端口」

观察窗需要一条**独立于 agent 的只读 CDP 连接**。现在没有，因为 Browser Use 的浏览器带的是 `--remote-debugging-pipe`（进程内 fd，外部连不上）。

但**pipe 与 port 可以并存**（已独立验证，详见可行性文档 §2）。所以唯一要做的事就是：**在现有启动上加 `--remote-debugging-port`**。

**不需要**另起浏览器、**不需要**换 provider、**不需要** fork playwright-mcp。

## 3. 注入路径：已验证的三条

**A. executablePath 指向 shim（最省，已实测）**

provider 现有配置里已经有 `executablePath` 字段，指到一个几行的 shim 即可：

```sh
#!/bin/sh
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=0 "$@"
```

实测：

```
[agent] playwright drives via shim, title: "Example Domain"   ← agent 完全正常
[view ] observer TCP endpoint up: true                        ← 观察通道可用
[view ] observable page targets: 1  https://example.com/       ← 看到的就是 agent 那个页面
```

优点：**零官方包改动**，只用现成配置字段。缺点：多一层 shim 需要管理。

**B. `--config` 注入 launchOptions.args（也已实测）**

stock playwright-mcp 认 `--config`，会转发 `launchOptions.args`：

```
config_launchArgs_honored: true
```

更适合「不改 executablePath、只加参数」的形态。

**C. provider 增加 args 透传字段（上游化方向）**

`BrowserMcpLaunchConfig` 目前无 args 口子，加一个最小透传即可。改动小但属官方包，适合后续推上游。

## 4. 端口发现：`--remote-debugging-port=0` + `DevToolsActivePort`

不要写死端口（多会话会撞）。用 `port=0` 让系统分配，再读该 profile 下的 `DevToolsActivePort`：

```
Q1 DevToolsActivePort exists: true
Q1 discovered port: 57982
Q1 endpoint reachable at discovered port: true Chrome/153.0.8010.48
```

这是 Chromium 的标准契约，比猜端口稳。

## 5. 关联「哪个浏览器属于我这个 Session」——唯一有难度的地方

多 Session 并存时，观察窗必须找到**自己那个**浏览器，不能看错别人的。实测结论：

**每个 Session 有自己的 MCP server 进程，所以浏览器的 `ppid` 就是它的归属。**

```
  browser pid=88051 ppid=88043 port=58449  ppid-is-a-live-MCP-server=true  page=https://example.com/
  browser pid=88150 ppid=88148 port=58464  ppid-is-a-live-MCP-server=true  page=https://example.org/
distinct parents: 2 | distinct browsers: 2
```

建议的关联机制：**shim 落一份 rendezvous 记录**（`exec` 保留 pid，所以 `$$` 就是 Chrome 主进程 pid）：

```sh
printf '{"pid":%s,"ppid":%s,"cwd":"%s","profile":"%s"}\n' "$$" "$PPID" "$PWD" "$UD" > /run/dsh-browser/$$.json
```

host 侧据此匹配 `ppid ∈ 本会话的 MCP server pid`。

**已发现的坑**：
- **会有陈旧记录**：Playwright 启动前跑探测进程，会留下已退出的记录。实测 4 条记录里只有 2 条是活的 —— **必须按 liveness 过滤**（用 `process.kill(pid,0)`，不要用 `pgrep` 的输出格式去判，我自己在这上面踩过一次）。
- **`cwd` 不可靠**：同工作区多 Session 的 cwd 相同（实测 1 个 distinct cwd），不能当唯一键。
- 稳妥起见：**`--user-data-dir` 里带上会话标识**（或直接由 host 侧分配带 sessionId 的 profile 路径），把关联做成确定性的，而不是靠进程树推断。

## 6. 跟随 agent 的 tab / 跳转

观察窗不能只钉住初始页面。实测可行：

```
Q2 page targets at start: 1
Q2 page targets after agent opened a tab: 2
Q2 observer can see new tab URL: true
Q2 frames from the NEW tab: 30 (observer followed the agent)
```

做法：观察端订阅 `Target.targetCreated` / `targetInfoChanged`，在**浏览器级** CDP 端点（`/devtools/browser/<id>`）上监听，切换时对目标 page 重新 `Page.startScreencast`。

## 7. 渲染与省 CPU

- **渲染**：screencast 帧（JPEG）→ WS → 侧边栏 `<img>`/canvas 绘制。骨架抄 Terminal（host 侧 `ws` + `upgrade` 路由，客户端 `ws://${location.host}/...`）。
- **坐标映射**（若日后要加输入）：`metadata.deviceWidth/Height` 报的是**视口**、忽略 maxWidth，必须用**真实解码的 JPEG 尺寸**换算；`Input.dispatchMouseEvent` 收 **CSS 坐标**。已验证往返正确。
- **省 CPU**：必须**显式** `Page.stopScreencast`。实测停流后真 0 帧且 agent 不受影响；但**「页面隐藏自动 0 帧」我未能复现**（后台页面仍 `visible`，2.5s 发 54 帧），别指望它。与 `sidebar-tab-keep-alive` 的 `visible:false` 配套即可。
- **成本**：一个观察者 ~0.4 MB/s（侧边栏档位）。**随观看者线性增长**（1 个 3.89 Mbps → 5 个 19.43 Mbps），所以**不要做缩略图墙**。

## 8. 生命周期与安全（易踩）

- **观察通道必须随 tab 关而断**，且**绝不能因观察失败而影响 agent**：只读连接断了，agent 照常跑。
- **端口是完整浏览器控制权**：只绑 `127.0.0.1`，并校验 socket 归属。
- 浏览器归 host 侧所有，绑 `tab.signal`（终端同款）；否则关 tab 留进程 —— 正是之前 `browser_prepare` 残留的成因。
- **不要用 `Page.startScreenRecording`**（协议里有、Chrome 149 运行时不存，`-32601`）。

## 9. 实施顺序

1. **打通观察通道**：shim 注入端口（§3-A）+ `DevToolsActivePort` 发现（§4）+ host 侧只读 CDP 连接。
2. **出画面**：screencast → WS → 侧边栏 canvas；一个 tab、一个页面。
3. **跟随**：`Target.*` 事件驱动重挂 screencast（§6）。
4. **多会话正确性**：rendezvous + liveness 过滤（§5），确保看的是自己那个实例。
5. （后置，非当前需求）输入回传。

验收标准：agent 在 Browser Use 里导航/点击/填表时，侧边栏**逐帧同步显示同一个页面**，且**关掉观察窗不影响 agent 继续工作**。

## 10. 待你确认

1. 观察窗**只读**够吗？（我按「只读」设计；若要能点，加步骤 5）
2. 多会话时，是否接受**每会话独立观察窗**（各看各的）？
3. 需不需要**同时看多个浏览器**（agent 开了多个 tab/实例）？还是一个观察窗跟随当前活动页就够？
