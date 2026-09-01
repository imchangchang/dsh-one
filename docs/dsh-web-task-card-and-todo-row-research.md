# dsh web「任务清单卡」与「消息内 task 状态」渲染逻辑研究报告

研究对象（均为编译产物，读 lib/*.js + *.d.ts；行号为文件内行号）：
- 主：`dsh-client-ui-conversation`（TodoPanel 任务清单卡 + input.dock 槽位）、`dsh-client-ui-tool`（TodoRow 消息内 task 行 + ToolRow 骨架）
- 数据源：`dsh-tool-todo`（todo_write 工具 + `todos` 投影单元）、`dsh-session`（TodoItem / `todo/write` 事件类型）、`dsh-session-projection`（投影驱动框架）
- 客户端机制：`dsh-client-runtime`（ProjectionValueStore + `session/projection` 帧 + `session/jobs` 帧）、`dsh-client-ui-renderer`（useProjection hook 座）
- 辅：`dsh-client-ui-jobs`（header jobs 弹层交互确认）、`dsh-client-ui-goal` / `dsh-client-ui-plan`（对照 dock）、`dsh-tool-jobs`（Job wire 类型）

参考前序报告：`docs/dsh-web-workflow-run-card-research.md`（形态 2 workflow-run 卡，本文不重复）。

---

## 0. 四种形态一览

| # | 形态 | 渲染座位（slot） | 数据来源 | 是否 durable 聊天节点 |
|---|---|---|---|---|
| 1 | header jobs 弹层 | `conversation.session.header.actions`（id `job-list`, order 20） | `jobsBySession` store ← `session/jobs` wire 帧（host job registry 实时推送） | 否，会话级实时状态 |
| 2 | workflow-run 卡 | `conversation.chat.node` key `workflow-run` | 聊天流 durable 事件节点 `node.data` | 是（已研究） |
| 3 | 任务清单卡（input dock） | `conversation.input.dock`（id `todo`, order 0） | `todos` 投影 ← `todo/write` durable 事件折叠（last-wins） | 否，投影聚合（但源事件是 durable 的） |
| 4 | 消息内 task 状态（tool 行） | `conversation.chat.node` key `tool-call` → 子槽 `tool.call.toolview` key `todo_write` | 单次 `todo_write` 调用的 args（聊天流 durable tool-call 节点） | 是 |

---

## 1. 任务清单卡（形态 3）：`任务 3 进行中 · 1 待处理`

### 1.1 组件归属

`dsh-client-ui-conversation/lib/client.js` 的 **`TodoPanel`**（6597-6650 行）+ **`TodoDock`**（6652-6657 行），通过 **`todoDockEntry`**（6662-6682 行）注册到 `conversation.input.dock` 槽，`id: "todo"`、`order: 0`（排在 goal order 10、queue order 20 之前）：

```js
ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "todo",
    order: 0,
    locale: NS
}, TodoDock));
```

渲染座位在 composer stack 中、输入条上方（7254 行：`zone !== void 0 && renderSlot("conversation.input.dock", zone)`，紧跟 `inputBar` 之前）。槽声明为 `kind: "list"`、`scope: "session"`（9977 行附近）。

`TodoDock` 是纯适配器：`todos: useProjection("todos") ?? []` —— 直接读宿主计算的 `todos` 投影，无本地状态。

### 1.2 "3 进行中 · 1 待处理"怎么算

`progressLabel(todos, t)`（6587-6595 行）：

```js
const done = todos.filter((item) => item.status === "completed").length;
const active = todos.filter((item) => item.status === "in_progress").length;
const pending = todos.length - done - active;
return [
    ...done > 0 ? [t("todo.progress.done", { done })] : [],
    ...active > 0 ? [t("todo.progress.active", { active })] : [],
    ...pending > 0 ? [t("todo.progress.pending", { pending })] : []
].join(" · ");   // 注意：分隔符是 U+2002 en-space 包住 "·"
```

- 按状态各计一条，**计数为 0 的段直接省略**（列表非空时至少保留一段）。
- 文案 key 在 6199-6204 行（zh）：「{done} 已完成」「{active} 进行中」「{pending} 待处理」。
- 截图「任务 3 进行中 · 1 待处理」= 标题 `todo.title`（"任务"）+ 进度（completed=0 被省略，active=3、pending=1）。

### 1.3 chevron 展开/折叠

- `const [collapsed, setCollapsed] = useState(true)`（6600 行）——**默认折叠**。
- 整个 header 是 `<button aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>`（6608-6611 行）。
- chevron 方向（6628-6630 行）：**折叠态显示 `IconChevronUpOutline14`（向上），展开态显示 `IconChevronDownOutline14`（向下）**——与常见 disclosure 约定相反，是 figma 设计字面（注意不要"修正"它）。
- 展开态才渲染 `<ul>` 列表（6634-6646 行），CSS 里 `.lXshSW_list` 带 `max-height: 180px; overflow-y: auto`（6473 行 CSS）。
- 每个 `li` 结构：`<span.glyph>`（16×16 槽，放 StatusGlyph）+ `<span.content>`（任务文案 `item.content`），`data-status` 标记在 li 上。

### 1.4 状态字形 StatusGlyph

`StatusGlyph`（6577-6585 行）按 `item.status` 三选一，均为 14×14 svg：
- **completed** → `CompletedGlyph`（6507 行）：圆环 + 对勾，颜色 `--dsw-alias-state-success-primary`（`.glyphCompleted`）。
- **in_progress** → `ProgressGlyph`（6528 行）：business-blue 圆环渐变淡出，CSS `animation: 1s linear infinite lXshSW_todo-progress-spin` 旋转（进行中 = 转圈）。
- **pending** → `PendingGlyph`（6559 行）：虚线未开始圆环，`strokeDasharray: "2.4 2.4"`，颜色 caption 灰。

### 1.5 数据来源：todo_write 工具 + `todos` 投影

**事件端**（`dsh-tool-todo/lib/index.js`）：
- 工具 `todo_write`（93 行起）：参数是**完整替换列表** `todos: [{content, status}]`，`status` 枚举 pending/in_progress/completed；配置 `allowParallelInProgress` 决定是否允许多个 in_progress 同时存在（不允许多个时 execute 会抛错）。
- `execute`（约 173-177 行）：`exec.agent.session.append("todo/write", { todos })` —— **每个调用往会话 durable 日志追加一个 `todo/write` 事件**；返回 `{todos, counts: {pending, inProgress, completed}}`。
- `presentCall`：`{card: "generic", title: "Update todo list", kind: "other", rawInput: args.todos}`。

**投影端**（`dsh-tool-todo/lib/index.js` 74-91 行，`ctx.sessionProjections.register`）：
```js
key: "todos",
stateSchema: union([array({content: string, status: enum3}), null]),
init: () => null,
apply: (state, event) => {
    if (event.type === "todo/write") return event.data.todos;  // 整表替换
    if (event.type === "turn/start") return null;              // 新一轮清空
    return state;
},
wire: { viewSchema: 同上, view: state => state },
stateVersion: 2
```
即 **last-write-wins 整表折叠**；`turn/start` 时归 null。投影类型声明在 `dsh-tool-todo/lib/types/types.d.ts`（模块增强 `SessionProjectionMap.todos: TodoItem[] | null`，注释明说"the latest `todo/write` snapshot…whole-value rule"）。

**类型**（`dsh-session/lib/types/types.d.ts`）：
- `TodoItem`（180-189 行）：`{content: string; status: 'pending' | 'in_progress' | 'completed'}` —— **无 id、无优先级**，因为整表替换、last-wins，条目不需要稳定身份。
- `todo/write` 事件（320-322 行）：`{todos: TodoItem[]}`，注释 "Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history."

**驱动框架**：`dsh-session-projection`（`lib/types/index.d.ts`）——`ProjectionDefinition` 是纯同步 fold 单元，registry `ctx.sessionProjections` 对每个已提交 session 事件**急切驱动**所有单元；whole-value 事件规则保证 fold 廉价。带 `wire` 的单元把视图值经 `session/projection` 帧推给客户端。

**客户端到达链路**：
- `dsh-client-runtime/lib/client.js`：`ProjectionValueStore`（约 5726-5800 行）——`session/projection` 帧处理（8300-8307 行）`apply(frame.key, frame.value, frame.seq)`，**seq 相同或更低则丢弃**（重放帧不能回退值）；`faceOf(key)` 返回 per-key 身份稳定的 observable face。
- `dsh-client-ui-renderer/lib/client.js`：`projectionHook`（219-236 行）——`useProjection(key)` 绑定到 `info.projections?.faceOf(key)`；`standard["useProjection"] = projectionHook(info)`（564 行）。
- `TodoDock` 通过 slot 注入拿到 `useProjection`，读 `"todos"`。**从未见过的 key 读 `undefined`**（能力缺失），所以首写前 TodoPanel 拿 `[]` 也不渲染（`todos.length === 0` 时 return null，6601 行）。

---

## 2. 消息内 task 状态（形态 4）：`更新任务清单 0/4 已完成 · 启动后台 bash job（60s 模拟流水线） +2`

### 2.1 组件归属

`dsh-client-ui-tool/lib/client.js` 的 **`TodoRow`**（约 1537-1556 行），通过 **`todoToolview`**（约 1558-1570 行）注册进 `tool.call.toolview` 槽，**key 为 `todo_write`**：

```js
ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "todo_write",
    locale: CONVERSATION_NS   // "conversation" 命名空间，复用 conversation 包的字典
}, TodoRow));
```

渲染链：聊天流 durable tool-call 节点 → `conversation.chat.node` key `tool-call` 的 **`ToolCallTree`**（ui-tool 1643-1652 行注册）→ `ToolCall` 组件（906-919 行）按 `entryKey: toolName` 分发到 `tool.call.toolview` 子槽，**命中的 keyed 视图替换掉 GenericToolCard 通用行**。`todo_write` 不在 `TOOL_VARIANTS` 表里（34-37 行注释：keyed 命中就替换，表里那条永远不可达）。

### 2.2 一行里的三个片段

`TodoRow` 渲染到共享 **`ToolRow`**（689-827 行，DisclosureRow 骨架）：

```js
title: t("todo.rowTitle"),                                  // "更新任务清单"
summary: summary.text,                                      // "0/4 已完成 · 启动后台 bash job（60s 模拟流水线）"
summarySuffix: summary.extra > 0 ? `+${summary.extra}` : null,  // "+2"
icon: <IconChecklistOutline14/>
```

折叠态尾部（ToolRow 的 `collapsedContent`，724-748 行附近）：`separator` + summary（+ suffix）。点行头展开显示 Input/Output 区块（`body` = args 内容、`output` = 结果，760-790 行附近 ioCard）。

**"0/4 已完成"**：`summarize(argsRaw, t)`（约 1519-1535 行）把**该次调用的 argsRaw JSON 解析出来**取 `todos` 数组，交给 `planSummary(todos)`（约 1500-1517 行）：

```js
done: todos.filter(t => t.status === "completed").length,
total: todos.length,
activeContent: 第一个 in_progress 条目的 content（须非空字符串，否则 null）,
activeExtra: 第一个之外还有几个 in_progress（active.length - 1）
```

head = `t("todo.completed", {done, total})` = "`{done}/{total} 已完成`"（key 在 conversation 字典 6204 行；截图是 0 完成 / 共 4 条）。text 组装：`activeContent === null ? head : `${head} · ${activeContent}``——即「0/4 已完成 · 启动后台 bash job（60s 模拟流水线）」。

**"+2"**：`summarySuffix = activeExtra > 0 ? "+{activeExtra}" : null`。activeExtra = 首个 in_progress 之外的进行中条目数。截图场景 3 条 in_progress（bash job、2 个 subagent、workflow…），命名了第一条「启动后台 bash job（60s 模拟流水线）」，`+2` 表示还有 2 条进行中（并行策略下多条同时 in_progress 是常态，注释明确说只命名第一个、计数其余，避免并行清单被单条摘要吞掉）。

### 2.3 状态语义

`TodoRow` 复用 `toolRowModel(toolName, block)`（180-208 行）的 `state`：`!done → "running"`；done 时按 `block.isError` / `interrupted` 得 `"error"` / `"stopped"` / `"ok"`。`ToolRow` 里的状态表现（`stateStatus$1`/`leadingFor$1`，670-687 行）：
- error → error 色 StateDot；stopped → warning 色 StateDot；running → 隐藏文本「运行中」（供无障碍）。
- 注释明确：**非 ok 状态沿用共享行的点语义——被取消的调用没写 `todo/write`，不能读成一次成功的清单更新**。

注意：这行的数字来自**该次调用的 args 快照**，不是当前投影——它和形态 3 的 dock 是同一数据域的两个不同渲染（见第 4 节）。

---

## 3. header jobs 弹层（形态 1）：交互确认

`dsh-client-ui-jobs/lib/client.js` 的 **`JobListAction`**（117-213 行），注册在 `conversation.session.header.actions` 槽（265-273 行，id `job-list`、order 20；会话 header 在 conversation 7370 行渲染该槽）。补充确认此前只研究了数据源的部分：

**数据**：`useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS`——来自 sessions store 的 `jobsBySession` Map（`dsh-client-runtime/lib/client.js` 7836 行），由 `session/jobs` 帧 last-wins 更新（8308-8312 行，空数组存为缺省 key）。wire 形态 `PublicJobSnapshot`（`dsh-tool-jobs/lib/types/index.d.ts` 38-46 行）：`{id, kind, label, status, detail?, startedAt, finishedAt?}`，status ∈ running/stopping/completed/killed/failed。**不走 durable 聊天事件，是会话级实时推送**。

**触发按钮**（149-173 行）：liveCount>0 时前面有 `StateDot state="ongoing"`（矩阵动画点）+ 计数文案 + `IconChevronDownOutline14`（打开时加 `triggerOpen` 类旋转）。计数文案（140-143 行）：有运行中任务 → `"{count} 个后台任务运行中"`（live），否则 `"{count} 个后台任务"`（idle）。

**展开/收起**：
- `useState(false)` 默认收起；点击 trigger `setOpen(v => !v)` 切换（并重置 `now`）。
- 外部点击关闭：`useDismissOnOutsidePointer(rootRef, open, setOpen)`（127 行）。
- Esc 关闭并回焦 trigger（144-147 行）。
- jobs 清空时自动收起（136-138 行）。

**时长计时刷新**（128-134 行）：**仅当打开且有 live job 时**才跑 `setInterval(1000)` 更新 `now`；关弹层或全部结算即停。live 行时长 = `now - startedAt`（每秒跳），settled 行 = `(finishedAt ?? startedAt) - startedAt`（固定）。`formatDuration`（77-90 行）最多两个相邻单位：`"{seconds}秒"` / `"{minutes}分{seconds}秒"` / `"{hours}小时{minutes}分"`（zh 字典 226-241 行）。

**行结构**（177-206 行）：`li`（live 行加 `rowSettled` 样式），五个元素：
`StateDot(dotState(status))`（running→ongoing 矩阵点、stopping/killed→warning、completed→done、failed→error，51-65 行）+ `job.kind` + `job.label`（命令/名称，带 title）+ 状态文字（`job.detail ?? status`）+ 时长。

**排序**（`ordered`，97-106 行）：live 行在前按 startedAt 升序；settled 行按 finishedAt 降序（同毫秒回退 startedAt），不依赖宿主 Map 迭代序。

---

## 4. 四者关系

### 4.1 角色分工

- **形态 1（header jobs 弹层）＝ 会话级实时汇总**：所有后台 job 的当前快照（bash job、subagent job 等），推送到 `jobsBySession` store，只管"现在有哪些 job、什么状态、跑了多久"。与聊天流无关，job 结束仍在列表里（settled 行）。
- **形态 2（workflow-run 卡）＝ 聊天流里的 workflow 事件记录**：`conversation.chat.node` key `workflow-run`（`dsh-client-ui-workflow-run` 633-635 行），渲染 durable 事件节点（run→phase→member 三层）。
- **形态 3（任务清单卡）＝ 聊天流任务清单的"当前折叠态"**：`todos` 投影是 `todo/write` durable 事件的 last-wins 折叠；钉在输入框上方常驻展示，模型每写一次清单它就更新一次（不产生新的聊天节点）。
- **形态 4（消息内 task 行）＝ 聊天流里单次 todo_write 调用的记录**：`tool-call` 节点 + `tool.call.toolview` keyed 分发，每次调用产生一行，内容 = 该次调用 args 的静态快照（0/4、第一个进行中项、+N）。

### 4.2 相互区别与联系

- **3 与 4 共享同一数据域（todo 清单），渲染座不同**：4 是逐事件渲染（每次 `todo_write` 一行，可回放、忠实于当时参数）；3 是聚合渲染（只看最后一次写入的整表，`turn/start` 会清空）。`planSummary` 注释（ui-tool plan-summary.js 区域）明说两者各自独立算数、不共享代码：**dock 的 header 计数是面板内联算的，todo 行的是从 args 算的**。文案 key 也因此分家——dock 用 `todo.progress.*`（conversation 包），行用 `todo.completed`/`todo.rowTitle`（也是 conversation 包字典、被 ui-tool 以 `CONVERSATION_NS` 引用）。
- **1 与 2 是不同领域**：jobs（`session/jobs` 帧，实时）vs workflow-run（durable 节点）。但同一个后台活动可能同时在两处出现：模型启动的 bash job 在 header 弹层有行；若它属于某次 workflow 运行，聊天流里另有 workflow-run 卡。两者无数据耦合。
- **槽位全景**（同层并列，按 order）：
  - `conversation.session.header.actions`：job-list(20) 等。
  - `conversation.chat.node`：user/steering/context/assistant-step/command/manual-compaction/compaction（conversation 9755-9800 行起）、tool-call（ui-tool）、workflow-run（ui-workflow-run）——**chat 流节点**。
  - `conversation.input.dock`：**todo(0) < goal(10) < queue(20)**——输入框上方常驻 dock 栈（goal dock 读 `useProjection("goal")` 显示当前目标，带 edit/pause/resume/clear，`dsh-client-ui-goal` 410-430 行；queue dock 显示待发消息）。
  - `conversation.input.plan`：PlanChip（`dsh-client-ui-plan` 118 行，读 `plan` 投影）。
- **durable 与否的分界线**：聊天流节点（2、4）与投影（3 的数据源）都吃 durable session 事件（`todo/write`、`workflow/run` 等）；header 弹层（1）吃的是 wire 帧里的会话实时状态。客户端侧聚合引擎都是 `ProjectionValueStore`（投影）与 sessions store（jobs）两套，互不相通。

### 4.3 dsh-one 对齐需求清单

要完整对齐这套交互（不重复形态 2 已对齐的 workflow-run），需要：

**Host 侧（服务端/运行时）**
1. `dsh-tool-todo`：`todo_write` 工具（整表替换、可选 `allowParallelInProgress`）+ `todos` 投影单元注册（`sessionProjections.register`，todo/write 整表折叠、turn/start 清空、stateVersion、wire 直通）。
2. `dsh-session`：`TodoItem` 类型 + `todo/write` 事件并入 `SessionEventMap`。
3. `dsh-session-projection`：registry 对每个 session 事件急切驱动投影单元、维护 per-session watermark、产生 `session/projection` 帧（含 baseline seed + push frame）。
4. jobs 通路（形态 1）：host job registry（`dsh-jobs`）→ `session/jobs` 帧推送 `PublicJobSnapshot[]`（id/kind/label/status/detail/startedAt/finishedAt）。

**Web 客户端侧**
5. `dsh-client-runtime`：`ProjectionValueStore`（`faceOf`/`apply`/seq last-wins/`session/projection` 帧处理）与 sessions store 的 `jobsBySession`（`session/jobs` 帧处理）。
6. `dsh-client-ui-renderer`：`useProjection` 框架座（把 key 解析到 per-session face）。
7. `dsh-client-ui-conversation`：`TodoPanel`/`TodoDock` + `conversation.input.dock` id `todo` order 0 注册；`todo.*` 中英字典；dock 渲染座（composer stack 内 input 上方）。
8. `dsh-client-ui-tool`：`ToolRow` 骨架（DisclosureRow + IN/OUT 展开 + summary/suffix）、`toolRowModel`、`ToolCallTree`（`conversation.chat.node` key `tool-call` + `tool.call.toolview` keyed 子槽）、`TodoRow` + `todoToolview`（key `todo_write`）。
9. `dsh-client-ui-jobs`：`JobListAction`（`conversation.session.header.actions` id `job-list` order 20）+ `job` 字典 + `useDismissOnOutsidePointer`/1s 计时器。
10. `dsh-client-ui-goal`（可选对照）：goal dock order 10；`dsh-client-ui-plan`（可选）：plan chip。

**关键语义约束（易错点）**
- 投影是 last-wins 整表、`turn/start` 清空；todo 行是 args 快照——两者别混用同一份派生函数。
- dock 的 chevron 折叠态向上、展开态向下（figma 字面，别"修正"）。
- `+N` 是"首个进行中之外还有几个"，`0/4 已完成` 的 0 是 completed 数不是进度条百分比。
- 整表替换 ⇒ 条目无 id；列表身份 = content。
