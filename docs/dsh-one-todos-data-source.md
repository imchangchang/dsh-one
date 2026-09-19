# dsh-one 获取 todos 数据可行性研究报告

写于 2026-09-01（自研聊天区时期），2026-09-20 复核。纯研究，当时未改任何文件。

**还有用的部分**：host 侧那条链路——`todo_write` 往会话日志追加 durable 的 `todo/write` 事件，`dsh-tool-todo` 把它折成 `todos` 投影，history 响应与投影帧都能把它带出来——仍然成立，已按本机 dsh 0.1.6-alpha.1 复核。将来若自己写插件要读这份数据，照第 1、2 节走。

**已作废的部分**：本文的落点是「在 dsh-one 自研聊天区里自己画 TodoPanel / TodoRow」。旧聊天区已在 #68 下线，对话区改成官方组件装配后，这两个组件由官方前端自己渲染，dsh-one 不需要再读 `todos`。下面凡提到 `chatSession.ts` / `chatView` / `chat/webview.ts` 的地方都是历史状态（这些文件已不在仓库里）。

**0.1.6-alpha.1 复核出的差异**：

- history handler 与 `projections` 的计算：撰写时记在 `dsh-host-apiproxy`，该包在 0.1.6-alpha.1 已经不存在（本机 profile 里只剩一个指向旧路径的悬空软链）。现在 history 侧在 `dsh-session-query`：取历史时 `projections = ctx.get('sessionProjections')?.snapshot(session)`（`projectionMode === 'none'` 时不给）。
- 事件流：撰写时说 dsh-one 订阅 `/api/events.mux` 的 `session/event` 帧，那是会话控制器（`chatSession.ts`）的做法，该文件已随旧聊天区删除。现在侧栏数据层（`src/ui/sessionsStore.ts`）仍走 mux，但只认 `session/projection` 等少数帧；0.1.2 起的共享逻辑流在 `src/server/modernStreams.ts`（`$events`）。

---

## 1. `session.history` 基线里有没有 `projections.values.todos`？

**有，host 一定带（只要用标准 dsh CLI）。**

- **装配**：`dsh-tool-todo` 是 `dsh-base/cordis.patch.yml` 的基座插件（`- id: tool-todo, name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true }`），`dsh-session-projection`（`- id: session-projection`）同文件；dsh-base 是每个 dsh profile 共享的核心，而 dsh-one 通过 `src/server/spawnDsh.ts` 拉起的 host 就是这个 CLI，两个插件都在。
- **投影单元注册**：`dsh-tool-todo/lib/index.js` 的 `apply()` 里 `ctx.sessionProjections.register(...)` 注册 `todos` 单元：`key: 'todos'`、`init: () => null`、`apply: todo/write → event.data.todos; turn/start → null; 其余原样`、`stateVersion: 2`、带 `wire.view`。每次 `todo_write` 执行时 `exec.agent.session.append("todo/write", { todos })` 写一条 durable 事件。
- **快照构成**：`dsh-session-projection` 的 `snapshot(session)` 遍历所有带 wire view 的注册单元，逐个 key 写进 `values`（`null` 也写，`todosProjectionSchema` 是 `union([array, null])` 放行）。所以 `projections.values.todos`：首写前为 `null`，首写后为 `[{content, status}, …]`。
- **history 响应组装**：`dsh-session-query` 在取历史时把 `projections` 附在响应上。撰写时写的 `dsh-host-apiproxy` 路径与 `historyCutOf` / `detachedProjectionsFor` 两个名字在 0.1.6-alpha.1 找不到，不再引用。
- **dsh-one 侧现状**：`src/server/dshRpc.ts` 镜像了 `SessionHistoryPage.projections`（`{ asOfSeq, values: Record<string, unknown> }`，宽松透传），从 session.list 行读 `title` / `agentPreset` / `sessionStats` / `tokenUsage` / `modelSelection`；`src/ui/sessionsStore.ts` 另外用 mux 的 `session/projection` 帧（key `title`）推进标题。**`todos` 没人读**——是「没读」，不是「拿不到」。旧聊天区那条路（`chatSession.ts` 的 `loadBaseline` 只消费 title/permissions/sessionStats/imageLimits/contextPressure/contextBreakdown）已随文件删除。

## 2. 会话事件流里有没有 `todo/write` / `todo_write` tool-call 事件？

**两个都有。**

- **`todo/write` 是已知的 durable session 事件类型**：`dsh-session` 的 `known-event-types.js` 里有它（0.1.6-alpha.1 也在），由 `dsh-tool-todo` 的 execute 写入。
- **`todo_write` 是普通 tool/call**：agent 调用时产生 `tool/call` 事件，`data.arguments` 是模型 args 的 JSON 字符串（host 端自己也 `JSON.parse` 做 result-view 配对）；被拒绝/失败的调用 args 也原样保留。
- **投影帧**：`dsh-session-projection` 在 `todo/write`（新数组引用）与 `turn/start`（→ null）时通过 `onChanged` 通知，客户端收到 `session/projection`（key = `todos`）帧，按 higher-seq-wins 更新。
- **dsh-one 现状**：`src/pure/conversation.ts` 仍会解析 `todo_write` 的 args 算 planSummary（写进 `ChatToolBlock.todos`），但这份契约（`src/pure/chatContract.ts` 的 `ChatState`）现在只有单测消费——旧聊天区下线后没有渲染端了。

## 3. 集成路径（历史）

撰写时列了两条路：① TodoPanel 走 `todos` 投影（基线 seed + `session/projection` 帧）；② TodoRow 走 tool/call 的 args。两条都依赖旧聊天区的契约与 webview，已作废。**将来若要自己读这份数据**，要做的只有第 1、2 节那些：history 基线读 `projections.values.todos`、认 `session/projection` 帧的 `todos` key，或者从事件流自行折叠 `todo/write`（规则照 `dsh-tool-todo` 的 `apply` 抄：last-wins 整表、`turn/start` 清空）。

### 缺失/降级说明

标准 dsh CLI 下无缺失。若部署被改成不含 `dsh-tool-todo` / `dsh-session-projection`：history 里没有 `todos`、没有投影帧、`todo_write` 也可能不存在。替代做法是客户端从事件流自行折叠 `todo/write`，事件本身始终在。

> 本报告为静态代码核实结论，未做运行时抓包验证；0.1.6-alpha.1 的复核同样是读安装包源码，没有起实例。
