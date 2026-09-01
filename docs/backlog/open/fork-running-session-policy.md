# fork 运行中会话的限制与不一致（可 fork 的判定待讨论）

记录于 2026-09-01。来源：验收 fork-grouped-as-subagent（2026-09-01 合入）时用户发现的新问题。2026-09-01 已委派只读探索核实根因（结论见下），方案待讨论。

## 背景与现象

fork 一个会话时存在限制/不一致：

- **不能 fork 正在运行（进行中/有输出）的 session**。
- **但如果这个 session 目前没有输出、但有子任务在跑，就可以 fork**。

即「可 fork」的判定疑似不是简单的 running/idle 二态。

## 根因（已核实，2026-09-01 探索）

**判定在 dsh 服务端（可改的 dsh-one 层不拦截、纯透传）**，且**不是按 running 拦截**：`dsh-host-apiproxy/lib/types/api-proxy.js` `sessions.fork`（约 L1975）从头到尾不读运行状态，只找事件流里有没有**已完成轮次（`turn/end`）**作 fork 切点（boundary）：没有 → 返回 `fork-unavailable`（L2003-2011，文案「session X has no completed turn to fork from」/「has not completed the turn containing event <atSeq>」）。

- 真正的判定字段是**「事件流里有没有可切的已完成轮次」**，不是 running/busy/hasOutput。用户对现象的归因（按 running/输出）是错的。
- **「无输出但子任务在跑」为何能 fork**：子代理是独立 session（`origin === 'subagent'`），父会话的 turn 在 spawn 子代理、把自己挂起等待时**早已 turn/end 收尾**（父 agent 变 idle 等子代理结果；dsh-subagent running/waiting/idle 状态机）。所以该会话事件流里有最后一个 turn/end → 服务器放行。⚠️ 前提是子代理以 background/continuable 模式跑、父 turn 已收尾；若前台阻塞模式，父 turn 可能未 turn/end，仍会 fork-unavailable（未实测，强推断）。
- **dsh one 的两个 fork 入口**：
  - 列表面板右键「分叉会话」（`sessionsWebview.ts` L858-866，**无 disabled 条件**，永远可点）→ 不带 `atSeq` → 服务端 fallback 到最后一个 turn/end：**只要历史上有过任一完成轮次就能 fork**；只有「从未完成过任何轮次」的会话报错。
  - 消息栏「分支」（chatView.ts L1622 `forkAt(atSeq)`）→ 带 `atSeq`，按钮只挂在已完成轮次的尾消息上（`m.seq !== undefined && !m.interrupted`，与官方一致）；指向进行中 turn 时服务端拒绝。
- **dsh web 官方对照：行为一致**（同一套服务端处理器）。差异只在**入口形态**：官方 web 没有会话列表级 fork 入口，fork 按钮只在已完成轮次的尾消息出现——即「轮次未结束」在官方 UI 上是**不出现 fork 按钮**而非报错；dsh-one 的列表右键 fork 会命中服务端报错。
- dsh-session 下层还有第二道校验（只拦边界非法：INVALID_BOUNDARY / OPEN_TURN），与 running 无关。

## 方案（方向，待讨论后定）

1. **dsh-one 侧 UI 收尾（推荐）**：列表面板「分叉会话」在「无任何已完成轮次」的会话上**禁用 + 提示**（对齐官方「轮次未结束不出现 fork」的体验，避免服务端报错）。判定条件 = 会话是否已有 turn/end（session.list 摘要数据可判断）。
2. **不改服务端判定**：真正「运行中也能 fork（切到上一个完成轮次）」已对不传 atSeq 的列表 fork 成立；消息栏 fork 的拒绝是官方语义（fork 必须落在已完成轮次上，否则子会话带半截 turn），建议保持。
3. 待实测确认：子代理前台阻塞模式下父 turn 是否未收尾（影响「无输出但子任务在跑」结论的成立条件）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`（列表「分叉会话」菜单，L858-866，无 disabled 条件）
- `src/ui/sessionsView.ts` / `src/extension.ts`（`sessionFork` → `forkSession(url, sessionId)`，不传 atSeq）
- `src/ui/chatView.ts` / `src/ui/chat/webview.ts`（消息栏 forkAt，只挂完成轮次尾消息）
- 服务端（不可改）：`dsh-host-apiproxy` `sessions.fork`（judging 在 L1975-2075）

## 变更记录

- 2026-09-01 记录 → open（想法：未确认，已委派探索核实根因）
- 2026-09-01 探索完成：根因确认（判定=有无已完成轮次，非 running），方案方向列出 → 待讨论
