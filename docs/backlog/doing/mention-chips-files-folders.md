# 用户气泡引用 chips：仅 @session，无 @file/@folder 装饰

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的用户气泡引用（`dsh-client-ui-conversation` `projectUserText`，lib/client.js:5280-5319）：`refChip` + `ReferenceIcon` 按 kind 区分（session/file/folder/skill 四类）+ `referenceSummary`「引用了 …」摘要行。

dsh-one（webview.ts:2298-2306）：只有会话 mention 渲染成 chip（`splitSessionMentions`），`@file/@folder` 不成 chip、无 kind 图标、无引用摘要行；契约 `m.references`（chatContract.ts:88）也只有 `{sessionId, label}`。

## 涉及代码位置

- dsh web：`dsh-client-ui-reference`（数据 + ReferenceIcon）、`dsh-client-ui-conversation`（projectUserText）
- dsh-one：`src/pure/chatContract.ts`（references 扩 kind）、`src/pure/conversation.ts`（解析）、`src/ui/chat/webview.ts`（renderMessage user 分支）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
