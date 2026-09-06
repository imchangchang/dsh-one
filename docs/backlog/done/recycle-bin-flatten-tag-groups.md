# 回收站里不要保持标签组，直接平铺

## 背景与动机

用户提出（2026-09-06）：会话在标签组（Chrome 垂直标签式）里被移入回收站后，回收站里现在还按标签组块展示（组色 pill + 贯穿竖线 + 缩进 + 折叠），希望回收站内直接平铺，不保持标签组。

## 核实结论（2026-09-06，确认现象属实）

回收站保持标签组的链路有两条，都与主列表共用同一套机制：

1. **模型层**：`src/ui/sessionsStore.ts` 的 `rebuildModel()` 构建回收站视图模型 `recycleWorkspaces`（:1351-1363）时，直接复用了主列表同一份 `baseViewOptions`（:1319-1332，含 `tags` 标签组序 + `sessionTagFor` 会话→组映射）→ 纯层 `buildSessionTree`（`src/pure/sessionTree.ts` :330-335）对回收站会话同样按标签组聚合排序，节点也挂 `tagId`（:344-356）。
2. **渲染层**：`src/ui/sessionsWebview.ts` 的 `reconcileRecycleGroup`（:1623-1638）在回收站 workspace 组内直接复用 `tagBlockItems`（:1475），与主列表同一套标签组块渲染；行工厂换成 `recycleRowItem`。

附带发现（本条目一并处理或注明）：回收站里标签组块的折叠态读的是主列表同一个 `tagCollapsed`（workspaceState `sessions.tagCollapsed`，`tagBlockItems` :1481）——即主列表折叠的标签组在回收站里也折叠，互相影响；而回收站的 workspace 组折叠是独立持久化的（`recycleCollapsed`），两者不对称。

数据侧无需改动：移入回收站不清组归属是既定设计（见 closed/session-tag-groups「会话移入回收站/归档后残留不清理（恢复后组归属仍在）」），平铺只改视图层，恢复后回原组的行为不变。

## 期望

- 回收站内每个 workspace 组下直接平铺会话行，不渲染标签组块（无 pill/竖线/缩进/折叠）。
- 平铺顺序沿用当前 sort 键即可（回收站无置顶会话——置顶不能移入回收站；活跃优先层可保留或按现有排序，实现时定）。
- 回收站内标签组折叠状态不再有意义（折叠主列表标签组不影响回收站展示，反之亦然——平铺后天然解耦）。

## 涉及文件

- `src/ui/sessionsStore.ts`：回收站模型构建不再传 `tags`/`sessionTagFor`
- `src/ui/sessionsWebview.ts`：`reconcileRecycleGroup` 不走 `tagBlockItems`，直接平铺行
- `src/pure/sessionTree.ts`：无需改（不传 tags 即不聚合）；若保留活跃优先则确认现有行为
- `test/`：`sessionTree.test.ts` 可能有回收站 × 标签组组合断言需调整；`test/ui/scenarios.js` 回收站场景未含标签组内容，按需补

## 变更记录

- 2026-09-06 用户提出（回收站里不要保持标签组，直接平铺）；已核实现状属实（两组复用链路见上，含折叠态共享的连带发现）→ 建条目（open/，未开始开发）

- 2026-09-06 认领（open → doing）：用户拍板开发；改动点 = 回收站模型不传 tags/sessionTagFor + 回收站组内不走 tag 块直接平铺，数据侧（组归属保留）不动。

- 2026-09-06 开发完成（doing → done，worktree recycle-bin-flatten-tag-groups，branch agent/recycle-bin-flatten-tag-groups，done tag 8d71fc8）：改动两处——① sessionsStore.ts 回收站模型构建不传 tags/sessionTagFor（纯层不聚合、不挂 tagId，排序退化为活跃优先+sort 键；组归属数据不动，恢复后回原组不变）；② sessionsWebview.ts reconcileRecycleGroup 不再调 tagBlockItems，改为直接平铺行（连带清理 tagHeadSigs 共享收尾与过时注释）。新增 harness 场景 sessions-recycle-flat（回收站会话快照带 tagId 验证平铺 + 主列表对照 + DOM 断言）并进 BASELINE_SCENARIOS。自测全绿（typecheck/test 614/build）；沙盒报告 4 项全 pass（verify.recycle-bin-flatten-tag-groups.report.html，F-01 平铺核对 + R-01 既有回收站/标签组场景回归 + R-02 mock-llm 回显 + R-03 全量视觉 160 场景）。
