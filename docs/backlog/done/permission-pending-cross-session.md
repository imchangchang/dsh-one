# 权限（preset）懒切换 pending 跨会话泄漏：在 A 会话点选，发送时落到 B 会话

记录于 2026-09-03。用户反馈：对话 A 中切换权限模式时，若 A 正在输出（消息流运行中），切换看起来卡住不生效；随后在另一个对话 B 里发送消息，权限切换却在 B 里落地执行了（`/permission` 打到 B 会话）。怀疑与「切换模式软状态」（workspace/preset/权限的懒切换 pending，commit deaf54a 引入）有关。

## 现象（代码核实，未实机复现）

懒切换语义：点权限 pill 只记 pending（零 RPC、pill 显示目标模式），真正 `/permission` 命令推迟到**发送时**落地（`resolvePendingPermission`）。

**用户补充关键信息（2026-09-03）：切换发生在空白会话（hero、无消息）里**——正常消息流对话没有权限切换入口（与 DSH web 一致），需求场景是「新会话开始前先定权限模式」。完整链条：

1. 会话 A（tab 1）运行输出中；用户点「新建会话」→ `openSession(blank)` 复用活动 tab 1（无草稿）→ `replaceWith` 把 tab 1 换成空白会话（A 的 controller 释放，A 服务端继续跑）；
2. 空白 hero 里点权限 pill 选目标 → 只写入该 tab host 的 `ChatTabHost.pendingPermission`，pill 显示目标模式（=「卡住发不出去」的观感：hero 不发消息不落地）；
3. 用户点侧栏 A（想查看输出）→ A 已无 tab → `openSession(A)` 复用同一 tab → `replaceWith` 又把 tab 换回 A——**pending 没清，跟着 tab 走**；
4. A 仍输出中，用户发送消息 → send handler 的 `resolvePendingPermission` 把空白会话留下的 pending 对 **A 的 controller** 执行 `/permission`。

「跑到另一个对话发送出去」= 第 3、4 步：pending 挂的是 tab 不是会话，tab 跨会话复用（A→空白→A 或任意 B）时旧切换意图贴着 tab 保留，发送时落在新会话上。

## 根因（已核实）

pending 状态挂在 `ChatTabHost`（per-tab），但 tab 是**跨会话复用**的：`openSession` 默认「在当前活动 tab 打开」，`replaceWith`（src/ui/chatTab.ts:331）只清了暂存附件、脏位、标题缓存，**没有清三个懒切换 pending**（`pendingWorkspaceId` / `pendingPresetId` / `pendingPermission`）。pending 只能「落地后清零」（src/ui/chatView.ts:647/674/702），没有「会话变更即清」路径。于是同一 tab 换会话后，旧会话的 pending 在新会话发送时被当作本会话的待切换意图执行。

波及面：不只权限——`pendingPresetId` 同理会把 `setAgentPreset` 打到 B；`pendingWorkspaceId` 更重，会把 B 的 tab 用 `ensureSession` 换成目标 workspace 的会话（会话直接被换走）。

## 涉及代码位置

- `src/ui/chatTab.ts` — `replaceWith`（:331，漏清 pending）与三个 pending 字段（:160-172）
- `src/ui/chatView.ts` — `openSession`（:216）/ `replaceTabSession`（:300）；`setPendingPermission`（:689）/ `resolvePendingPermission`（:699）
- `src/ui/chatMessages.ts` — send handler 的落地顺序（:314-320）

## 修复方向（已确认，未实施）

**已拍板方案 C（per-session intent 归档 + 发送时原子消费）：**

- `src/ui/chatTab.ts`：三个 pending 字段 → `pendingIntentBySession: Map<string, SendIntent>`（SendIntent = workspace/preset/permission），含读写/清 helper；tab 销毁即随对象回收
- `src/ui/chatView.ts`：三个 `setPending*` 改写成当前会话条目；`composeHeader` 覆盖改从 intent 读；`resolvePending*` 收口为 `applySendIntent(host)`（发送开始时一次性快照当前 tab intent，按序执行：workspace 失败短路=提示+取消发送，preset/permission 失败只记日志；消费后清条目）
- `src/ui/chatMessages.ts`：send handler 调用收口后的接口
- `ChatTabHostActions`：三个 set 保留，resolve 合成一个

换会话零处理（结构上不可能串台）；切回原会话 pending 保留（与草稿/附件生命周期一致）；组合意图（切 workspace 同时切权限）落点正确。

## 变更记录

- 2026-09-03 用户反馈：A 输出中切权限卡住，到 B 发消息时权限切换到 B 落地 → 代码核实完整链路（tab 复用不清 pending + 发送时落地到当前 tab 的 controller）→ 根因确认 → 记入 open/（未开始修改）。
- 2026-09-03 用户补充：切换发生在空白会话（hero）里，正常消息流对话没有权限切换（与 DSH web 一致）→ 复现链修正为「A 输出中新建空白会话（同 tab 替换）→ hero 里切权限 → 点回 A（同 tab 再替换）→ A 发送时落地到 A」，根因不变（pending 挂 tab、replaceWith 不清、发送时落地）。
- 2026-09-03 方案探讨（用户要求架构层面审视，不做最小改动）：定性——三个 pending 是「会话级软状态」却挂在 tab 的裸字段上，而 tab 跨会话复用（产品决策），属于**结构性错位**，补一行清理只是治标，后续新增同类状态还会再漏。参照系：webview 侧同类状态（草稿 composerDrafts、附件 stagedPerSession）已用「per-session Map 归档」范式处理，pending 是唯一没对齐的。方案对比：A 最小改（replaceWith 清字段，意图作废，且下次还会漏）；B 收拢为 SendIntent 对象 + replaceWith 整组作废（防漏但语义与草稿不一致）；C（推荐）per-session intent 归档（`Map<sessionId, SendIntent>`，换会话零处理、切回恢复、结构性不串台）+ 发送时原子快照消费（applySendIntent 收口，一并解决 workspace+permission 组合意图落在目标会话的问题）。
- 2026-09-03 用户拍板采用推荐方案 C，仅记录 backlog（未实施）；条目继续留在 open/，实施入口为「认领 → doing」。
- 2026-09-03 认领：worktree slug `permission-pending-cross-session`，按方案 C 实施（开发结果见条目完成时追加）。
- 2026-09-04 开发完成（slug `permission-pending-cross-session`，分支 agent/permission-pending-cross-session，HEAD 3e0c348）：chatTab.ts 三个 pending 裸字段 → `pendingIntentBySession: Map<sessionId, SendIntent>`（SendIntent = workspaceId/presetId/permission，含读 pendingIntentFor / 按域写 setPendingIntentField / 清 clearPendingIntent 三个 helper，tab 销毁随对象回收）；chatView.ts 三个 setPending* 改写当前会话条目、composeHeader 覆盖改从当前会话 intent 读、三个 resolvePending* 收口为 `applySendIntent(host)`（发送开始时快照当前 tab intent 并即清，按序执行：workspace 失败短路=提示+取消发送，preset/permission 失败只记日志；组合意图落点=切换后的目标会话）；chatMessages.ts send handler 调用收口接口；ChatTabHostActions 三个 set 保留、resolve 合成一个。自测：typecheck / test（386 通过）/ build 全绿；沙盒任务专属 ledger（test/sandbox/verify.permission-pending-cross-session.ledger.json + 渲染 report.html，报告 HTML 已 gitignore）发送链回归 R-01 通过（新建会话→发送→mock 回显命中、截图核对）。修复目标场景（tab 跨会话复用的 pending 串台）是宿主层行为——verify-driver 确定性链与 webview 独立渲染均覆盖不到，报告 coverageNote 已注明，留人工 dev-ui-test 验收；条目转 done/，待主线合入。
