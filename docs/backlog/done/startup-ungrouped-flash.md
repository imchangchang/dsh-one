# 启动期未分组组先于工作区显示

记录于 2026-09-02。现象（用户报告）：刚启动时 dsh 服务还在加载，侧栏工作区组都还没显示出来，「未分组」组头（空组头 + 新建按钮 /「添加工作区」引导）却已经显示出来了，感觉怪。

## 根因

`buildSessionTree`（src/pure/sessionTree.ts:281-300）恒合成「未分组」虚拟组并 push 到列表末尾——这是「新建未分组对话」入口恒可达的设计（见 closed/start-ungrouped-conversation）。

问题出在合成时机：`rebuildModel`（sessionsStore.ts:671）允许在**基线未就绪**时被调用。启动时序里服务从 starting → running 后：

1. `onStateChange`（sessionsStore.ts:392）订阅 host/mux 流后立即 `void this.refresh()`（异步拉基线）；
2. 基线拉到前，mux 流已连上并**重放历史 pending 帧**（approval/question requested，注释见 sessionsStore.ts:115-119），`onMuxFrame` → `rebuildModel()`；
3. 此时 `rawWorkspaces`/`rawSessions` 均为空，`buildSessionTree` 以空基线合成出 `[未分组组]` → pushSessions 推给 webview；
4. webview（sessionsWebview.ts:560）`snap.workspaces.every((w) => w.workspaceId === UNGROUPED_WORKSPACE_ID)` 判定「没有真实 workspace」→ 渲染「添加工作区」引导 + 未分组组头。

等 refresh 完成推来正常快照，工作区组才出现。未分组组头在基线未就绪时段占屏，就是用户看到的怪相。（refresh 失败/慢、或用户在基线就绪前触发搜索/排序等 rebuildModel 路径，同样复现。）

## 建议方案

区分「基线未就绪」与「确实没有 workspace」：

- `SessionsStore` 加 `baselineReady` 标志：refresh() 成功（基线赋值后）置 true；`onStateChange` 切换 url 代际时重置 false（服务重启后旧基线不可信）。
- snapshot() 带出标志；webview 渲染时 `serverState === 'running' && !baselineReady` 显示 Loading…（复用 `!snap` 分支的「Loading…」文案），不渲染未分组组头和「添加工作区」引导。
- refresh 失败保持 false：面板停留在 Loading，等下一次 refreshSoon（窗口可见/状态翻转/手动刷新）恢复——失败路径本来也无数据可渲染。

## 涉及代码位置

- `src/ui/sessionsStore.ts`：baselineReady 标志（onStateChange / refresh / snapshot）。
- `src/pure/chatContract.ts`：SessionsSnapshot 增加基线就绪字段（如有必要）。
- `src/ui/sessionsWebview.ts`：renderSessions 分支补未就绪先行判定。

## 变更记录

- 2026-09-02 问题核实、定位根因，记入 open/（未开始修改）。
- 2026-09-02 认领（open → doing），开始 worktree 开发修复。
- 2026-09-02 开发完成（doing → done）：store 加 baselineReady 标志（refresh 成功置 true、代际切换重置 false），快照带出；webview 在 serverState=running 且基线未就绪时显示 Loading，不渲染未分组组头/添加引导。typecheck + 337 单测 + build 通过；新增 sessions-baseline-loading（未就绪 → Loading）与 sessions-no-workspaces（基线就绪但无 workspace → 引导 + 未分组组头，对照）两个视觉场景，已截图核对。
