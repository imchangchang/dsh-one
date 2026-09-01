# fork 运行中会话的限制与不一致（可 fork 的判定待讨论）

记录于 2026-09-01。来源：验收 fork-grouped-as-subagent（2026-09-01 合入）时用户发现的新问题。想法：未确认，待探索 + 讨论。

## 背景与现象

fork 一个会话时存在限制/不一致：

- **不能 fork 正在运行（进行中/有输出）的 session**。
- **但如果这个 session 目前没有输出、但有子任务在跑，就可以 fork**。

即「可 fork」的判定疑似不是简单的 running/idle 二态，而是按「当前是否有输出/活动」来判断；同一会话在「有输出」与「无输出但子任务运行中」两种状态下 fork 行为不同，需要弄清楚服务端/客户端各层的判定逻辑，判断是否应该统一（对齐 dsh web 行为）。

## 现状

未核实（待探索）：

- dsh 服务端 `session.fork` 对 running 会话的限制在哪里（`dsh-session` / `dsh-host` / RPC 层），判定字段是什么（`hasOutput`？`status`？`busy`？）。
- dsh-one 侧有没有前置拦截，还是纯透传服务端行为。
- 「无输出但子任务在跑」为什么能绕过限制——是判定只看输出不看子任务，还是子任务运行不置 running 状态。
- dsh web 官方同场景下行为是否一致（应该对齐）。

## 方案

待探索结论 + 讨论后定。先记现象，探索产出根因后更新本条。

## 涉及代码位置（待探索确认）

- `node_modules/@deepseek-ai/dsh-*/` 服务端 fork 路径（`session.fork` RPC、`fork` 校验）
- `src/server/`（dsh-one 侧 fork 调用链，`sessionsStore`/`dshRpc`）

## 变更记录

- 2026-09-01 记录 → open（想法：未确认，已委派探索核实根因）
