# 回合导航（TurnNavigator：轨道栏 + 未载入回合跳转）

## 背景（源自 dsh-0.1.2-interaction-gaps 调研，官方 0.1.2 实现已核实）

官方 `TurnNavigator.tsx`：会话区顶部垂直回合刻度栏，每个回合一个小圆点（间距 10px），**未载入的回合也有圆点**（点击可跳转），hover 弹 preview 气泡（prompt 一行 + response 三行）。数据源两条：① 窗口内回合来自 Chat 快照导航索引；② **未载入回合列表来自 host 侧独立投影 `turnOutline`**（packages/session/session-turn-outline：以 `turn/start` 为锚，带整份日志所有回合 {turn, seq, prompt, response}）。跳转逻辑：释放底部吸底 → `session.loadThrough(seq)` 循环往前翻页直到覆盖目标 seq → 定位 `[data-chat-turn]` 行。

## dsh-one 现状

只有滚动触发的「加载更早」（historyWindow + session/page 前翻页，loadEarlier），无回合栏、无 turnOutline 投影、无跳转。机制等价物齐全（historyWindow 就是 loadThrough 前身；增量更新阶段 2 已合入，跳转定位与行结构更稳）。

## 方案（P1，中等——主要是投影订阅 + UI）

1. **host 侧投影**：`chatSession`（或 controller）加 `turnOutline` 投影通道——以 `turn/start` 为锚收集整份日志的 {turn, seq, prompt, response}（不依赖窗口，未载入回合照常收集；订阅 `$events`/日志流，随会话增补）。数据契约在 chatContract 加快照或独立消息。
2. **webview 侧轨道栏**：会话区顶部（标题下/消息流上方）垂直（或横向，以官方为准——官方是垂直刻度栏）回合轨道：每个回合小圆点（已载入/未载入同显），hover preview 气泡，点击未载入 → 释放吸底 + `loadEarlier`/新 `session.page` 循环翻页直到覆盖目标 seq → 定位到对应回合行（`[data-chat-turn]` 或消息 id 定位——阶段 2 的增量更新下用 msg id 定位一致性更好）。
3. 与「加载更早」按钮共存：older 入口保留，轨道栏是补充视图；滚动恢复/贴底跟随语义不变。

## 验收

- 轨道栏显示、未载入回合可见可点，点击后翻页到目标并定位（消息 id 检查）；hover preview 内容正确；流式增量更新下轨道不闪（阶段 2 基建）。
- harness 场景（构造长会话 + 未载入状态）+ 截图；真实 dsh 会话（多回合）沙盒回归。
- 报告按 SKILL 流程 5。

## 变更记录

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P1 项）→ open

- 2026-09-05 认领（open → doing）：阶段 3-P1 回合导航开发 session 认领，worktree slug chat-stage3-p1
