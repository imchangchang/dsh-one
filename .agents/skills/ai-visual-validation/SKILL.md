---
name: ai-visual-validation
description: 用浏览器独立渲染 DSH One 的 chat webview + mock 后台 + 截图，让 agent 能对插件 UI 做视觉验证/回归，减少人工 dev-ui-test 次数。当要「看这个 UI 状态渲染对不对」「改完 UI 后肉眼比对」「给某个 UI 状态出一张确定性截图」时用。注意它只验证 webview 内容的渲染与交互，不验证宿主逻辑（激活/命令注册/真实 dsh），后者走 @vscode/test-electron 或真实 dev-ui-test。
---

# AI 视觉验证（DSH One chat webview）

把插件的 Chat webview（`src/ui/chat/webview.ts`）**用浏览器独立渲染 + mock 后台驱动 + 截图**，让 agent 真正"看见" UI。核心洞察：webview 是纯渲染函数，界面状态全部来自宿主推给它的 `ToWebviewMessage`——所以只要 mock 能构造出对应消息，任何 UI 状态都能确定性渲染、截图。**不需要 VS Code、不需要真实 dsh、不需要人开窗。**

## 什么时候用

- 改了 `src/ui/chat/`、`src/pure/` 里影响渲染的代码后，确认 UI 状态对不对。
- 想看某个边角/错误态（dsh 缺失、pending approval/question/plan-review、todos、subagents、历史窗口、模型选择器…）长什么样。
- 视觉回归：改动 UI 后逐场景截图和基线 diff。

**边界**：只验证 webview 内容的渲染与交互。它**看不见** VS Code 窗口 chrome（活动栏图标、命令面板、侧边栏宿主、右键菜单），也测不了宿主逻辑（激活/命令注册/服务起复用/真实 dsh 对话）。宿主逻辑用 `@vscode/test-electron` 或真实 `dev-ui-test`。

## 前置（一次）

```bash
npm run build                      # 产出 dist/chatWebview.js
node scripts/gen-ui-harness.mjs    # 从 src/ui/chatView.ts 抽 STYLE → test/ui/style.css（改动样式后重跑）
# WebBridge daemon（http://127.0.0.1:10086）在跑；不在跑则启动它
~/.kimi-webbridge/bin/kimi-webbridge start
```

## 一键出全套（推荐）

```bash
scripts/ui-visual.sh [port]        # 默认 8899
```

它会：起 http server 服务仓库根目录 → 遍历 `test/ui/scenarios.js` 里每个场景 → WebBridge 打开 `test/ui/harness.html?scenario=<name>` → 截图到 `/tmp/dsh-ui-shots/<name>.png`。跑完打印清单，agent 用 `read_image` 逐张看。

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
'myState': { state: { sessionId:'sess-1', messages:[...], pending:[], running:false, canSend:true, ... } },
```

`state` 是 `ChatState`；可选 `sessions`（`SessionsSnapshot`，缺省用 `window.sessionsTree(state.sessionId)`）和 `modelCatalog`。改 `src/pure/chatContract.ts` 的契约时，`scenarios.js` 要同步对齐（字段冻结文件，两边一起改）。

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
