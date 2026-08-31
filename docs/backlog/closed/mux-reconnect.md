# 事件流断线重连的剩余缺口（jobs / host 两条订阅）

记录于 2026-09-01。聊天事件流的重连已于 2026-08-31 修复（bc23e7c），本条目记剩下的两条无重连订阅。

## 现状

三条长连接，重连覆盖不一：

| 订阅 | 用途 | 断线行为 |
| --- | --- | --- |
| `chatSession.ts` 的 mux 订阅 | 聊天消息/审批流 | **已有重连**：close 回调驱动 1s 翻倍退避（上限 30s），重连后重拉基线、缓冲事件按 seq 缝合（bc23e7c，可作参考实现） |
| `jobsStore.ts` 的 mux 全局订阅 | 头部「N 个后台任务」chip 数据 | 无重连，断流后任务列表静默停滞 |
| `hostEvents.ts`（`sessionsStore.ts` 消费） | 会话列表 host 帧增量 | 无重连（代码注释自承），断流后会话列表停在旧快照 |

触发场景与聊天流当年相同：host 重启、热重载、网络抖动、休眠唤醒。区别是这两条断了没有明显症状（列表只是「不更新」），比聊天流静默更容易被忽视。

## 建议方案

照抄 chatSession 的重连模式：subscribe 助手（`muxEvents.ts` / `hostEvents.ts`）上报 close，store 侧退避重订阅，重连后重拉基线（jobsStore 重放 session/jobs 基线帧、sessionsStore 重拉 session.list）再增量。两条独立，可分开做。

## 涉及代码位置

- `src/server/muxEvents.ts`、`src/ui/jobsStore.ts`（jobs 订阅）
- `src/server/hostEvents.ts`、`src/ui/sessionsStore.ts`（host 帧订阅）
- 参考实现：`src/server/chatSession.ts`（`RECONNECT_MAX_MS`、`reconnectAttempts`、重基线缝合）

## 变更记录

- 2026-08-31 认领（worktree: agent/mux-reconnect）→ doing
- 2026-08-31 开发完成，自测通过 → done
- 2026-08-31 主线合入测试通过，人工确认 → closed
