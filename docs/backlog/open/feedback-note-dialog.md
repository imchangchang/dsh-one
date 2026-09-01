# 消息反馈备注编辑弹层缺失

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的 👍/👎 反馈（`dsh-client-ui-message-feedback` `MessageFeedbackActions`，lib/client.js:383-618）：点选后出现备注 trigger + `role="dialog"` notePanel（textarea「这条回答哪里好，或哪里有问题？（可选）」+ 保存/取消）+ 错误状态行。

dsh-one 只有裸点赞（webview.ts:2521-2540 `renderAssistantActions`：点击即发 `feedback`，无备注弹层），契约上 `{type:'feedback', messageId, rating}`（chatContract.ts:486）也没有 note 字段。

## 涉及代码位置

- dsh web：`dsh-client-ui-message-feedback`
- dsh-one：`src/ui/chat/webview.ts`（renderAssistantActions）、`src/pure/chatContract.ts`（feedback 消息类型加 note 字段）

## 变更记录

- 2026-09-01 记录 → open
