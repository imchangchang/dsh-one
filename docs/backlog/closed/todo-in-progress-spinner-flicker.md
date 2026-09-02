# 任务清单「进行中」运行符号在消息流输出时疯狂刷新

记录于 2026-09-12。用户反馈：todo 里正在处理（in_progress）的任务带一个运行符号，消息流还在输出时这个符号会疯狂刷新。

## 背景与现象

对话流式输出期间，任务清单（todo 卡）中 in_progress 项的行首转圈弧环不是匀速旋转，而是高频重绘/闪烁——看起来像符号在不停刷新。流式输出结束、快照停止后恢复正常转动。

## 根因

- 流式期间 host 每 ~100ms 推一个 state 快照（`src/server/chatSession.ts:38` `FLUSH_INTERVAL_MS = 100` + `push()` 节流）。
- webview 每个快照全量重建 chatCol（`render()`，`src/ui/chat/webview.ts:1824`），todo 卡随之重建：`renderTodoPanel(state.todos)`（`webview.ts:2319`）→ `renderTodoItem` → `todoStatusGlyph`（`webview.ts:2961-3003`）每帧**新建 SVG**。
- 新建元素会重启 CSS 动画：`.todo-progress-spin`（`src/ui/chatViewHtml.ts:920-924`，`animation: todo-progress-spin 1s linear infinite`）每帧从 0° 重新开始 → 快照 ~100ms 一帧时转圈永远走不完，表现成疯狂刷新。

与 `chat-code-copy-feedback-flash` 同病根（快照全量重建冲掉临时视觉状态）：那个是页面状态归零，这个是 CSS 动画随节点替换重启。host 端节流无问题，纯渲染端。

## 建议方案

类同 composer/pending 面板的按 key 保活（`webview.ts:1907-1929` 的 `keepPending` 模式）：todo 卡每帧重建时，若 in_progress 条目的 content/status 未变，复用上帧的 glyph 元素（按 item 序号或 `data-status`+content 匹配），动画就不重启。也可以把动画挪到不被替换的节点上，但保活节点最稳。

## 涉及代码位置

- `src/ui/chat/webview.ts`（`renderTodoPanel` / `renderTodoItem` / `todoStatusGlyph`，以及 `render()` 的 chatCol 重建处）
- `src/ui/chatViewHtml.ts`（`.todo-progress-spin` / `@keyframes todo-progress-spin`，920-924）
- `src/server/chatSession.ts`（快照节流，只作原因说明，不改）

- 2026-09-02 认领（worktree: agent/todo-in-progress-spinner-flicker）→ doing

- 2026-09-02 开发完成，自测通过 → done

- 2026-09-02 主线合入测试通过（typecheck/334 tests/build），人工确认 → closed
