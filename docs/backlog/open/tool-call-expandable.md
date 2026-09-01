# tool call 卡可展开（IN/OUT）

记录于 2026-09-01。

## 背景与现象

dsh web 的工具调用卡可以展开，显示 IN（输入参数 JSON）和 OUT（输出结果）详情（参考会话「进行一个 job 查看」里的 ralph 卡：展开后显示 IN `{objective, maxRounds}` 和 OUT `{Ralph worker reported...}`）。dsh-one 的工具卡是单行（title + detail），不能展开查看输入输出。

## 现状

- dsh-one 的 ChatToolBlock 渲染（webview.ts renderTool）：单行，title + detail，无展开。
- 工具调用的输入 args（data.arguments）和输出 result 是否已在折叠模型里可用，需确认。

## 方案

工具卡加展开能力（chevron / 点击展开），展开显示 IN（输入 args JSON）+ OUT（输出 result），对齐 dsh web 的展开形态（DisclosureRow：整行可点、折叠态保留摘要、展开出 IN/OUT 卡片、150px 内滚动、尾部 Inspect 按钮）。

**数据已确认可用**：`conversation.ts` `applyToolCall` 折叠 `tool/call` 时 `data.arguments` 就在手里（现已用于 todo_write 的 planSummary），只需把它存进 `ChatToolBlock`（chatContract.ts 加字段）；输出 result 已有。无需 host 侧改动。

## 涉及代码位置

- `src/ui/chat/webview.ts`（renderTool 工具卡）
- `src/pure/conversation.ts`（applyToolCall 折叠，args/result 可用性）
- `src/pure/chatContract.ts`（ChatToolBlock 可能需带 args/result）
