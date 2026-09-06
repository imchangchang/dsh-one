# 会话列表：点开未读会话时列表瞬时重排（粘滞排序）

## 背景与现象

未读会话在列表里作为「活跃」整体前置。用户点开一个未读会话时，未读状态当场消失，该会话立刻掉回按 updatedAt 排序的位置，下面的行整体上移——用户亲手触发、感知最强的列表跳动。同样的跳法还有：running 会话跑完、pending 审批/提问被处理后掉出活跃层。

## 根因

- 排序管线在 `src/pure/sessionTree.ts` `buildSessionTree`：组内顺序 = 置顶 → 活跃（running / 有运行中后代 / unread / pendingInteraction）→ 标签组 → 空闲，活跃组内按 updatedAt 降序。
- 点开即时清未读：`src/ui/chatView.ts` 四个打开入口（约 256/301/320/336 行）都立刻 `store.setUnread(sessionId, false)`；`setAttachedSessions`（`src/ui/sessionsStore.ts` 约 792 行）同时清掉「轮次完成」自动未读标记（`completed` 集合，与手动 unread 在 `rebuildModel` 约 1306 行合流成 `unreadDisplay`）。两者都触发 `rebuildModel()` + 推送快照，列表当场重排。

## 建议方案（已与用户确认方向：B 粘滞排序）

点开照常清未读（绿点/加粗立即消失），但排序用的「活跃」判定加**粘滞集合**：本次因用户打开而变已读的会话，暂时仍按原位置排，到边界再真实归位。

待实现时拍板的细节：

- **粘滞边界**：候选 = 面板/webview 重载、手动刷新、或有新事件（新轮次完成/新会话）到达时清空。倾向「列表数据下一次有真实变化时」。
- **覆盖范围**：是否顺带把「running 完成掉出活跃层」也统一粘滞（非用户触发，可以一起做，也可以只先做未读）。
- 粘滞集合放 `sessionsStore`（内存即可，不持久化），经 view options 传入 `buildSessionTree`；`test/sessionTree.test.ts` 补排序用例。

被否掉的备选：A 未读不参与排序（放弃冒泡，用户不接受）；C FLIP 动画（治标，工作量大）；D 推迟已读时机（动「打开即已读」语义，牵连 completed/attached 逻辑）。

## 涉及代码位置

- `src/pure/sessionTree.ts`（`buildSessionTree` 活跃判定与排序，约 298-348 行）
- `src/ui/sessionsStore.ts`（`setUnread` 约 701 行、`rebuildModel` 约 1303 行、view options 组装）
- `src/ui/chatView.ts`（打开即已读的四个入口）
- `test/sessionTree.test.ts`（排序用例）

## 变更记录

- 2025-06-09 用户提出「点开未读会话列表顺序会变，很奇怪」，讨论后确认走粘滞排序方案 → open
