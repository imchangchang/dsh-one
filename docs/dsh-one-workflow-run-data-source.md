# dsh-one 获取 workflow run→member 数据：数据源与集成方向

> 研究目标：确认 dsh-one（VS Code 扩展）能否拿到「workflow/后台任务展开显示多个成员」的 run→member 数据，确定数据来源与集成方向。纯研究，未改任何代码。
>
> 结论先行：**可行**。四类 `tool-workflow/*` 事件是 durable SessionEvent，dsh-one 现有两条通道都覆盖（mux 流 `session/event` 帧 = live；`session.history` = 基线/回放），只是目前事件到达后被静默忽略。`session/jobs` 扁平数据不含 workflow，不能分组复用，必须走 tool-workflow 事件折叠。

## 1. 会话事件流里有没有 tool-workflow 事件？

**有，且是 durable SessionEvent**。类型侧与运行时都已确认：

- `dsh-tool-workflow/lib/types/types.d.ts:10-32` 定义四类事件数据：
  - `ToolWorkflowRunStartData` `{runId, name}`
  - `ToolWorkflowAgentStartData` `{runId, seq, label, phase?, childId}`
  - `ToolWorkflowAgentEndData` `{runId, seq, outcome}`
  - `ToolWorkflowRunEndData` `{runId, stopReason}`
- `:33-56` 通过 `declare module '@deepseek-ai/dsh-session/types'` 把四个键 `tool-workflow/run-start|agent-start|agent-end|run-end` 合入 `SessionEventMap`——它们是标准 SessionEvent（事件名就是 `tool-workflow/...` 前缀，无独立常量）。
- `dsh-session/lib/types/types.d.ts:223-359` `SessionEventMap` 是 merge-extensible interface；`:361` `SessionEventType = keyof SessionEventMap`；`:425-457` `SessionEvent` envelope = `{type, seq, time, data}`（注意时间字段叫 `time` 不叫 `ts`；**事件本身不含 sessionId**，由 wire 帧携带）。运行时列入 `dsh-session/lib/types/known-event-types.js:55-58`。
- 写入路径：workflow 工具执行期间 `session.append` 到**调用它的父 Session 日志**（`dsh-tool-workflow/lib/index.js` 的 `createWorkflowRecorder` L37-88：`start` L70-75 写 run-start、`ctx.on("workflow/agent-start"|"agent-end")` L49-68、`finish` L76-83 写 run-end；工具 `execute` L231-270 在 run 生命周期内调用）。上游 `workflow/*` 事件由 `dsh-workflow-worker-thread/lib/index.js:895-909` 的 `emitWorkflowEvent` 发出。

**dsh-one 侧现状**：订阅通道已打通，事件到达后被丢弃。

- 订阅：`ChatSessionController.attach`（`src/server/chatSession.ts:582-589`）→ `subscribeMuxEvents`（`src/server/muxEvents.ts:22-55`）打开 `WS /api/events.mux`。
- `onFrame`（`src/server/chatSession.ts:715`）`case 'session/event'`（`:736-753`）：把 `payload.event` 作为 `SessionEventLike` 原样传给 `foldPresetMarkers` + `folder.applyEvent`——对事件类型无任何过滤，四类事件都会到达。
- 处理现状：`ConversationFolder.applyEvent`（`src/pure/conversation.ts:211-356`）的 `default` 分支 `return false`（`:353-355`），`tool-workflow/*` 被静默忽略；`foldPresetMarkers`（`chatSession.ts:633-646`）只认 `turn/start`、`agent-preset/selected`。所以「事件到达、未处理、不影响现有渲染」。

## 2. 拿到四类事件的具体路径

### 路径 A：mux 流 `session/event` 帧（live）——可用

host 端 mux 实现（`dsh-host-apiproxy/lib/index.js:3527-3567`）：

- mux 是**全局广播**：打开时对 `ctx.sessions.list()` 每个会话发 `session/subscribed` 基线帧（L3533-3534），随后挂全局 `ctx.on("session/event", ...)`（L3556-3567）把**每次 commit 的事件原样透传**：`queue.push(frame({type: "session/event", sessionId, event, ...view}))`。**不过滤事件类型**——`view` 只为 `tool/call`、`tool/result` 生成，无 view 的事件照样推送。
- 事件源：`Session.append`（`dsh-session/lib/index.js:1471-1476`）对每个落盘事件触发 cordis `session/event` 火线。
- dsh-one 无需任何显式 attach：帧带 `sessionId`，`ChatSessionController.onFrame` 已按 `payload.sessionId === this.sessionId` 过滤（`chatSession.ts:722`）。
- 注意：live 火线只在会话**在内存（attached）**时存在。workflow 工具是同步执行的（工具 `await run.result`，整个 run 在 turn 内），父会话在 turn 期间必然 attached，所以四类事件落盘时 live 可达；会话冷掉后无 live 事件——由路径 B 兜底。

### 路径 B：`session.history`（基线 / 回放）——可用

- dsh-one `loadBaseline`（`chatSession.ts:517-549`）→ `sessionHistory`（`src/server/dshRpc.ts:333-339`，`callRpc('session.history')`）。
- host `history` handler（`dsh-host-apiproxy/lib/index.js:2552-2576`）+ `historyPage`（`:1386-1397`）：窗口内**所有事件原样返回** `{event, view?}`，不过滤类型。
- 事件是 durable 的（写入父会话日志），重启/重连后 history 可完整回放。dsh-one 断流重连触发 `rebaseline`（`chatSession.ts:615-630`）重新走 `loadBaseline`——折叠逻辑只要挂在 folder/controller 里就自动恢复。「加载更早」`loadEarlier`（`:431-455`）向前翻页，能把更早的 `run-start` 补进来（对应官方「update 历史尾页 pending，直到更早页面补入唯一 start」的语义，见下节）。

### 其他通道核查（均不含 run→member 结构）

| 通道 | 内容 | 结论 |
|---|---|---|
| `session.list` | `SessionSummary`（`dsh-host-apiproxy/lib/types/api/sessions.d.ts:177+`）：sessionId/title/blank/running/origin/parentSessionId/cwd/agentPreset/projections | ✗ 无 workflow 字段 |
| `session/jobs` | `JobView` 扁平（`jobs.d.ts:15-34`） | ✗ 见第 3 节 |
| `subagent.history` | 读成员子会话自己的历史 | ✗ 只有成员内部 log，无 run 结构 |
| 事件枚举 API | — | 无 `listEvents` 命名 API（客户端历史通道就是 `SessionsApi.history` + `EventsApi.mux` 两条） |

## 3. workflow 运行时 `state.jobs` / `jobsBySession` 里长什么样

**workflow 运行本身不注册 job，成员也不注册 job**——`session/jobs` 里没有任何 workflow 相关行：

- `dsh-tool-workflow/lib/index.js` 全文件无 `jobs` 引用（workflow 不注册 job）。
- 成员由 workflow 引擎直接 `this.subagents.start(...)` 启动（`dsh-workflow-worker-thread/lib/index.js:482`），**不经 jobs 注册**。jobs 只覆盖工具型后台任务：bash/pwsh（`dsh-tool-bash`、`dsh-tool-pwsh` 的 `jobs.start`）、subagent 工具 background 模式（`dsh-tool-subagent/lib/index.js:251-254`，`kind: "subagent"`）。
- 因此父会话的 `session/jobs` 帧在 workflow 运行期间为空（除非父代理同时跑了其他后台工具）；成员子会话若有自己的后台任务，出现在**各自 sessionId** 的 key 下（jobs 按 owner 作用域，host mux 基线 `jobs.list(ctx.agents.get(session.id))`，`dsh-host-apiproxy/lib/index.js:3551`）。

**扁平 jobs 无法分组复用**：

- `JobView`（`jobs.d.ts:15-34`）只有 `id/kind/label/status/detail/startedAt/finishedAt`，无 runId/phase/childId/members。
- workflow 根本不在 jobs 里，谈不上分组。
- dsh-one 现有 `JobsStore`（`src/ui/jobsStore.ts:94-120` 只收 `session/jobs` 帧）+ `activityTree.ts` 是纯扁平模型，与 run→member 不搭。

顺带确认：dsh-one 头部「N 个子代理」chip（`src/ui/chatView.ts:1007-1014`）基于 `session.list` 里 `parentSessionId === 当前会话` 的行——能看到成员会话（扁平、running 位 + updatedAt），但分不出 run/phase、拿不到成员 outcome，不能替代 workflow-run 数据。

## 4. 结论 + 集成方向

### 可行性

数据源充分：四类 `tool-workflow/*` 是 durable SessionEvent，live（mux `session/event`）+ 基线（`session.history`）两条通道 dsh-one 都已订阅/调用，事件目前只是「到达后未处理」。构建 `{name, status, phases[{key, phase, members[{seq, label, childId, status}]}]}` 完全可行，且**比官方简单**——不需要 durable 节点引擎，一个状态对象 + 增量折叠即可；回放/重连一致性由 history baseline + mux live 天然覆盖（与官方同机制：事件写进父会话日志，前端回放/追加得同一状态）。

### 建议集成路径（复用现有事件管线）

1. **纯函数折叠**（新增 `src/pure/workflowRun.ts`，可单测）：
   - 折叠状态：`Map<runId, {name, members: Map<seq, {seq, label, phase?, childId, outcome?}>, stopReason?}>`。
   - 事件处理（对齐官方 `workflowRunDefinition`，`dsh-client-ui-workflow-run/lib/client.js:571-615` 的 match/start/update）：
     - `run-start` → 建 `{name, members: []}`；
     - `agent-start` → push `{seq, label, phase?, childId}`；
     - `agent-end` → 按 `seq` 回填 `outcome`；
     - `run-end` → 设 `stopReason`。
   - 投影（`projectWorkflow` 简化版，client.js:516-548）：按 `phase`（undefined→null 组）分组；status 推导——run：`stopReason` 存在则 `completed→completed / cancelled→cancelled / error→failed`（`WorkflowStopReason`，`dsh-workflow/lib/types/types.d.ts:55`），否则 `running`；member：`outcome` 存在则 `completed→completed / cancelled→cancelled / failed→failed`（`WorkflowAgentOutcome`，`:98`），否则 `running`。
   - 官方的 `interrupted` 语义（stopReason/outcome 缺失 + 所在 turn/step 已关闭 = interrupted，client.js:512-518）依赖 location 模型，dsh-one 没有；可省略，或用 `turn/end` 近似（可选增强）。
   - 「run-start 落在历史窗口外」：与官方同款处理——update 事件先缓存，补到 start 后整段重建（官方 README「持久状态与回放」）。

2. **接入 `ChatSessionController`**（`src/server/chatSession.ts`）：
   - baseline：`loadBaseline`（:517-549）对 `page.events` 折叠（与 `folder.applyHistory` 并列）；
   - live：`onFrame` `case 'session/event'`（:736-753）折叠 `tool-workflow/*`（在 `folder.applyEvent` 之外，或扩展其 default 分支）；
   - 重连 `rebaseline`（:615-630）与「加载更早」`loadEarlier`（:431-455）自动覆盖（走同一折叠路径）。

3. **契约与 UI**：
   - `src/pure/chatContract.ts`：`ChatState` 加 `workflowRuns?: WorkflowRunView[]`（形状即第 4.1 节投影结果，status 五值 `running/completed/failed/cancelled/interrupted`）；`getState`（`chatSession.ts:310-332`）随快照带出。
   - 渲染：官方卡片的视觉/文案/展开折叠状态机已在本仓库 `docs/dsh-web-workflow-run-card-research.md` 第 1-6 节整理（StateDot 语义、`phaseStatusSummary` 的「运行中 2 · 已完成 1」聚合文案、`mode: abnormal|running|clean` 的自动展开/延迟折叠状态机），可直接照搬。放置位置两个选项：聊天流里作为新消息 kind（对齐官方 chat 节点，改动大），或头部 chip 下拉区（复用现有 jobs menu 骨架，改动小）。
   - 链路：`ChatSessionController.getState()` → `ChatViewProvider.push`（`chatView.ts:884-887` 一带）→ `view.webview.postMessage` → `src/ui/chat/webview.ts`（3025 行，ChatState 渲染端）加卡片。

### 涉及文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/pure/workflowRun.ts` | 新增 | `WorkflowRunView` 类型 + 四事件折叠 + 投影纯函数 |
| `src/server/chatSession.ts` | 改 | baseline/live/rebaseline 三处接入折叠；`getState` 加 `workflowRuns` |
| `src/pure/chatContract.ts` | 改 | `ChatState` 加 `workflowRuns?` |
| `src/ui/chatView.ts` | 改 | 快照转发（若渲染在头部，则在 `composeHeader` 合成） |
| `src/ui/chat/webview.ts` | 改 | 卡片渲染（视觉/文案照搬官方，见既有研究文档） |

### 风险与注意

- live 事件依赖父会话 attached：workflow 工具同步执行、turn 内必然 attached，实际无缺口；扩展关闭期间跑完的 workflow，下次打开由 history 回放（有）。
- mux 断流重连：`rebaseline` 重拉 history，折叠自动恢复（workflow 没有 jobs/queue 那样的整帧快照，靠 history 一致性，与官方同款机制）。
- 不需要改后端、不需要新增 RPC。
