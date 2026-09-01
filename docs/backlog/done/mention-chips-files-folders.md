# 用户气泡引用 chips：仅 @session，无 @file/@folder 装饰

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的用户气泡引用（`dsh-client-ui-conversation` `projectUserText`，lib/client.js:5280-5319）：`refChip` + `ReferenceIcon` 按 kind 区分（session/file/folder/skill 四类）+ `referenceSummary`「引用了 …」摘要行。

dsh-one（webview.ts:2298-2306）：只有会话 mention 渲染成 chip（`splitSessionMentions`），`@file/@folder` 不成 chip、无 kind 图标、无引用摘要行；契约 `m.references`（chatContract.ts:88）也只有 `{sessionId, label}`。

## 涉及代码位置

- dsh web：`dsh-client-ui-reference`（数据 + ReferenceIcon）、`dsh-client-ui-conversation`（projectUserText）
- dsh-one：`src/pure/userBubble.ts`（新增：气泡 tokenizer，对齐 web projectUserText）、`src/pure/sessionMention.ts`（抽 `sessionMentionRanges` 复用）、`src/ui/chat/webview.ts`（renderMessage user 分支 + ref chip 渲染）、`src/ui/chatView.ts`（ref-chip / ref-summary 样式）

## 调研结论（2026-09 开发时复核）

- host 事件流/契约里**没有** file/folder 引用的结构化数据：`dsh-file-reference` 只是补全发现服务（fileReferences/list），`@path` 在消息里就是纯文本；session 引用是唯一结构化 kind（`session-reference` 注入上下文的 `source.references: [{sessionId, label}]`，无 kind 字段，dsh-one 已接线）。
- 官方 dsh web 的做法是纯 UI 层按文本形态推断 chip（presentation-only，官方注释原文）：`@path/` → folder、`@path`/`@"path"` → file、`/command` → skill chip（无图标）；摘要行「引用会话 · labels」只含 session。
- 因此实现按用户确认的「对齐官方 web」路线：纯 UI 层推断，chatContract/conversation 不动。

## 实现（对齐官方 web，用户已确认四项取舍）

- 新增 `src/pure/userBubble.ts`：`splitUserBubble(text, references)` 把气泡文本切成 文本/session/file/folder/skill 段——session 由 references 驱动（可点击，打开会话；无 references 时回退 canonical URI mention），文件/文件夹/命令按形态推断（纯展示，title 悬停显示完整 token）。
- webview 用户气泡：会话 chip 保持可点击 button；文件/文件夹 chip 用官方同款图标（IconBrowseOutline16 = CONTEXT_BROWSE_ICON、IconFolderClose16 = PANEL_ICONS.folder）；`/command` 无图标 chip；气泡下方新增「引用会话 · A、B」摘要行（只含会话，对齐 web referenceSummary）。
- 边界（与官方一致或保持旧语义）：`(^|\s)` 词边界——中文标点后不触发（官方同款）；会话 label 撞文件 token 前缀时剩余文本保持纯文本（旧 splitReadableMentions 语义）；坏 URI 按文件 chip 展示（官方同款）。
- 单测：`test/userBubble.test.ts`（13 用例）；视觉场景 `test/ui/scenarios.js` `mention-chips` 已入 BASELINE_SCENARIOS。

## 人工验收方法（真实 VSCode dev-ui-test）

1. 起隔离 VSCode 实例后打开 chat 面板，附着或新建一个会话。
2. 发送一条含引用与路径的消息，例如：`参考 @<某个会话> 的实现，看下 @src/ui/chat/webview.ts 和 @src/pure/ 目录，用 /help 看看思路`（会话用 @ 补全插入，文件/文件夹路径手工输入即可）。
3. 应有现象：用户气泡内按文本顺序出现四个 chip——会话 chip（聊天气泡图标 + 标题，点击可打开被引用会话）；文件 chip（文档图标 + basename「webview.ts」，悬停 title 显示完整 @token）；文件夹 chip（文件夹图标 +「pure」）；命令 chip（无图标 +「/help」）。气泡下方一行小号摘要「引用会话 · <会话标题>」。
4. 再发送一条 `带空格路径 @"src/ui/chatView.ts" 也看下`：出现带文档图标的「chatView.ts」文件 chip，引号并入 chip 不残留。
5. 对照检查：纯文本消息（无 @、无 /）渲染与改动前一致，无多余 chip；会话引用摘要行只在该消息引用过会话时出现。

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-05 开发完成，自测通过（typecheck + 267 测试 + build 全绿），视觉场景 DOM 核对通过 → done（worktree: agent/mention-chips-files-folders）

