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

## 修复方向（待确认，未动手）

最小修：`replaceWith` 里把三个 pending 一并清空（换会话 = 旧切换意图作废）。预期同时覆盖 preset/workspace 同款泄漏。是否还要处理「运行输出中懒切换不可见/需发送才落地」的 UX，另议。

## 变更记录

- 2026-09-03 用户反馈：A 输出中切权限卡住，到 B 发消息时权限切换到 B 落地 → 代码核实完整链路（tab 复用不清 pending + 发送时落地到当前 tab 的 controller）→ 根因确认 → 记入 open/（未开始修改）。
- 2026-09-03 用户补充：切换发生在空白会话（hero）里，正常消息流对话没有权限切换（与 DSH web 一致）→ 复现链修正为「A 输出中新建空白会话（同 tab 替换）→ hero 里切权限 → 点回 A（同 tab 再替换）→ A 发送时落地到 A」，根因不变（pending 挂 tab、replaceWith 不清、发送时落地）。
