# 消息级计时指标缺失（ranFor / ttft / tps）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 每条 assistant 消息尾部显示消息级计时（`dsh-client-ui-conversation` `MessageIconActions`，lib/client.js:5032）：时间 + 「ran for 2m42s · ttft 1.2s · 95 t/s」。

dsh-one `renderAssistantActions`（webview.ts:2490）只有 copy/👍/👎/分支，无消息级时钟与 ranFor/ttft/tps；这些指标只在会话级 statsLine 里有（webview.ts:1000）。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（MessageIconActions）
- dsh-one：`src/pure/chatContract.ts`（消息级耗时/ttft/tps 字段，host 侧是否暴露待确认）、`src/ui/chat/webview.ts`（renderAssistantActions）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
