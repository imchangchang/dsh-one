# 回收站状态持久化：新开窗口后分组分类失效

## 背景与现象

用户实测（2026-09-05）：新开一个 VS Code 窗口之后，回收站里的「分类」就失效了——具体表现待核实（回收站视图按 workspace 分组与组头折叠态是否重置；回收站集合本身是否还在）。用户对比：本次 workspace-group-filter（3A 已合入）用全局 state（globalState）持久化分组，跨窗口/重启保留；回收站应该做同样持久化。

## 现状（已核实 2026-09-05）

- recycle-bin 实现：状态存 **workspaceState**（`sessions.recycleBin` 集合 + 组折叠态 `recycleCollapsed` 等，见 recycle-bin 条目与 sessionsStore.ts/chatContract.ts 的快照字段）。
- workspaceState 是 **per-workspace**（每个工作区/未打开工作区的窗口各自独立），开新窗口（尤其未打开同一工作区/untitled 窗口）读不到原窗口状态 → 回收站分类视图退化（用户观察成立）。reload 同窗口时保留（开发时沙盒实测过），但「新开窗口」跨窗口不保留。
- 分组功能（workspace-group-filter，已合入）同需求场景用的是 globalState 跨窗口方案——是本条目的参照系。
- **核实结论（2026-09-05）＝现象①：整个回收站集合丢失**。新开不同 workspace / untitled 窗口时 `sessions.recycleBin` 不在新窗口的 workspaceState 里 → 会话回主列表、回收站计数 0；折叠态 `sessions.recycleCollapsed` 同样丢失。依据：@types/vscode Memento 官方定义——workspaceState「stores state in the context of the currently opened workspace」（per-workspace 隔离），globalState「stores state independent of the current opened workspace」（跨窗口共享）。同 workspace 的第二个窗口可能共享 workspace 存储，但「新开窗口」（不同/无 workspace）语义下不保留，用户实测即此。

## 建议方案（方向，修复前先核实）

1. 先核实：新开窗口时是**整个回收站集合丢失**还是仅**折叠态/分组视图重置**（决定迁移范围——集合丢了意味着 dsh 未归档的会话在别的窗口能看到（未被本地回收站概念拦截）、跨窗口语义不一致）。
2. 迁移：`sessions.recycleBin`（集合 + 折叠态等）从 workspaceState 迁到 **globalState**（与分组功能同 key 分区，如 `sessions.recycleBinGlobal`），旧 workspaceState 数据一次性迁移清除（避免陈旧态在新窗口复活）。与 recycle-bin 条目「纯本地缓冲层」的定位一致——本地态理应是全局的（不随工作区隔离），除非有意按工作区隔离，需用户拍板。
3. 注意：回收站集合与 dsh 实际归档状态的同步逻辑（冷启动不清账保护）迁移时保持；归档成功后清集合、恢复时清集合的路径不受影响。
4. 验收：新开窗口（同 workspace 与 untitled 窗口）回收站分类与折叠态保留；reload 保留（回归）；分组功能不受影响。

## 涉及代码位置（初判）

- `src/ui/sessionsStore.ts`（sessions.recycleBin / recycleCollapsed 存取）
- `src/ui/chatContract.ts`（SessionsSnapshot 回收站字段）
- `src/ui/sessionsView.ts`（host 侧状态读写）
- 参照 `workspace-group-filter` 的 globalState key 分区（sessions.groups 等）

## 变更记录

- 2026-09-05 用户实测反馈：新开窗口后回收站分类失效，要求像分组功能一样持久化 → 建条目（open/，待核实根因与迁移范围）

- 2026-09-05 认领：worktree 开发 session（slug recycle-bin-persistence）开工，先按条目要点核实根因与迁移范围。

- 2026-09-05 开发完成（doing → done）：分支 agent/recycle-bin-persistence，HEAD **6d1d18a**（done/recycle-bin-persistence tag），dev-finish 自测全绿（typecheck / build / **470 tests** / check-i18n）。**实现**：`sessions.recycleBin` + `sessions.recycleCollapsed` 迁 **globalState**（key 字符串不变，与分组 `sessions.groups` 等互不冲突；旧 workspaceState 同 key 仅作迁移源）；构造器一次性迁移——globalState 有值（哪怕空数组）即权威，否则回读旧值写回新 key，旧 key 一律删除（避免陈旧态复活）；移入/批量移入/恢复/恢复全部/归档清理/折叠全部改走 `persistRecycleBin`/`persistRecycleCollapsed`；清账改调纯层 `pruneRecycleIds`，**冷启动不清账保护保留**（基线未就绪早退）。新增纯层 `src/pure/recycleBinState.ts` + 单测 `test/recycleBinState.test.ts`（5 项：数据清洗/迁移决策/冷启动保护/清账）。**报告说明**：无 UI 行为变化（webview 渲染与交互不变，仅存储位置 + 一次性迁移），按流程 5f 不建沙盒 ledger；跨窗口/重载持久化语义由**单测 + 官方 Memento API**（workspaceState per-workspace / globalState 跨窗口 / update(key, undefined) 删键）保证，code-server 沙盒无法验证新窗口且 reload 不可靠；新窗口场景待用户 dev-ui-test 人工验收回执。
