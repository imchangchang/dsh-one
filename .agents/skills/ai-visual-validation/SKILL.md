---
name: ai-visual-validation
description: 用浏览器独立渲染 DSH One 的 chat webview + mock 后台 + 截图，每个场景带一份「期望描述」，agent 读截图后逐条对照核对逻辑与排版（语义判断，不是图和图像素 diff），让 agent 能对插件 UI 做视觉验证/回归，减少人工 dev-ui-test 次数。当要「看这个 UI 状态渲染对不对」「改完 UI 后对照期望描述核对」「给某个 UI 状态出一张确定性截图」时用。注意它只验证 webview 内容的渲染与交互，不验证宿主逻辑（激活/命令注册/真实 dsh），后者走 @vscode/test-electron 或真实 dev-ui-test。
---

# AI 视觉验证（DSH One chat webview）

把插件的 Chat webview（`src/ui/chat/webview.ts`）**用浏览器独立渲染 + mock 后台驱动 + 截图**，让 agent 真正"看见" UI。核心洞察：webview 是纯渲染函数，界面状态全部来自宿主推给它的 `ToWebviewMessage`——所以只要 mock 能构造出对应消息，任何 UI 状态都能确定性渲染、截图。**不需要 VS Code、不需要真实 dsh、不需要人开窗。**

## 什么时候用

- 改了 `src/ui/chat/`、`src/pure/` 里影响渲染的代码后，确认 UI 状态对不对。
- 想看某个边角/错误态（dsh 缺失、pending approval/question/plan-review、todos、subagents、历史窗口、模型选择器…）长什么样。
- 视觉回归：改动 UI 后逐场景截图，对照**期望描述**核对逻辑与排版是否还对。

**边界**：只验证 webview 内容的渲染与交互。它**看不见** VS Code 窗口 chrome（活动栏图标、命令面板、侧边栏宿主、右键菜单），也测不了宿主逻辑（激活/命令注册/服务起复用/真实 dsh 对话）。宿主逻辑用 `@vscode/test-electron` 或真实 `dev-ui-test`。

## 两层场景模型（谁写、跑在哪、管什么）

| 层 | 谁写 | 跑在哪 | 干什么 |
|---|---|---|---|
| **功能验收场景** | **worktree 开发 session**（最懂这个模块） | worktree 里，合入前 | 证明"我这个功能改的 UI 状态是对的" |
| **基线冒烟集** | 主线随仓库预设的稳定集合（`window.BASELINE_SCENARIOS`） | **主线合入后** | 证明"合入产物没把既有 UI 状态弄坏" |

- **功能场景防"没实现对"，基线场景防"弄坏了以前的东西"。** 作者自写验收容易自欺（只挑能过的写法），基线是人定的、作者改不动，所以能兜住"作者全绿但把通用 UI 弄挂"。
- **升级为基线**：功能场景里"以后必须一直对"的真实状态，把名字加进 `window.BASELINE_SCENARIOS`，随合入并入主线。**一次性调试 fixture** 放 worktree 的 `.dev-host/`，别提交。
- 所以长期看：功能场景是增量，基线是存量；随功能落地，基线越来越全。

## 前置（一次）

```bash
npm run build                      # 产出 dist/chatWebview.js
node scripts/gen-ui-harness.mjs    # 从 src/ui/chatView.ts 抽 STYLE → test/ui/style.css（改动样式后重跑）
# WebBridge daemon（http://127.0.0.1:10086）在跑；不在跑则启动它
~/.kimi-webbridge/bin/kimi-webbridge start
```

## 一键出全套（推荐）

```bash
scripts/ui-visual.sh                 # 默认 mode=all：跑 SCENARIOS 全部场景（worktree 功能验收）
scripts/ui-visual.sh --mode baseline # 只跑 BASELINE_SCENARIOS（主线合入后冒烟/回归）
```

会：起 http server 服务仓库根目录 → 遍历目标场景 → WebBridge 打开 `test/ui/harness.html?scenario=<name>` → 截图到 `/tmp/dsh-ui-shots/<name>.png`。**脚本会把每个场景的《期望清单》打印出来**（`expect` 字段），agent 逐张 `read_image` 后按下面方法核对。

**分步交互场景**（带 `interactSteps`，见「怎么新增一个场景」）每步各截一张 `<name>-<step>.png`：脚本轮询页面步骤完成信号到位再截图（截图与交互状态严格对齐，不是固定延时赌），交互前/后对照——「打开主菜单」与「展开二级菜单后主菜单仍应在位」这类状态不再压成一张。无 `interactSteps` 的场景仍单张 `<name>.png`。

- **worktree 功能验收**：`scripts/ui-visual.sh`（模式 all，含自己新加的场景）→ 逐张截图对照期望。
- **主线冒烟**：`scripts/ui-visual.sh --mode baseline` → 只跑基线稳定场景，逐张对照期望确认没把既有 UI 弄坏。

## 视觉验证方法（语义核对，非像素 diff）

每个场景在 `test/ui/scenarios.js` 里带一段 `expect`（该状态应该呈现什么**逻辑与排版**）。agent 的核对是**读截图 → 对照期望逐条判断**：

1. 截图是否出现了期望描述里的关键元素（如 dsh-not-found 的「查看安装指南」、approval 的「允许一次/拒绝」按钮、plan-review 里「批准」高亮）。
2. 排版/层级是否符合（消息在右、助手在左、工具卡折叠、侧边栏分组缩进）。
3. 不该出现的东西是否没有（如 dsh-not-found 不应有 composer、错误态不应有报错堆栈）。

不依赖像素 diff（图与图对照在不同机器/渲染下脆弱）。如果截图和期望对不上 → 说明逻辑或排版有 bug，报 `expect` 不符并说明差在哪。

## 手动看单个场景

```bash
(cd "$(git rev-parse --show-toplevel)" && python3 -m http.server 8899 --bind 127.0.0.1 &)
# WebBridge 导航到：
http://127.0.0.1:8899/test/ui/harness.html?scenario=dsh-not-found
# 然后 snapshot / screenshot
```

## 场景目录

`test/ui/scenarios.js` 里 `window.SCENARIOS` 的每个键 = 一个场景，当前有：

| 场景 | 对应 UI 状态 | 主要检查点 |
|---|---|---|
| `conversation` | 正常对话 | 用户/助手气泡、markdown 加粗、操作栏（复制/反馈/分叉） |
| `empty` | 空会话 hero | preset 选择 chip、workspace chip |
| `dsh-not-found` | 服务起不来 | 安装引导文案、无报错 |
| `approval` | 权限批准 | 批准/拒绝卡片 |
| `question` | 工具提问 | 选项 + 自定义输入 |
| `plan-review` | 计划评审 | detail 展示、批准按钮高亮 |
| `todos` | todo 清单卡 | 三态（completed/in_progress/pending） |
| `subagents` | 子代理下拉 | 血缘树缩进、运行态像素环 |
| `history` | 有更早历史 | 「加载更早」按钮 |
| `model-picker` | 模型选择器 | 分组/模型/effort 层级 |
| `sessions` | 侧边栏 | 搜索过滤、排序、未读标记、未分组 |

## 怎么新增一个场景

在 `test/ui/scenarios.js` 的 `window.SCENARIOS` 里加一个键即可，字段用 `src/pure/chatContract.ts` 的类型：

```js
'myState': {
  state: { sessionId:'sess-1', messages:[...], pending:[], running:false, canSend:true, ... },
  title: '新功能状态',
  expect: '这个状态应该呈现什么逻辑与排版（agent 读截图后逐条对照，写清关键元素/层级/不该出现的东西）',
},
```

`state` 是 `ChatState`；可选 `sessions`（`SessionsSnapshot`，缺省用 `window.sessionsTree(state.sessionId)`）和 `modelCatalog`。**`title`/`expect` 是必写的**——`expect` 就是这份场景的"验收描述"。`ui-visual.sh` 会把它打印成清单。改 `src/pure/chatContract.ts` 的契约时，`scenarios.js` 要同步对齐（字段冻结文件，两边一起改）。

**交互分步（interactSteps）**：交互是多步且需要中间帧对照时，用 `interactSteps` 取代 `interact`（二选一，同时存在时 interactSteps 优先）：

```js
'interactSteps: [{
  name: 'menu',                     // 步名：截图文件名 <scenario>-<step>.png，用 kebab 风格
  script: `document.querySelector('.workspace-row')?.click()`,
  // settle: 500,                   // 可选：本步脚本执行后到 UI 稳定的毫秒（默认 500；
  //                                 脚本内有 setTimeout/MutationObserver 异步链的按需调大）
}],
```

harness 每步执行完推送 `window.__interactStepDone = name`，`ui-visual.sh` 轮询到位后截 `<scenario>-<step>.png`，再调 `window.__interactStepAdvance()` 放行下一步。**`expect` 按「每张截图一个子状态」写**：哪张对应发生的哪个动作、该状态应呈现什么，以便逐张对照（示例：`sessions-workspace-menu-groups`）。

**加完场景后**：worktree 验收用 `ui-visual.sh`（all）跑它；如果它是"以后必须一直对"的真实 UI 状态，把名字加进 `window.BASELINE_SCENARIOS`（随合入并入主线基线）。一次性调试 fixture 放 `.dev-host/`，别提交、别进基线。

## 可交互模式（测发消息/流式/切换会话）

`test/ui/interactive.html` 是一个**可交互 mock host**：接住 webview 发上来的动作（send/stop/sessionOpen/setModel/loadEarlier/sessionsSearch/sessionPin/sessionUnread/workspaceCollapse/serverStart…），改 mock 状态后把 `state`/`sessions` 快照推回。用它测「点发送 → 流式回复 → 工具卡」这类交互，也能切会话、改名、归档、搜索、排序。

```bash
# 浏览器打开 http://127.0.0.1:8899/test/ui/interactive.html
# 在 composer 输入文本 → 回车（或点发送）→ 看流式回复
```

## 常见问题

- **截图空白/只有样式没内容**：确认 `dist/chatWebview.js` 是最新（`npm run build`），且 `test/ui/style.css` 是当前源码抽出（`node scripts/gen-ui-harness.mjs`）。
- **WebBridge snapshot 抓不到节点**：这页 webview 的 DOM 对 a11y 树不友好，别依赖 snapshot。用 `screenshot`（给人看）或 `evaluate` 查 DOM（给程序断言），不要用 snapshot 的 @e 引用点元素。
- **harness 404**：http server 的根目录必须是仓库根目录（`test/`、`dist/`、`scripts/` 都在那）。harness 引用 `/test/ui/style.css`、`/dist/chatWebview.js`、`/test/ui/scenarios.js`。
- **新样式不生效**：样式从源码抽的，改了 `src/ui/chatView.ts` 的 `STYLE` 必须重跑 `gen-ui-harness.mjs`。
