# 消息列表增量更新（替代每帧全量重建）

## 背景与现状（源自 chat-render-scaling 核实 §2，2026-09-09 快照，开发前按当时代码再核实）

- 窗口机制：附着只拉尾窗 50 条，loadEarlier 每页 50 条前翻（`src/pure/historyWindow.ts` HISTORY_WINDOW_MESSAGES=50）；`state.messages = folder.messages()`（chatSession.ts）全量透传 webview。
- 渲染：webview.ts `messages.textContent=''` + `appendMessageFlow(messages, state)` —— **每个快照全量重建全部消息 DOM**；快照节流 FLUSH_INTERVAL_MS=100（≈10Hz），流式时每帧全量重建。42 条简单消息 ≈ 641 个 DOM 节点（真实消息含 markdown/代码/操作栏会放大数倍）。
- 需与增量更新协调的既有机制：workflow run 卡按 anchorSeq 插流、顶部「加载更早」入口、尾部 turn status/steering 气泡、prepend 锚定补偿（真实 scrollHeight 差）、per-session 滚动存档、jump-latest、异步图片/详情高度、流式中的 hover 缓存恢复（阶段 1B 已合入）。

## 方案（保留原「增量更新」方向，虚拟化为后手）

- 改为**按消息 id/seq diff**：每个快照与现有 DOM 消息对照，只增（追加/插入）/删（移除）/改（重渲染变更消息）/序，其余消息 DOM 不动。
- **与虚拟化区别**：不做窗口化、不做总高度模型（消息高度可变问题与虚拟化无关，本方案避开）；只消除「每帧全量重建」的浪费。
- 必须保持的语义（逐条对照现有行为，不得回归）：消息顺序与渲染、滚动锚定（prepend/latest）、加载更早入口与行插入、workflow 卡 anchorSeq 插流定位、尾部 turn status/steering 气泡、per-session 滚动存档恢复、jump-latest、异步图片/详情高度、hover 缓存恢复（1B）、composer 无关区域不动。
- 边界：纯渲染层改造，不碰历史窗口/分页逻辑（loadEarlier/50 条语义不变）、不碰数据契约（SessionsSnapshot 形状不变）。

## 验收

- 流式场景：MutationObserver 统计 DOM 变更节点量显著下降（相对全量重建基线，给出对比数字）；消息滚动/顺序/锚定与改动前一致（基线场景 + 交互回归）。
- 全量回归：typecheck/test/build；harness 场景全量（含 conversation/steering/subagents/workflow 卡/加载更早等）；沙盒或 harness 流式重投 state 场景。
- 报告按 SKILL 流程 5（ledger → 驱动 → 截图/断言 → report.mjs），覆盖说明写清。

## 变更记录

- 2026-09-05 用户拍板开始阶段 2；从 chat-render-scaling（已 closed）拆分本条目 → open

- 2026-09-10 认领（open → doing）：阶段 2 消息列表增量更新开发 session 认领，worktree slug chat-render-incremental-update
- 2026-09-10 开发完成（doing → done，worktree agent/chat-render-incremental-update HEAD 27b3777）：实现消息列表增量更新——render() 不再每快照 `messages.textContent=''` 全量重建，改为按期望流（older 入口、消息行 + workflow 卡 anchorSeq 插流、命令通知、空态提示、turn-status、steering、jump-latest）与现有 DOM 按稳定 key 对账（reconcileFlow），未变行原元素保活，只对新增/删除/内容变化的行动 DOM。key 由消息 id 承担（旧位置键 m<下标> 在 loadEarlier 补页后与右键复制/hover 缓存/detail 展开态错位，一并消除）；行级定时器（turn-status clock/retry 倒计时）归行所有、dispose 清理；`.messages` 加 overflow-anchor:none 防原生锚定与程序补偿双补偿。验收：test/ui/mutation-driver.html 同一驱动 14 帧流式重投（改动前基线 added=238/removed=231/records=252 → 改动后 22/15/37，流式帧每帧 16/16 全量 → 1/1），终态 DOM 顺序逐项一致、finalTextHash 相同、mid-history 补页滚动补偿逐帧序列一致；沙盒（mock-llm+真 dsh+真扩展 vsix）5 项全过（真流式回显探针全程 added=9/removed=6、工具卡、bash 卡、提问面板、子代理）；harness 基线 33 场景截图核对（含 workflow-running/steering/history）+ harness 交互回归（details 展开保活、hover 缓存恢复、右键复制、流式追加）；typecheck + 477 单测 + build 全绿。报告 test/sandbox/verify.chat-render-incremental-update.report.html。注：mock 沙盒 settings 无 policy 段，bash 升级调用 dsh 默认放行（无审批面板，非本任务改动项）；「加载更早」50 条历史窗口场景由 harness 驱动页覆盖（沙盒不构造大历史）。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed；阶段 3（P1：token 用量明细 + 回合导航）待排
