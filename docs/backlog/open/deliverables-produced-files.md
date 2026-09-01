# 对话尾部产物文件行缺失（对齐 dsh web ProducedFiles）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 每轮 assistant 消息尾部渲染「产物」行（`dsh-client-ui-deliverables` `ProducedFiles`，lib/client.js:215-306，挂 `conversation.chat.turnTail`）：产物 label + 最多 6 个文件 chip（多余折叠成「+N 个文件」）+ 「在文件夹中显示」按钮。

dsh-one 无任何产物展示：对话流里产出文件没有聚合视，只能靠工具卡输出找。

## 现状

- dsh-one `chatContract.ts` 无 deliverables/turn-tail 相关字段（grep 无命中）；`renderAssistantActions`（webview.ts:2490）只有 copy/👍/👎/分支。
- 数据可用性待确认：host 的事件流里能否拿到本轮产物清单（`turn/end` 或 tool 输出聚合），确认前先当想法级。

## 涉及代码位置

- dsh web：`dsh-client-ui-deliverables`（ProducedFiles）
- dsh-one：`src/pure/chatContract.ts`（新增字段）、`src/pure/conversation.ts`（聚合）、`src/ui/chat/webview.ts`（turn 尾部渲染）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
