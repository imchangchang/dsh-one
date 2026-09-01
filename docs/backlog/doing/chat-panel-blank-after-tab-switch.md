# 聊天 tab 切走再切回后空白（webview 隐藏后重载无状态恢复）

记录于 2026-09-06。用户报告：VSCode 里同时开着对话 tab（DSH One 聊天面板）和一个文件 tab，切到文件 tab 再切回对话 tab，对话 tab 是空白的。已核实复现路径与根因。

## 现象

- 对话 tab（`dshOne.chatPanel` WebviewPanel）切到其他编辑器 tab 再切回，内容空白（页面只有空的 `#app`，无消息、无空态文案、无 composer）。
- 对照：`dshOne.openInTab`（`dshOne.tab`，iframe 嵌 dsh web）无此问题——它设了 `retainContextWhenHidden: true`（`src/ui/webview.ts:126`）。

## 根因（已定位）

1. **chat panel 创建时未设 `retainContextWhenHidden`**（`src/ui/chatView.ts:1164-1172`，options 只有 `enableScripts` + `localResourceRoots`）。该选项默认 `false`：webview 不可见时 VSCode 销毁其内容，重新可见时**重新加载 HTML**（`chatHtml` 重新执行、`chat/webview.ts` 重新运行）。
2. **webview 侧初始化即 `state = null`，且无任何恢复机制**：
   - 没用 `vscode.getState()/setState()` 持久化（`chat/webview.ts` 全文无调用）；
   - 脚本加载后没有发 `ready` 消息让 host 重推当前快照；
   - host 侧没有监听 `panel.onDidChangeViewState`（重新可见时重推 `push(controller.getState())`）。
3. host 只在事件驱动时 push 状态（attach、store/jobs 变更、controller 变更、openPanel）。webview 重载后若无新事件，就永远收不到 `state` 消息——`render()` 不会被调用，`#app` 只剩空的 `.chat-col`，即用户看到的空白。若 `render()` 被调用（如恰有 `sessionTitle` 无关消息到达），会走 `renderEmpty(null)`，显示「dsh 聊天」空态而非原会话。

## 建议方案

最小修复二选一，推荐兼顾：

1. **host 重推（推荐，健壮）**：webview 脚本加载完成后 `post({ type: 'ready' })`；host 在 `onDidReceiveMessage` 里收到 `ready` 即 `push(controller?.getState() ?? emptyState())` + `pushSessions()`。即使 `retainContextWhenHidden` 保持默认，重载后也能立即恢复。
2. **保留上下文**：createWebviewPanel options 加 `retainContextWhenHidden: true`（与 `openInTab` 对齐）。切走切回不重载，内容原样。注意非活动 webview 长期占用内存、且极端情况下 VSCode 仍可能回收，故只算缓解。

也可两者都上（保留上下文为常规路径，ready 重推兜底重载）。

## 涉及代码位置

- `src/ui/chatView.ts`：`openPanel`（createWebviewPanel options）、`onMessage`（新增 ready 分支）、`push`
- `src/ui/chat/webview.ts`：模块顶部脚本初始化处（发 ready）、`ToWebviewMessage`/`FromWebviewMessage` 类型（`src/pure/chatContract.ts`）

## 变更记录

- 2026-09-06 核实根因 → open（未授权修改）
- 2026-09-06 认领修复 → doing
