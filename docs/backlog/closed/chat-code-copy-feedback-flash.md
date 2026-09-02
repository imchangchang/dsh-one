# 聊天输出代码块复制的「已复制」反馈被流式重建冲掉

记录于 2026-09-12。用户反馈：对话输出期间点击代码块复制按钮，「已复制」只闪一下很快变回「复制」。

## 背景与现象

流式输出时点击代码块的复制按钮，按钮先显示「已复制」，但下一个快照帧（约 100ms 后）就恢复成「复制」，反馈一闪而过。复制本身成功，用户无法确认是否复制完成。

## 根因

流式期间 host 每 ~100ms 推送一个 state 快照（`src/server/chatSession.ts:37` `FLUSH_INTERVAL_MS = 100` + `push()` 节流），webview 每个快照全量重建消息区：`render()` 里 `messages.textContent = ''`（`src/ui/chat/webview.ts:2228`）后重走 `appendMessageFlow` → `renderMessage` → `enhanceCodeBlocks`，给每个代码块**新建**复制按钮，初始文案就是「复制」。

按钮的「已复制」是点击后挂在旧 DOM 上的临时状态（`webview.ts:662-677`，`setTimeout(1000)` 后恢复），重建后归零，1000ms 恢复逻辑基本没机会被看到。同类持久化状态（`detailsOpen`、`jsonTreeOpen`）都有 Map 跨重建，唯独复制按钮反馈没有。

同病位置：JSON 树整树复制按钮 `json-tree-copy`（`webview.ts:3919-3940`）、JSON 树节点级复制图标（`webview.ts:4025-4047`）。

## 建议方案

模块级 `Map<key, 时间戳>` 记录复制成功时刻，key 沿用 `enhanceCodeBlocks` 的 `${prefix}:code:${i}`；渲染按钮时若距成功不足 1s，初始渲染成「已复制」并按剩余时间恢复。与 `detailsOpen` 同款持久化模式，纯 webview.ts 改动。

## 涉及代码位置

- `src/ui/chat/webview.ts`（`enhanceCodeBlocks` 复制按钮、`renderJsonTree` 复制按钮、`renderJsonNodeCopy` 节点复制图标）
- `src/server/chatSession.ts`（快照节流，只作原因说明，不改）

- 2026-09-02 认领（Sprint 1 节点，worktree: agent/chat-code-copy-feedback-flash）→ doing

- 2026-09-02 Sprint 1 开发完成，自测通过（typecheck/test/build，087bfaa），人工 dev-ui-test 窗口验收通过 → done

- 2026-09-02 主线合入测试通过，人工 dev-ui-test 窗口验收通过 → closed
