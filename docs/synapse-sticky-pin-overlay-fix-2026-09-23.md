# 会话地图顶部置顶条泄漏修复

日期：2026-09-23，Asia/Shanghai。
对象：`plugins/dsh-synapse`（会话地图）与 `plugins/dsh-codex`（置顶提问条）。
现象：在会话地图里点卡片的 **详情** 后，地图顶部浮出一条横贯画布的置顶条，遮挡画布内容。

## 原因

顶部那条不是会话地图自己的元素，而是 **dsh-codex 的「滚动时置顶显示最新提问」**（`.dsh-codex-sticky-pin`）。

它泄漏进画布，是三个事实叠加的结果：

1. **它是 `<body>` portal。** 该条由 `createPortal(..., document.body)` 渲染，定位为 `position:fixed`、`z-index:30`。它在 DOM 上**不是**会话树的子节点。
2. **详情会让宿主对话继续存活。** 点 **详情** 打开右侧本轮面板时，会话地图占据会话主体，但官方对话并没有被卸载——实测 `[data-conversation-scroll]` 仍在，且仍持有当轮全部 `[data-chat-anchor-key]` 行（行数随会话增长，实测两次分别为 216 与 259 行）。dsh-codex 因此照常挂载它的置顶条 portal。
3. **隐藏祖先管不到 portal。** 会话地图靠给宿主的会话子树加类名来隐藏宿主 chrome，这对已经 teleport 到 `<body>` 的元素**完全无效**——它带着自己的 `z-index` 独立绘制。

于是置顶条越过画布边界，压在会话地图上方。截图里条带左端那个 `<span class="dsh-codex-sticky-thumb-wrap">` 缩略图占位块，就是它的标志。

### 与既有机制的关系

`client.js` 里已有 `CHROME_HIDE_SELECTORS` + `CHROME_HIDE_CLASS`，专门处理「宿主的 `<body>` portal 浮在画布上」这一族问题：

```js
const CHROME_HIDE_SELECTORS = ['.dsh-codex-nav-rail', '.dsh-side-panels', '.dsh-side-panels-launcher', '[data-width-handle]']
const CHROME_HIDE_CLASS = 'dsh-synapse-chrome-hidden'
```

侧栏轨道（`.dsh-codex-nav-rail`）、右侧终端/文件面板（`.dsh-side-panels`）都在这份名单里。**置顶条属于同一族，但当年漏登记了**——本次修复就是补上这个漏项，而不是新增机制。

### 实测证据（本机 1280×720，真实 DOM）

修复前，会话地图 + 详情状态下：

| 属性 | 值 |
| --- | --- |
| `position` | `fixed` |
| `z-index` | `30` |
| `parentElement` | `body` |
| `getBoundingClientRect()` | `[280, 76, 998, 102]` |
| `elementFromPoint(640, 90)` | `.dsh-codex-sticky-pin`（条带压住画布） |

## 已修复

在 `plugins/dsh-synapse/client.js` 的 `CHROME_HIDE_SELECTORS` 中补入两个选择器：

```js
const CHROME_HIDE_SELECTORS = ['.dsh-codex-nav-rail', '.dsh-side-panels', '.dsh-side-panels-launcher', '[data-width-handle]', '.dsh-codex-sticky-pin', '.dsh-codex-sticky-preview']
```

1. `.dsh-codex-sticky-pin` —— 置顶条本体。
2. `.dsh-codex-sticky-preview` —— 它点开的图片全屏预览遮罩（同样是 `<body>` portal，`z-index:80`）。一并登记，防止未来从程序化路径进入「预览打开 + 切到地图」时再泄漏一次。

复用的是会话地图既有的 `dsh-synapse-chrome-hidden` 规则（`visibility:hidden !important` + `pointer-events:none !important`），**不新增 CSS、不新增机制**：

- 用 `visibility` 而非 `display:none`，与侧栏面板一致，保留元素自身的布局状态；
- 该隐藏随地图视图的生命周期挂载与卸载，并有 `MutationObserver` 在 DOM 变化时重申，所以 portal 后续重新挂载也会被覆盖到。

### 为什么不改 dsh-codex

置顶条是插件对官方对话的增强，它在**对话**里是正确且需要的。它并不知道会话地图这个视图的存在；判断「当前是否由地图接管会话主体」是会话地图自己的职责。会话地图既然接管了会话主体，就该把逃出该子树的宿主浮层一起收掉——这正是 `CHROME_HIDE_SELECTORS` 存在的意义。

因此修复放在会话地图侧，dsh-codex 零改动。

## 验证

### 实机验证（真实 GUI，非模拟）

| 检查项 | 修复前 | 修复后 |
| --- | --- | --- |
| 详情状态下置顶条是否绘制 | 可见，压住画布 | `class` 含 `dsh-synapse-chrome-hidden`，`visibility:hidden`，`pointer-events:none` |
| `elementFromPoint(640, 90)` 命中 | `.dsh-codex-sticky-pin` | `.dsh-synapse-frame`（画布，即用户实际看到的） |
| 截图 | 顶部有明显置顶条 | 条带消失 |

**无回归验证：**

- 退出地图回到 **对话**：置顶条恢复 `visibility:visible`、`dsh-synapse-chrome-hidden` 类被摘除，滚动置顶功能照常。
- 图片预览在 **对话** 中仍可正常打开与 `Esc` 关闭，行为不受影响。
- `<body>` 直属子节点审计：会话地图接管时，唯一与画布重叠的 codex portal 就是 `.dsh-codex-sticky-pin`，且已处于隐藏态。

### 测试

- `plugins/dsh-synapse`：**335 项**函数/接口测试通过，`fail 0`（`canvas-runtime.test.js` 66 项）。
- 同步更新 `test/canvas-runtime.test.js` 中钉住选择器名单的断言，并补充两条断言说明这两个 `<body>` portal 为何必须登记。
- `node scripts/check-client-modules.mjs`：客户端模块契约检查通过。

测试全部针对源码文本与纯函数断言，未渲染组件、未断言 DOM，符合 `AGENTS.md` 的测试约定。

## 边界

`.dsh-codex-sticky-preview` 的隐藏逻辑已随修复登记，但**未在实机上构造出该状态**：该预览是真正的模态（`aria-modal="true"` 且拦截指针事件），打开时会挡住标签栏点击，所以「预览打开的同时切到地图」在当前交互下不可达。这条选择器属于对未来路径的防御性覆盖，本次只在 **对话** 中确认了预览本身正常。

置顶条在**对话**视图下的显示逻辑、滚动判定与展开/折叠行为均未改动，仅在其不该出现的视图里不绘制。
