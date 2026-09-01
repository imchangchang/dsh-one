# 用户问答/审批位置与形态不同（web 是 composer 接管）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的用户问答/审批接管 **composer**（`dsh-client-ui-user-questions` `QuestionFlow`，lib/client.js:360-662，注册 `conversation.composer`）：

- QuestionFlow：header 最小化/最大化、分页器「1/N」、跳过本题、提交。
- PlanReviewPanel（:153-230）：warn strip「计划待审」+ 计划 Markdown + **确认执行/拒绝/去聊天里说**三分结构。

dsh-one 渲染为**消息流内 pending 卡**（webview.ts:2721 renderApproval / :2789 renderQuestion）：

- 多题一次排开，无「1/N」分页、无最小化/最大化、无跳过本题。
- plan-review 只把 approve 选项渲染为主按钮（webview.ts:2824 `isApprove`），无「确认执行/拒绝/去聊天里说」三分结构，也无 warn strip。

## 涉及代码位置

- dsh web：`dsh-client-ui-user-questions`（QuestionFlow / PlanReviewPanel）
- dsh-one：`src/ui/chat/webview.ts`（renderApproval / renderQuestion / pending 区）

## 变更记录

- 2026-09-01 记录 → open
