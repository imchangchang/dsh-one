# 输入区 Plan 状态 chip 缺失（对齐 dsh web PlanChip）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 计划模式激活时，输入区显示「Plan」pill + 关闭图标（`dsh-client-ui-plan` `PlanChip`，lib/client.js:33-80，挂 `conversation.input.plan`），点击执行 `/plan off`。计划模式状态在输入区有常驻指示。

dsh-one 只在 SLASH_COMMANDS 里注册了 `/plan` 命令（webview.ts:191），无输入区状态 chip——进入计划模式后用户没有可见指示（除消息里的 plan-review 问题卡）。

## 待核实

- `dsh-client-ui-plan` 是否有计划内容消息节点（层级结构/勾选态），调研只定位到 PlanChip 输入开关；计划审批 UI 在 user-questions 的 PlanReviewPanel（见 question-flow-composer-form）。

## 涉及代码位置

- dsh web：`dsh-client-ui-plan`
- dsh-one：`src/ui/chat/webview.ts`（renderInput 的 footer pill 区；状态来源需 host 侧暴露 plan active）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）
