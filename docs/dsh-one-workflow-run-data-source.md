# dsh-one 获取 workflow run→member 数据：数据源与集成方向

写于 2026-09-01（自研聊天区时期），2026-09-20 复核。纯研究，当时未改任何代码。

**这份文件基本只剩数据源那部分有用**：它的落点是「dsh-one 自己折叠 `tool-workflow/*` 事件、在自研聊天区里渲染 workflow-run 卡」。旧聊天区已下线（#68），当年确实照它写了 `src/pure/workflowRun.ts`（还在仓库里，带单测），但输出（`ChatState.workflowRuns`）现在只有单测消费、没有渲染端——workflow 卡片由官方前端自己渲染。事件类型与写入路径这部分和 `docs/dsh-web-workflow-run-card-research.md` 第 5 节重复，要留可以只留第 1、3 节，第 2、4 节按历史处理。

**0.1.6-alpha.1 复核出的差异**：

- workflow 引擎包改名：撰写时记的 `dsh-workflow-worker-thread` 已不在安装里，现在是 `dsh-workflow-ptc`（`emitWorkflowEvent("workflow/agent-start", …)` 与 `this.subagents.start(...)` 都在这里）。
- `dsh-host-apiproxy` 已不存在（详见 `docs/dsh-one-todos-data-source.md` 的说明）；`/api/events.mux` 的 `session/event` 消费方（`chatSession.ts`）随旧聊天区删除，现在这条线上的事件走 `src/server/modernStreams.ts` 的 `$events` 逻辑流。
- dsh-one 侧的文件引用（`chatSession.ts` / `chatView.ts` / `chat/webview.ts` / `jobsStore.ts`）都是历史状态：前三个已删除；`jobsStore.ts` 也不在了，jobs 数据现在由 `src/ui/sessionsStore.ts` 收、纯模型在 `src/pure/activityTree.ts`。

> 研究目标（当时）：确认 dsh-one（VS Code 扩展）能否拿到「workflow/后台任务展开显示多个成员」的 run→member 数据，确定数据来源与集成方向。

## 1. 会话事件流里有没有 tool-workflow 事件？

**有，且是 durable SessionEvent。**

- `dsh-tool-workflow/lib/types/types.d.ts` 定义四类事件数据：
  - `ToolWorkflowRunStartData` `{runId, name}`
  - `ToolWorkflowAgentStartData` `{runId, seq, label, phase?, childId}`
  - `ToolWorkflowAgentEndData` `{runId, seq, outcome}`
  - `ToolWorkflowRunEndData` `{runId, stopReason}`
- 同文件通过 `declare module '@deepseek-ai/dsh-session/types'` 把四个键 `tool-workflow/run-start|agent-start|agent-end|run-end` 合入 `SessionEventMap`——它们是标准 SessionEvent（事件名就是 `tool-workflow/...` 前缀，没有独立常量）。`dsh-session` 的 `known-event-types.js` 里也列了这四个名字。
- `SessionEvent` envelope = `{type, seq, time, data}`（时间字段叫 `time` 不叫 `ts`；**事件本身不含 sessionId**，由线帧携带）；`SessionEventType = keyof SessionEventMap`。
- 写入路径：workflow 工具执行期间由 `dsh-tool-workflow/lib/index.js` 的 `createWorkflowRecorder` 写进**调用它的父 Session 日志**——`start` 写 `run-start`、`ctx.on("workflow/agent-start" | "workflow/agent-end")` 写对应事件、`finish` 写 `run-end`（写失败会打日志并停掉这条记录，不留半截状态）。上游 `workflow/*` 事件由 `dsh-workflow-ptc/lib/index.js` 的 `emitWorkflowEvent` 发出。
- **dsh-one 当时的订阅**（`ChatSessionController.attach` → `muxEvents.ts` 打开 `WS /api/events.mux`，`onFrame` 的 `session/event` 分支把事件原样交给折叠器）随旧聊天区一起删除；现在等价通道是 `modernStreams.ts` 的 `$events`。

## 2. 拿到四类事件的具体路径（历史）

### 路径 A：mux `session/event` 帧（live）——当时可用

host 端 mux 对每个会话发 `session/subscribed` 基线帧，随后把每次 commit 的事件原样透传（不过滤事件类型）。dsh-one 无需显式 attach：帧带 `sessionId`，控制器按 `payload.sessionId === this.sessionId` 过滤。live 火线只在会话在内存（attached）时存在；workflow 工具在 turn 内同步执行，父会话那时必然 attached，所以事件落盘时 live 可达。

撰写时这些行为的出处记的是 `dsh-host-apiproxy`，该包在 0.1.6-alpha.1 已经不存在，所以上面的描述不再有行号出处；`session/event` 这个火线本身在 `dsh-session/lib/index.js`（`Session.append` 触发）。

### 路径 B：`session.history`（基线 / 回放）——可用

- dsh-one 侧当年走 `loadBaseline` → `sessionHistory`（`callRpc('session.history')`）；现在的等价代码在 `src/server/dshRpc.ts`。
- host 的 history 响应把窗口内事件原样返回 `{event, view?}`，不过滤类型。
- 事件是 durable 的（写进父会话日志），重启/重连后 history 可完整回放：断流重连重新拉 history、向前翻页能把更早的 `run-start` 补进来（对应官方「update 历史尾页 pending，直到更早页面补入唯一 start」的语义）。

### 其他通道核查（均不含 run→member 结构）

| 通道 | 内容 | 结论 |
|---|---|---|
| `session.list` | `SessionSummary`（`dsh-api-session-controller` 的类型声明）：sessionId / updatedAt / running / blank / parentSessionId / origin / cwd / projections | 无 workflow 字段 |
| `session/jobs` | `PublicJobSnapshot` 扁平（`dsh-tool-jobs`） | 见第 3 节 |
| `subagent.history` | 读成员子会话自己的历史 | 只有成员内部 log，无 run 结构 |
| 事件枚举 API | — | 无 `listEvents` 命名 API（客户端历史通道就是 `SessionsApi.history` + 事件流两条） |

## 3. workflow 运行会不会出现在 `jobsBySession` 里？

**不会。** workflow 运行本身不注册 job，成员也不注册 job：

- `dsh-tool-workflow` 全文件无 `jobs` 引用。
- 成员由 workflow 引擎直接 `this.subagents.start(...)`（`dsh-workflow-ptc`）启动，**不经 jobs 注册**。jobs 只覆盖工具型后台任务：bash/pwsh（`dsh-tool-bash` / `dsh-tool-pwsh`）与 subagent 工具的 background 模式（`dsh-tool-subagent`，`kind: "subagent"`）。
- 因此父会话的 `session/jobs` 帧在 workflow 运行期间为空（除非父代理同时跑了其他后台工具）；成员子会话若有自己的后台任务，出现在**各自 sessionId** 的 key 下（jobs 按 owner 作用域）。

**扁平 jobs 无法分组复用**：`PublicJobSnapshot` 只有 `id/kind/label/status/detail/startedAt/finishedAt`，无 runId/phase/childId/members；workflow 根本不在 jobs 里，谈不上分组。

顺带确认（当时）：头部「N 个子代理」chip 基于 `session.list` 里 `parentSessionId === 当前会话` 的行——能看到成员会话（扁平、running 位 + updatedAt），但分不出 run/phase、拿不到成员 outcome，不能替代 workflow-run 数据。

## 4. 集成方向（历史，已按此实现过，再接线不要照它走）

- `src/pure/workflowRun.ts`（纯函数折叠四类事件 → `WorkflowRunView`）就是照这一节写的；`chatContract.ts` 的 `ChatState.workflowRuns?` 带出；渲染端随旧聊天区下线。**现在只有单测在用它**。
- 当时额外提到：官方的 `interrupted` 语义（stopReason/outcome 缺失 + 所在 turn/step 已关闭）依赖 location 模型，dsh-one 没有，可省略或用 `turn/end` 近似；「run-start 落在历史窗口外」按官方同款处理（update 事件先缓存，补到 start 后整段重建）。
- 当时的「涉及文件清单」（新增 `src/pure/workflowRun.ts`、改 `chatSession.ts` / `chatContract.ts` / `chatView.ts` / `chat/webview.ts`）已作废：除了 `workflowRun.ts` 与 `chatContract.ts` 的类型字段，其余文件都不在了。

## 风险与注意（当时列的，仍然成立的部分）

- live 事件依赖父会话 attached；扩展关闭期间跑完的 workflow，下次打开由 history 回放补上。
- 断流重连靠重拉 history 恢复状态（workflow 没有 jobs/queue 那样的整帧快照）。
- 不需要改后端、不需要新增 RPC。
