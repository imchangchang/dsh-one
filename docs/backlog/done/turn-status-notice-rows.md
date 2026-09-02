# 流内状态提示行缺失：compaction 卡 / 重试倒计时 / 超 token 提示

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。三个都是消息流内的状态提示行，dsh-one 均无：

## 现象

1. **Compaction 卡**：`dsh-client-ui-conversation` `CompactionItem`（lib/client.js:4295），折叠摘要卡（有 summary 才可展开）。dsh-one 无此消息类型（`chatContract.ts` 消息 kind 只有 user/assistant/command/approval/question），压缩只体现为 `/compact` 命令卡。
2. **重试行**：`ModelRetryItem`（:5161-5220），延迟重试倒计时 + 失败原因 + 最大次数。dsh-one 无。
3. **超 token 提示**：`TurnMaxTokensItem`（:5251），StateDot(warning) + 「已达输出 token 上限」+ hint。dsh-one 无（有 `turnError` 行 webview.ts:2476，但无 maxTokens 分支）。

## 待确认

- ~~数据链路：host 事件流是否暴露 compact 摘要、模型重试、maxTokens 原因（`turn/end` reason 目前只处理 error/interrupted，见 chatContract.ts:106）。~~ ✅ 已确认三条全通（2026-09 调研）：
  - **compaction**：log-only `compaction/start|summary|end|prune` 事件 + checkpoint `user/message`（`surfaceOp:{op:'replace'}` + `source={kind:'plugin',plugin:'compact',compactionId,sourceCommandId?}`）。摘要/计数取自配对的 `compaction/summary`（官方契约保证同页）。手动 /compact 的 checkpoint 带 `sourceCommandId`（命中 `command/run` 的命令卡），自动压缩不带。
  - **重试**：`llm/retry`（retryId/turn/step/mode/retry/maxRetries/delayMs/failure）+ `llm/retry-started`（等待结束开始下一次尝试）。`retryState` 派生：scheduled → started；所属 turn/end 关闭时仍未 started → cancelled（对齐官方 isClosed）。
  - **超 token**：`turn/end` reason `{kind:'max-tokens'}`。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（CompactionItem / ModelRetryItem / TurnMaxTokensItem）
- dsh-one：`src/pure/chatContract.ts`（消息 kind / turn 原因扩展）、`src/pure/conversation.ts`（llm/retry / compaction 事件折叠）、`src/ui/chat/webview.ts`（renderMessage / renderBlock / renderCompactionCard / renderRetryRow / renderMaxTokensNotice）、`src/ui/chatView.ts`（CSS）

## 开发完成（2026-09）

三个状态行全部实现，文案采用官方 web zh 文案（用户已确认）；compaction 卡形态对齐官方：手动 /compact 合并进命令卡、自动压缩独立一行（用户已确认）。

- **① Compaction 卡**：checkpoint user/message 不再渲染成「plugin 注入」上下文行。折叠摘要卡默认折叠：标题「上下文已压缩」（手动合并卡标题为 `/compact`）+ 分隔点 + 摘要「已压缩 N 条历史记录（约 M tokens）」（计数缺失时回退命令卡输出文本 / 「点击查看压缩摘要」）；`summary` 为 null（compaction/summary 落在窗口外）时不可展开，纯展示行「压缩摘要不可用」。展开显示摘要全文（markdown）。展开态按 key 持久化。
- **② 重试行**：`llm/retry` 折叠成承载 turn 的 assistant 消息内的 retry 块；同 retryId 多次尝试原地更新。scheduled 行带倒计时扫光（截止 = 事件 time + delayMs，每秒刷新剩余秒数，不触发列表重渲染）+ 状态文本「正在重试模型请求（N/M） · Ns」；`llm/retry-started` → 「已重试模型请求」；turn/end 时未开始 → 「模型请求重试已取消」；`mode:'always'` 显示 ∞。展开显示「重试延迟：Nms / 失败原因：…」。
- **③ 超 token 提示**：`turn/end` reason `max-tokens` → 消息尾部黄色提示行（warning 圆点 + 「已达到输出 token 上限」+ hint「回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。」），与 turnError 同构仅配色换 warning。
- 新增场景测试：`test/ui/scenarios.js` 的 `turn-status-notices`（maxTokens + 重试行）与 `compaction-cards`（独立卡/命令卡合并/退化行），已用 DOM 断言核对（倒计时正则、展开详情、合并形态、无 checkpoint 泄漏）。

**人工验收方法**（真实 VSCode 隔离实例，视觉 gate）：

```
cd <repo-root>/.worktrees/turn-status-notice-rows && bash <repo-root>/scripts/dev-ui-test.sh
```

1. 弹出的隔离 VSCode 打开一个真实 dsh 会话（或新开会话直接对话）。
2. **超 token 提示**：给模型一个超长输出任务（如"输出 5000 字"）或选低 maxTokens 模型，回复被截断时，该条消息尾部应出现黄色「已达到输出 token 上限」+ hint 行；发送「继续」模型接着输出。
3. **重试行**：断网/拔 key 让模型请求 429 失败 → 消息流里出现灰字「正在重试模型请求（1/3） · Ns」行，秒数递减，行可展开看「重试延迟 / 失败原因」；恢复后变为「已重试模型请求」；期间点停止 → 变「模型请求重试已取消」。
4. **Compaction 卡**：输入 `/compact` → 命令卡运行中（spinner）→ 完成后卡内变成折叠摘要卡（标题 `/compact` + 「已压缩 N 条历史记录（约 M tokens）」），点击展开看摘要全文；上下文压力触发的自动压缩 → 消息流里出现「上下文已压缩」独立卡。压缩后不应再出现「This is an automatically generated checkpoint…」的注入上下文行。
5. 三个状态行都不破坏消息气泡布局；操作栏只在 turnEnd 消息上出现。

另：`bash <repo-root>/scripts/ui-visual.sh` 可跑 `turn-status-notices` / `compaction-cards` 两个场景截图（DOM 级断言已全过，截图供人工复核排版）。

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成：typecheck + 268 测试 + build 全绿；视觉场景 DOM 断言通过 → done（worktree: agent/turn-status-notice-rows）
