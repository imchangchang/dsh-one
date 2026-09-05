# 排队消息在会话切换后丢失（晚订阅者收不到 control baseline）

## 背景与现象

对话中有排队消息时，切换 tab（在聊天界面点侧栏其他会话再切回原会话，或窗口 reload 恢复会话）后，输入框上方的排队信息消失。

## 根因

dsh 0.1.2 的排队消息是**非持久事件**，只由共享 `session/control` 流承载（`src/server/modernStreams.ts` 的 `subscribeControlStream`，refcounted per origin）：

- baseline 帧（含 `queues` / `jobs` / `projections` 全量快照）只在逻辑流**创建时**由服务端推一次；
- `subscribeControlStream` 的晚订阅者（`state.subscription !== null` 时 `startControlStream` 直接返回）**收不到 baseline**，只接收后续增量帧。

`JobsStore`（`src/ui/jobsStore.ts`）在服务 running 时一直订阅这条共享流，所以**任何** `ChatSessionController` 都是晚订阅者。平时能显示排队消息，是因为发送 prompt 后服务端推了 `queue` 增量帧；一旦 controller 重建（会话切换 `replaceWith`、服务重启恢复、窗口 reload 恢复），`this.queue` 清空，之后若无新事件就再也等不到 queue 帧。

增量帧（`queue` / `jobs` / `projection`）会广播给所有 handler，晚订阅者能收到，但没有「当前完整状态」可用。

## 建议方案

在 `ControlStreamState` 缓存最近一次完整快照（baseline 的 `queues`/`jobs`/`projections` 三域 + 之后增量帧的合并），晚订阅者注册时重放一个合成的 baseline 帧。对齐 `subscribeModernEvents` 已有的 late-subscriber 重放模式（waterfall pending 重放）。

注意：合成的 projection 帧 seq 取增量帧的原值、asOfSeq 取合并后的 max——增量帧 seq 严格递增，重放后不会被 `seq <= xxxSeq` 误挡。合成 baseline 只含缓存的域，缺失域不处理（`applyModernControlBaseline` / jobsStore 对缺失域本来就跳过）。

## 涉及代码位置

- `src/server/modernStreams.ts`：`ControlStreamState` 与 `subscribeControlStream` / `startControlStream`
- `src/server/chatSession.ts`：`onModernControl` / `applyModernControlBaseline`（消费端，不用改）
- `src/ui/jobsStore.ts`：另一个晚订阅者（同样受益，不用改）

- 2026-09-06 认领（worktree: agent/queue-lost-after-session-switch）→ doing
