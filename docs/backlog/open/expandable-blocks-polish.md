# 可展开块优化一批（diff / command 卡 / 推理块首行 / queue 计数）

记录于 2026-09-01。来自「能展开的都做成可展开」调研（docs/dsh-web-expandable-ui-research.md）。

## 背景与现象

dsh web 里多处可展开/折叠，dsh-one 这些目前不可展开。这批都是纯前端可做的展开优化：

1. **diff 折叠**：diff 块行数折叠（「展开其余 N 行」），dsh web 的 DiffBlock 有。
2. **command 卡多行展开**：命令卡含换行时才可展开（dsh web GenericCommandCard）。
3. **推理块折叠态加首行预览**：「思考过程」折叠时显示推理首行（web 有，dsh-one 没有）。
4. **queue 计数折叠**：排队消息 >1 条时计数 header 折叠（QueueDock 形态）；注意操作入口要藏进展开态。

## 方案

对照 dsh web 的 DisclosureRow / 块折叠语义，逐个给上述块加展开能力。纯 webview.ts / conversation.ts 改动。

## 涉及代码位置

- `src/ui/chat/webview.ts`（diff / command 卡 / 推理块 / queue 渲染）
- `src/pure/conversation.ts` / `src/pure/chatContract.ts`（如需块字段）
