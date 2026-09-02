# 消息级计时指标缺失（ranFor / ttft / tps）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 每条 assistant 消息尾部显示消息级计时（`dsh-client-ui-conversation` `MessageIconActions`，lib/client.js:5032）：时间 + 「ran for 2m42s · ttft 1.2s · 95 t/s」。

dsh-one `renderAssistantActions`（webview.ts:2490）只有 copy/👍/👎/分支，无消息级时钟与 ranFor/ttft/tps；这些指标只在会话级 statsLine 里有（webview.ts:1000）。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（MessageIconActions）
- dsh-one：`src/pure/chatContract.ts`（消息级耗时/ttft/tps 字段，host 侧是否暴露待确认）、`src/ui/chat/webview.ts`（renderAssistantActions）

## 调研结论（2026-09-01，host 数据链路）

**可行**：host 事件流（mux `session/event` 帧）透传完整 `SessionEvent`（含 `time`），turn 级计时所需事件全在：
- `turn/start` / `turn/end` 的 `time` → 总耗时（runMs）
- `step/start` 的 `time` → 首 token 基准
- `assistant/chunk` 首个非空 delta 的 `time` → firstTokenTime（对齐官方 isTokenDelta）
- `assistant/message` 的 `time` + `usage.outputTokens` → 解码耗时与吞吐

官方 web 的推导（`dsh-client-ui-conversation` turn-metrics.js / TurnTailNodeView）：runMs 是 turn 级（end−start）；ttft 取 turn 内最低 step；tps = ΣoutputTokens ÷ Σ解码耗时。窗口分页切掉所需事件时对应指标缺省。

## 实现（2026-09-01，worktree: agent/message-turn-timing-metrics）

- `src/pure/chatContract.ts`：`ChatAssistantMessage.timing?: ChatTurnTiming`（time / runMs / ttftMs / tokensPerSecond，字段按可用性缺省）
- `src/pure/conversation.ts`：折叠时记录 turn/start、step/start、首个非空 delta、assistant/message+usage 的时间戳，turn/end 时聚合挂到 turnEnd 消息（`turnTimingOf`，对齐官方 deriveTurnMetrics 窗口语义）
- `src/ui/chat/webview.ts`：`renderAssistantActions` 行尾渲染时钟 + 「用时 x分x秒 · 首 token x.x秒 · x tok/s」（官方 zh 文案；同日 HH:MM，跨日带日期前缀）
- `src/ui/chatView.ts`：`.msg-timing` 样式（次级灰、nowrap、tabular-nums）
- `test/conversation.test.ts`：6 个新测试（全指标 / 多 step 聚合 / 窗口外缺省 / 无 usage / 中断回退 / re-baseline 不泄漏）
- `test/ui/scenarios.js`：新增 `message-timing` 视觉场景

**人工验收方法**（真实 VSCode dev-ui-test）：
1. `cd <repo-root>/.worktrees/message-turn-timing-metrics && bash <repo-root>/scripts/dev-ui-test.sh`
2. 在 chat 面板发一条消息等完整回复，回复底部操作栏（复制/👍/👎/分支）**行尾**出现「HH:MM · 用时 x分x秒 · 首 token x.x秒 · x tok/s」，灰色小字、与图标同行居中；跨日历史消息显示日期前缀
3. 流式过程中不显示计时（turn/end 后才出现）；中断（停止）的消息只有时钟+用时、无 tps（usage 缺失时同理）；「加载更早」翻出的旧消息按窗口内事件可用性显示部分指标
4. 视觉截图备查：`/tmp/dsh-ui-shots/message-timing.png`（WebBridge 渲染的 message-timing 场景，DOM 已核对：`23:35·用时 2分42秒·首 token 1.2秒·95 tok/s` 与缺 tps 形态）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过 → done
