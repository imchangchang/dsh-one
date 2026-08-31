# 会话处理完成后不自动标未读

记录于 2026-08-31。

## 背景与现象

用户期望：一个 session 在后台跑完（agent 处理结束）后，会话列表里应出现未读标记（蓝点 + 标题加粗），提示"这个会话有新结果没看"。

实际：处理完的 session 不会出现任何未读标记。

## 根因

不是回归，是从未实现。dsh-one 的未读是**纯手动**状态：全代码库唯一会 `setUnread(id, true)` 的入口是 webview 会话菜单的「标为未读」（`src/ui/chat/webview.ts:1595` → `src/ui/chatView.ts:980`）。唯一的自动逻辑是反向的——`setSession()` 附着会话时清未读（`src/ui/chatView.ts:837`）。

这是当时的有意决策，CHANGELOG 有记录："官方同样没有自动未读逻辑，故只做手动标记"（官方 dsh web bundle 里确实没有任何 unread 概念，已 grep 确认）。

## 建议方案

在 `SessionsStore` 里加自动未读：监听 `host/session-status` 事件（已在 `REFRESH_METHODS` 里，会触发刷新），在刷新后的基线里检测 session 的 `running` 从 true 变 false；若该 session 不是当前附着的会话，则自动加入 unread 集合。清除逻辑不用动——附着即清未读（`chatView.ts:837`）和手动「标为已读」都已存在。

## 注意点

- 需要跨刷新记住每个 session 上一轮的 running 状态（基线在 `SessionsStore.rawSessions`，对比新旧即可），不能直接拿单次快照判断"刚跑完"。
- 当前附着的会话不应标未读（用户正在看）；附着状态在 `ChatViewProvider`，store 侧目前不知道哪个会话被附着，需要把 currentSessionId 传进去或由 ChatViewProvider 在状态转换时调 `setUnread`。
- dsh CLI / dsh web 里跑完的会话同样会触发 host 事件，这些"外部来源"的完成也会标未读，符合预期但要注意自测时的噪音。
- 未读集合持久化在 `workspaceState`（`sessions.unread`），自动标记会复用同一条持久化路径，无需改动。

涉及文件：`src/ui/sessionsStore.ts`（状态转换检测 + 自动标记）、`src/ui/chatView.ts`（附着会话排除）、`src/pure/sessionTree.ts` / `src/ui/chat/webview.ts`（渲染已就绪，不用动）。
