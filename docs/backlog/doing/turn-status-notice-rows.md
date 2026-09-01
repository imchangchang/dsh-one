# 流内状态提示行缺失：compaction 卡 / 重试倒计时 / 超 token 提示

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。三个都是消息流内的状态提示行，dsh-one 均无：

## 现象

1. **Compaction 卡**：`dsh-client-ui-conversation` `CompactionItem`（lib/client.js:4295），折叠摘要卡（有 summary 才可展开）。dsh-one 无此消息类型（`chatContract.ts` 消息 kind 只有 user/assistant/command/approval/question），压缩只体现为 `/compact` 命令卡。
2. **重试行**：`ModelRetryItem`（:5161-5220），延迟重试倒计时 + 失败原因 + 最大次数。dsh-one 无。
3. **超 token 提示**：`TurnMaxTokensItem`（:5251），StateDot(warning) + 「已达输出 token 上限」+ hint。dsh-one 无（有 `turnError` 行 webview.ts:2476，但无 maxTokens 分支）。

## 待确认

- 数据链路：host 事件流是否暴露 compact 摘要、模型重试、maxTokens 原因（`turn/end` reason 目前只处理 error/interrupted，见 chatContract.ts:106）。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（CompactionItem / ModelRetryItem / TurnMaxTokensItem）
- dsh-one：`src/pure/chatContract.ts`（消息 kind / turn 原因扩展）、`src/ui/chat/webview.ts`（renderMessage / renderTurnError）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
