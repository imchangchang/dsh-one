# 会话列表：点开未读会话时列表瞬时重排（粘滞排序）

## 背景与现象

未读会话在列表里作为「活跃」整体前置。用户点开一个未读会话时，未读状态当场消失，该会话立刻掉回按 updatedAt 排序的位置，下面的行整体上移——用户亲手触发、感知最强的列表跳动。同样的跳法还有：running 会话跑完、pending 审批/提问被处理后掉出活跃层。

## 根因

- 排序管线在 `src/pure/sessionTree.ts` `buildSessionTree`：组内顺序 = 置顶 → 活跃（running / 有运行中后代 / unread / pendingInteraction）→ 标签组 → 空闲，活跃组内按 updatedAt 降序。
- 点开即时清未读：`src/ui/chatView.ts` 四个打开入口（约 256/301/320/336 行）都立刻 `store.setUnread(sessionId, false)`；`setAttachedSessions`（`src/ui/sessionsStore.ts` 约 792 行）同时清掉「轮次完成」自动未读标记（`completed` 集合，与手动 unread 在 `rebuildModel` 约 1306 行合流成 `unreadDisplay`）。两者都触发 `rebuildModel()` + 推送快照，列表当场重排。

## 建议方案（已与用户确认方向：B 粘滞排序）

点开照常清未读（绿点/加粗立即消失），但排序用的「活跃」判定加**粘滞集合**：本次因用户打开而变已读的会话，暂时仍按原位置排，到边界再真实归位。

已拍板的细节（用户确认按建议执行）：

- **粘滞边界**：列表数据下一次有真实变化时清空粘滞集合——新事件（新轮次完成/新会话/运行状态变化等来自 dsh 的帧或刷新）到达即真实归位；面板重载自然也清（粘滞集合只存内存）。
- **覆盖范围**：统一粘滞「活跃标志消失」的所有情况——用户点开已读、running 完成、pending 处理完，都保持原位置到下一次真实数据变化。实现上即「渲染位置粘滞」而非只针对 unread 特判。
- 粘滞集合放 `sessionsStore`（内存即可，不持久化），经 view options 传入 `buildSessionTree`；`test/sessionTree.test.ts` 补排序用例。

被否掉的备选：A 未读不参与排序（放弃冒泡，用户不接受）；C FLIP 动画（治标，工作量大）；D 推迟已读时机（动「打开即已读」语义，牵连 completed/attached 逻辑）。

## 涉及代码位置

- `src/pure/sessionTree.ts`（`buildSessionTree` 活跃判定与排序，约 298-348 行）
- `src/ui/sessionsStore.ts`（`setUnread` 约 701 行、`rebuildModel` 约 1303 行、view options 组装）
- `src/ui/chatView.ts`（打开即已读的四个入口）
- `test/sessionTree.test.ts`（排序用例）

## 变更记录

- 2025-06-09 用户提出「点开未读会话列表顺序会变，很奇怪」，讨论后确认走粘滞排序方案 → open
- 2025-06-09 两个实现细节拍板：边界 = 下一次真实数据变化；范围 = 活跃标志消失统一粘滞（含 running 完成/pending 处理完）
