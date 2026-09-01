# 消息内 todo_write 任务卡

记录于 2026-08-31。对齐 dsh web 的 TodoRow。

## 背景与现象

dsh web 聊天流里一次 `todo_write` 工具调用会渲染成任务卡（`更新任务清单 0/4 已完成 · 启动后台 bash job（60s 模拟流水线） +2`，`0/4`=done/total、首个 in_progress 条目、`+2`=其余进行中数）。dsh-one 目前只把 todo_write 渲染成通用工具卡，且**丢掉了 args**。

## 现状

- dsh-one 的 `ConversationFolder.applyToolCall`（conversation.ts）只保留 title/detail（来自 host view），**丢掉了 `data.arguments`**；而 `tool/call` 事件的 `data.arguments` 是模型原始 JSON 字符串（`{todos:[{content,status}]}`），传递工具被拒绝/失败时也原样保留——比 host 渲染 view 的 `rawInput`（数组）更可靠。
- `todo_write` 是普通 tool/call，事件在 dsh-one 已订阅的 mux 流里，只是没被专门解析。
- 数据可行性已验证（见 docs/dsh-one-todos-data-source.md）。

## 方案

- `src/pure/conversation.ts` `applyToolCall`：`name === 'todo_write'` 时解析 `data.arguments` 并算 `planSummary`（done/total、首个 in_progress 的 content、其余 in_progress 数），存进工具 block。
- `src/pure/chatContract.ts` `ChatToolBlock`：加 `todos?: { done, total, activeContent, activeExtra }`。
- `src/ui/chat/webview.ts`：工具卡按 planSummary 渲染「0/4 已完成 · 启动后台 bash job… +2」。

## 参考实现

- `docs/dsh-web-task-card-and-todo-row-research.md`（TodoRow 渲染逻辑）
- `docs/dsh-one-todos-data-source.md`（数据来源已验证）
- 官方源码：`dsh-client-ui-tool`（TodoRow / planSummary）

## 涉及代码位置

- `src/pure/conversation.ts`
- `src/pure/chatContract.ts`
- `src/ui/chat/webview.ts`
