# 工具输出 fold 时 4000 字符硬截断导致全文不可恢复

记录于 2026-09-01。

## 背景与现象

dsh-one 折叠工具输出时硬截断在 4000 字符，全文在折叠模型里丢失、不可恢复。这导致：用户看不到完整输出；JSON 输出的 JsonTree 等需要全文的功能拿不到完整数据。

## 现状

- `conversation.ts:100` `OUTPUT_LIMIT = 4000`、`truncate()`；`block.output = truncate(text)`（:545、:578），全文丢失。
- `toolLine.ts` 另有行数截断（展示层 `truncateLines`，预览前几行 +「共 N 行」展开）——那是展示层截断，与折叠层硬截断是两回事。

## 方案

折叠层不硬截断：全文保留在折叠模型里（或可从输出存储恢复），截断只在展示层做（复用现有 truncateLines 行数预览）。`ChatToolBlock.output` 保留全文，webview 负责展示截断。

## 涉及代码位置

- `src/pure/conversation.ts`（OUTPUT_LIMIT / truncate / 输出折叠 :545 :578）
- `src/pure/chatContract.ts`（ChatToolBlock.output 语义）
- `src/ui/chat/webview.ts`（输出展示截断 truncateLines）
- 2026-09-01 认领（worktree: agent/output-full-text-restore）→ doing
