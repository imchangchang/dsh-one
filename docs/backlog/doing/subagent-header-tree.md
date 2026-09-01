# 头部「N 个子代理」chip 改树形缩进列表（支持子代理再开子代理）

记录于 2026-09-01。需求来自用户：子代理可再开子代理（多层嵌套血缘），头部子代理区域要能看到并进入这些嵌套层，不能是平铺列表。

## 背景与现象

dsh web / dsh-one 的会话树里，子代理可通过 `parentSessionId` 形成血缘链（子代理再开子代理 = 孙一辈）。但 dsh-one 头部「N 个子代理」chip 只列出**当前会话的直接子代理**（`parentSessionId === 当前会话`），平铺进下拉，看不到「子代理的子代理」。

## 现状

- `src/pure/chatContract.ts:283`：`subagents?: Array<{sessionId, title, running, totalTokens, updatedAt}>`——扁平结构。
- `src/ui/chatView.ts:1010-1014`（composeHeader）：`raw.filter(s => s.parentSessionId === state.sessionId)`，只取直接子代理。
- `src/ui/chat/webview.ts:975-1004`（openSubagentMenu）：平铺 for 渲染，无缩进、无嵌套。
- 会话树侧（sessionTree.ts 的 `hasRunningDescendant`，:152）已递归支持多层血缘 busy 传导，但 UI 展示停留一层。

## 方案

三处改动，`subagents` 从扁平数组改成树形节点：

1. `src/pure/chatContract.ts`：`SubagentNode { sessionId, title, running, totalTokens?, updatedAt, children? }`，`subagents?: SubagentNode[]`。
2. `src/ui/chatView.ts` composeHeader：从 `session.list` 基线**递归**组装血缘子树（每层按 运行中优先 + 新近优先 排序），带回环保护。
3. `src/ui/chat/webview.ts` openSubagentMenu：递归渲染缩进树（每级缩进、状态点保留），行点击附着对应子会话，补每级缩进样式。

## 已确认的语义（用户拍板）

- 形态：点开子代理 chip 后是**树形缩进列表**。
- chip 上的「N 个子代理」**只算直接子代理**（对齐官方），下拉里再缩进展示各自后代。

## 涉及代码位置

- `src/pure/chatContract.ts`（subagents 类型）
- `src/ui/chatView.ts`（composeHeader 递归组装）
- `src/ui/chat/webview.ts`（openSubagentMenu 递归渲染 + 样式）
- `test/`（chatContract / 相关纯逻辑测试，补嵌套用例）

- 2026-09-01 认领（worktree: agent/subagent-header-tree）→ doing
