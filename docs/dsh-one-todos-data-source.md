# dsh-one 获取 todos 数据可行性研究报告

纯研究，未改任何文件。结论先行：**host 完整推送 todos（history 基线 + `session/projection` 帧），`todo/write` 事件与 `todo_write` tool-call 事件都出现在 dsh-one 已订阅的 mux 流里——两种界面（TodoPanel 任务清单卡、TodoRow 消息内任务卡）都可做，dsh-one 侧只是"没读、没解析"，不是"拿不到"。**

## 1. `session.history` 基线（loadBaseline）里 projections.values 有没有 `todos`？

**有，host 一定带（只要用标准 dsh CLI），dsh-one 只是没读。**

- **装配**：`dsh-tool-todo` 是 `dsh-base/cordis.patch.yml` 的基座插件（`- id: tool-todo, name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true }`），`dsh-session-projection` 同文件；dsh-base 是「every dsh profile」共享核心，dsh-one 通过 `spawnDsh.ts` 拉起的 host 就是这个 CLI，两个插件都在。
- **投影单元注册**：`dsh-tool-todo/lib/index.js` 的 `apply()` 里 `ctx.inject(['sessionProjections'], …)` 注册 `todos` 单元：`key: 'todos'`、`init: () => null`、`apply: todo/write → event.data.todos; turn/start → null; 其余原样`、`stateVersion: 2`、带 `wire.view`。每次 `todo_write` 执行时 `exec.agent.session.append("todo/write", { todos })` 写一条 durable 事件。
- **快照构成**：`dsh-session-projection/lib/index.js` 的 `SessionProjectionRegistry.snapshot(session)` 遍历所有带 wire view 的注册单元，逐个 key 写进 `values`（null 也写，`todosProjectionSchema` 是 `union([array, null])` 放行）。history 尾页 `projections.values` 含 `todos`：首写前为 `null`，首写后为 `[{content, status}, …]`。
- **history 响应组装**：`dsh-host-apiproxy`（`api-proxy.js`）：history handler 只**尾页**（beforeSeq 缺省）带 projections；`historyCutOf` 对 attached session 走 `registry.snapshot(session)`，对 detached 走 `detachedProjectionsFor`（从事件重放折叠，同样产出 todos）。
- **dsh-one 侧**：`loadBaseline`（`chatSession.ts`）拿到 `page.projections`（`dshRpc.ts` 的 `SessionHistoryPage.projections: { asOfSeq, values: Record<string, unknown> }`，宽松镜像，任何 key 都装得下），但只消费了 `title/permissions/sessionStats/imageLimits/contextPressure/contextBreakdown`，没读 `todos`。

**结论**：数据在基线 `projections.values.todos` 里，dsh-one 解析层是 `Record<string, unknown>` 宽松透传，加一行读取即可。当前是「没读」而非「缺失」。

## 2. 会话事件流里有没有 `todo/write` / `todo_write` tool-call 事件？

**两个都有，dsh-one 已订阅的流就是它们经过的通道。**

- **mux 无过滤转发**：dsh-one `muxEvents.ts` 订阅 `/api/events.mux`。host 端对每个 session 事件 push `{type:'session/event', sessionId, event, view}`，不做类型过滤。`todo/write` 是 dsh-session 已知事件类型，由 dsh-tool-todo 的 execute 写入。
- **`todo_write` 是普通 tool/call**：agent 调用时产生 `tool/call` 事件，`data.arguments` 是模型 args 的 JSON 字符串（host 端自己也在 `JSON.parse` 做 result-view 配对）；被拒绝/失败的调用 args 也原样保留。dsh-one `ToolCallEventData.arguments?: string`（conversation.ts）与之镜像一致。
- **`todos` 投影帧也在**：`SessionProjectionRegistry.drive` 在 todo/write（新数组引用）与 turn/start（→null）时通知 `onChanged`；host-apiproxy broadcast `{type:'session/projection', sessionId, key:'todos', value, seq}`。这个帧类型 dsh-one 的 `onFrame` 已处理（chatSession.ts 的 `session/projection` case），只是 switch 里没 `todos` 分支、落 default。
- **dsh-one 现状**：`todo/write` 事件进 `ConversationFolder.applyEvent` 后落 `default: return false`（静默忽略）；`tool/call` 折叠成 `ChatToolBlock` 但只保留 title/detail（来自 host view），丢掉了 `data.arguments`——TodoRow 需要的 args 快照在事件里、没进折叠模型。

## 3. 可行性结论 + 集成路径

**可行性高，纯增量消费，无 host 侧缺项。** dsh-one 已有 6 个投影（title/permissions/sessionStats/imageLimits/contextPressure/contextBreakdown）的同构消费机制（基线 seed + `session/projection` 帧 higher-seq-wins），todos 是第 7 个，机制完全一样。

### ① TodoPanel（输入框上方可折叠任务清单卡）—— 走投影

数据 = `todos` 投影（last-wins 整表折叠，turn/start 清为 null；host 已算好，客户端零折叠）。改动：`chatSession.ts` 加 `todosSeq` + `applyTodosValue()`、`loadBaseline` 读 `projections.values.todos`、`onFrame` `session/projection` 加 `case 'todos'`；`chatContract.ts` `ChatState` 加 `todos?`；webview 渲染折叠卡（`progressLabel`：done/active/pending 计数、非零段 `·` 连接）。语义：`null`=无清单（首写前/turn/start 后）、`[]` 空数组不渲染。

### ② TodoRow（聊天流任务卡）—— 走 tool/call 事件 args

数据 = 单次 `todo_write` tool-call 节点的 `data.arguments`（JSON 字符串 `{todos:[{content,status}]}`）静态快照 → `planSummary`（done/total、首个 in_progress 的 content、其余 in_progress 数 → `+N`）。改动：`conversation.ts` `applyToolCall` 对 `name==='todo_write'` 解析 args；`ChatToolBlock` 加 `todos?: {done,total,activeContent,activeExtra}`；webview 渲染。备选数据源：host view 的 `rawInput` 是数组且 generic 分支只认 string，不如直接解析事件 args 可靠（模型原始 JSON，两种状态都带）。

### 缺失/降级说明

标准 dsh CLI 下无缺失。若部署被改成不含 `dsh-tool-todo`/`dsh-session-projection`：history 尾页无 `todos`、无 `session/projection` 帧、`todo_write` 可能不存在。可行替代是客户端从 `session/event` 流自行折叠 `todo/write`（事件本身始终在，dsh-session known event type），"turn/start 清空 + last-wins"规则照抄 dsh-tool-todo 的 apply；TodoRow 不受影响（tool/call args 与投影无关）。dsh-one 面向标准 dsh CLI，此路径仅对自定义装配有意义。

> 本报告为静态代码核实结论，未做运行时抓包验证。
