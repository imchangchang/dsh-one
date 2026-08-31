# 会话面板增加「折叠所有工作区」按钮

记录于 2026-08-31。

## 背景与现象

会话面板的 workspace 分组只能逐个点行头折叠。workspace 多、会话多时，想要一个干净的面板得挨个点一遍，缺少一键折叠。

## 现状

- 折叠状态存在 host 侧 `src/ui/sessionsStore.ts`：`collapsed: Set<string>`，经 `setCollapsed(workspaceId, collapse)` 单个更新并持久化到 workspaceState 的 `sessions.collapsed`（约 87、196–199 行）。
- webview 行头点击发 `workspaceCollapse` 消息（`src/ui/chat/webview.ts` 约 1518 行），host 在 `src/ui/chatView.ts` 约 982 行分发。
- 面板头部已有排序、刷新、添加工作区三个 `panelTool` 按钮（`webview.ts` 约 1406–1436 行），新按钮可放这里。

## 建议方案

面板头部加一个「折叠全部」按钮（图标可用双上三角/chevrons-up 之类），点击后把所有 workspace 收进 collapsed 集合。

实现要点：

- `sessionsStore` 加 `collapseAll(workspaceIds: string[])`：整体替换 collapsed 集合，一次 `state.update` + 一次快照刷新，避免循环调 `setCollapsed` 触发 N 次持久化和重渲染；
- 消息协议（`src/pure/chatContract.ts`）加一条 `workspacesCollapseAll`，或复用现有消息由 webview 逐个发——前者更省往返，推荐前者；
- 是否做成折叠/展开切换（全部已折叠时按钮变「展开全部」）可在实现时定，最小版本只做折叠即可。

涉及文件：`src/ui/chat/webview.ts`（面板头部按钮）、`src/pure/chatContract.ts`（消息）、`src/ui/chatView.ts`（分发）、`src/ui/sessionsStore.ts`（collapseAll + 测试）。
