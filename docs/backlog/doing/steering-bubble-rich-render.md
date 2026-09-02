# 等待插话（steering）气泡：附件与引用要像正式用户消息一样渲染

记录于 2026-09-03。用户反馈：⌘/Ctrl+Enter 插话后，对话流末尾的「等待插话」气泡只显示纯文本——附件（图片/文件）不显示、会话引用（@[标题](dsh-session:…)）是原始 markdown 文本；应为和正式用户消息一致的气泡：图片缩略图、文件 chip、引用 chip、引用摘要行。

## 现状（已核实）

- `src/ui/chat/webview.ts:2716-2723` `renderSteeringItem`：`el('div', 'bubble', item.text)` 纯文本渲染；`item.text` 是 `queueItemOf` 的预览文本（附件行被剥掉、加 `[图片 ×N] [文件 ×N]` 前缀），会话引用是 canonical URI markdown，直接显示原文。
- 正式用户消息（`renderMessage` user 分支，:3151-3175）渲染：`msg-images`（图片缩略图 + 文件 chip）+ `bubble`（`splitUserBubble` 按段拼引用 chip）+ `ref-summary` 引用摘要行。
- `QueuedItem`（chatContract.ts:543-550）只携带 `text`/`editText`，没有附件与引用的结构化数据，webview 无法渲染。
- 宿主侧信息是有的：`QueuedInboxItemLike.message.content`（聊天会话 `session/queue` 帧）含 image block（attachmentId），`editText` 含 `<attachment>` 文件行；`conversation.ts` 的 `imagesOfBlocks`/`splitAttachments` 是对应提取逻辑（未导出、未用在这里）。

## 方案

1. `QueuedItem` 增加可选 `images: ChatImage[]` / `files: ChatFile[]`（host 总是提供；webview 缺省防御）。
2. `conversation.ts` 导出 `imagesOfBlocks`；`chatSession.ts` 的 `queueItemOf` 顺带提取 images（content block）与 files（`splitAttachmentLines`）。
3. webview：把用户消息的「附件区 + 引用气泡 + 引用摘要行」抽成共用渲染函数，`renderMessage` 与 `renderSteeringItem` 都走它；steering 的文本 = `splitAttachmentLines(editText).text` 经 `parseSessionMentions` 展开成可读 `@label` + references（与 host 落盘语义一致）。
4. 场景 `steering-pending` 补附件 + 会话引用，视觉核对。

## 涉及代码位置

- `src/pure/chatContract.ts` — `QueuedItem`（:543-550）
- `src/pure/conversation.ts` — `imagesOfBlocks`（:180，导出）
- `src/server/chatSession.ts` — `queueItemOf`（:122-141）
- `src/ui/chat/webview.ts` — `renderMessage` user 分支（:3151-3175）、`renderSteeringItem`（:2716-2723）
- `test/ui/scenarios.js` — `steering-pending`（:372-379）

## 变更记录

- 2026-09-03 记录 → open（用户口头需求）

- 2026-09-03 认领（worktree: agent/steering-bubble-rich-render）→ doing
