# dsh web「任务清单卡」与「消息内 task 状态」渲染逻辑研究报告

写于 2026-09-01（自研聊天区时期），2026-09-20 复核。纯研究，当时未改任何代码。

- **第 1–3 节仍然有效**：讲官方 dsh web 怎么渲染任务清单卡（`conversation.input.dock` 里的 dock）、消息内 task 行（`tool.call.toolview` 的 keyed 行）与 header 的 jobs 弹层。现在装配对话区里跑的就是这些官方组件。
- **第 4.3 节是历史**：那份「dsh-one 对齐需求清单」是给已下线的自研聊天区排的活（#68 下线），不要再按它施工。
- **引用口径**：只写包名 + 标识符（`function TodoPanel` 这类名字），不写行号——这些是编译产物，行号每发一个 dsh 版本都可能变。复核基线是本机 dsh 0.1.6-alpha.1。

研究对象（均为编译产物，读 `lib/*.js` + `*.d.ts`）：

- 主：`dsh-client-ui-conversation`（`TodoPanel` 任务清单卡 + `conversation.input.dock` 槽）、`dsh-client-ui-tool`（`TodoRow` 消息内 task 行 + `ToolRow` 骨架）
- 数据源：`dsh-tool-todo`（`todo_write` 工具 + `todos` 投影单元 + `TodoItem` / `todo/write` 类型）、`dsh-session-projection`（投影驱动框架）
- 客户端机制：`dsh-api-session-controller` 的 client 半（`ProjectionValueStore`：`faceOf` + higher-seq-wins）、`dsh-client-ui-renderer`（把 hook / keyed hook 变成 slot 组件的 props）、`dsh-client-ui-session`（注册 projection 这个 keyed hook 源）
- 辅：`dsh-client-ui-jobs`（header jobs 弹层交互确认）、`dsh-client-ui-goal` / `dsh-client-ui-plan`（对照 dock）、`dsh-tool-jobs`（Job wire 类型）

参考前序报告：`docs/dsh-web-workflow-run-card-research.md`（形态 2 workflow-run 卡，本文不重复）。

**0.1.6-alpha.1 复核出的归属变化**（撰写时记的包名有三处已经不对）：

- `TodoItem` 与 `todo/write` 事件类型：撰写时记在 `dsh-session/lib/types/types.d.ts`，现在由 `dsh-tool-todo/lib/types/types.d.ts` 声明（模块增强 `SessionEventMap` / `SessionProjectionMap`）。
- 投影值存储 `ProjectionValueStore`（`faceOf` / higher-seq-wins）：撰写时记在 `dsh-client-runtime` 的 client 半，现在在 `dsh-api-session-controller` 的 client 半；`dsh-client-runtime` 这个包名已不在 0.1.6-alpha.1 的安装里。
- `useProjection`：不是 `dsh-client-ui-renderer` 自己提供的 hook。renderer 只负责把 contribution 声明的 hook / keyed hook 变成 slot 组件的 props；projection 这个 keyed hook 源由 `dsh-client-ui-session` 注册（`keyedHooks: { projection: (key) => binding.session.projections.faceOf(key) }`）。

---

## 0. 四种形态一览

| # | 形态 | 渲染槽位（slot） | 数据来源 | 是否 durable 聊天节点 |
|---|---|---|---|---|
| 1 | header jobs 弹层 | `conversation.session.header.actions`（id `job-list`, order 20） | `jobsBySession` store ← `session/jobs` wire 帧（host job registry 实时推送） | 否，会话级实时状态 |
| 2 | workflow-run 卡 | `conversation.chat.node` key `workflow-run` | 聊天流 durable 事件节点 `node.data` | 是（已研究） |
| 3 | 任务清单卡（input dock） | `conversation.input.dock`（id `todo`, order 0） | `todos` 投影 ← `todo/write` durable 事件折叠（last-wins） | 否，投影聚合（但源事件是 durable 的） |
| 4 | 消息内 task 状态（tool 行） | `conversation.chat.node` key `tool-call` → 子槽 `tool.call.toolview` key `todo_write` | 单次 `todo_write` 调用的 args（聊天流 durable tool-call 节点） | 是 |

---

## 1. 任务清单卡（形态 3）：`任务 3 进行中 · 1 待处理`

### 1.1 组件归属

`dsh-client-ui-conversation` 的 **`TodoPanel`** + **`TodoDock`**，通过 **`todoDockEntry`** 注册到 `conversation.input.dock` 槽，`id: "todo"`、`order: 0`（排在 goal order 10、queue order 20 之前）：

```js
ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "todo",
    order: 0,
    locale: NS
}, TodoDock));
```

渲染位置在 composer stack 中、输入条上方（`zone !== void 0 && renderSlot("conversation.input.dock", zone)`，紧跟 `inputBar` 之前）。槽声明为 `kind: "list"`、`scope: "session"`。

`TodoDock` 是纯适配器：`todos: useProjection("todos") ?? []`——直接读宿主算好的 `todos` 投影，无本地状态。

### 1.2 "3 进行中 · 1 待处理"怎么算

`progressLabel(todos, t)`：

```js
const done = todos.filter((item) => item.status === "completed").length;
const active = todos.filter((item) => item.status === "in_progress").length;
const pending = todos.length - done - active;
return [
    ...done > 0 ? [t("todo.progress.done", { done })] : [],
    ...active > 0 ? [t("todo.progress.active", { active })] : [],
    ...pending > 0 ? [t("todo.progress.pending", { pending })] : []
].join(" · ");
```

- 按状态各计一条，**计数为 0 的段直接省略**（列表非空时至少保留一段）。
- 分隔符是 U+2002 en space 包住 U+00B7 中点（源码里写成 `" · "`，不是普通空格 + `·`）。
- 文案 key 在 conversation 包的中英字典里：`todo.progress.done`「{done} 已完成」、`todo.progress.active`「{active} 进行中」、`todo.progress.pending`「{pending} 待处理」。
- 截图「任务 3 进行中 · 1 待处理」= 标题 `todo.title`（「任务」）+ 进度（completed=0 被省略，active=3、pending=1）。

### 1.3 chevron 展开/折叠

- `const [collapsed, setCollapsed] = useState(true)`——**默认折叠**。
- 整个 header 是 `<button aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>`。
- chevron 方向：**折叠态显示 `IconChevronUpOutline14`（向上），展开态显示 `IconChevronDownOutline14`（向下）**——与常见 disclosure 约定相反，是 figma 设计字面（注意不要「修正」它）。
- 展开态才渲染 `<ul>` 列表，CSS 里 `.lXshSW_list` 带 `max-height: 180px; overflow-y: auto`。
- 每个 `li` 的 key 是 `item.content`（整表替换 ⇒ 条目无 id，列表身份就是内容），结构为 `<span.glyph>`（16×16 槽，放 `StatusGlyph`）+ `<span.content>`（任务文案 `item.content`），`data-status` 标记在 li 上。

### 1.4 状态字形 StatusGlyph

`StatusGlyph` 按 `item.status` 三选一，均为 14×14 svg：

- **completed** → `CompletedGlyph`：圆环 + 对勾，颜色 `--dsw-alias-state-success-primary`（`.glyphCompleted`）。
- **in_progress** → `ProgressGlyph`：business-blue 圆环用 `linearGradient` 淡出，CSS `animation: 1s linear infinite lXshSW_todo-progress-spin` 旋转（进行中 = 转圈）。
- **pending** → `PendingGlyph`：虚线未开始圆环，`strokeDasharray: "2.4 2.4"`，颜色 `--dsw-alias-label-caption`。

### 1.5 数据来源：todo_write 工具 + `todos` 投影

**事件端**（`dsh-tool-todo/lib/index.js`）：

- 工具 `todo_write`：参数是**完整替换列表** `todos: [{content, status}]`，`status` 枚举 pending/in_progress/completed；配置 `allowParallelInProgress` 决定是否允许多个 in_progress 同时存在（不允许多个时 execute 会抛错：`invalid todos: at most one task may be in_progress`）。
- `execute`：`exec.agent.session.append("todo/write", { todos })`——**每个调用往会话 durable 日志追加一个 `todo/write` 事件**；返回 `{todos, counts: {pending, inProgress, completed}}`。
- `presentCall`：`{card: "generic", title: "Update todo list", kind: "other", rawInput: args.todos}`。

**投影端**（`dsh-tool-todo/lib/index.js`，`ctx.sessionProjections.register`）：

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

即 **last-write-wins 整表折叠**，`turn/start` 时归 null。类型声明（`dsh-tool-todo/lib/types/types.d.ts`）在 `SessionProjectionMap.todos: TodoItem[] | null`，注释明说「the latest `todo/write` snapshot…whole-value rule」。

**类型**（`dsh-tool-todo/lib/types/types.d.ts`）：

- `TodoItem`：`{content: string; status: 'pending' | 'in_progress' | 'completed'}`——**无 id、无优先级**，因为整表替换、last-wins，条目不需要稳定身份。
- `todo/write` 事件：`{todos: TodoItem[]}`，注释写着「Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history.」

**驱动框架**：`dsh-session-projection`——`ProjectionDefinition` 是纯同步 fold 单元，registry `ctx.sessionProjections` 对每个已提交 session 事件**急切驱动**所有单元；whole-value 事件规则保证 fold 廉价。带 `wire` 的单元把视图值经 `session/projection` 帧推给客户端。

**客户端到达链路**：

- `dsh-api-session-controller` 的 client 半：`ProjectionValueStore`——按 key 存投影值，由尾页 `projections` 块播种，之后由 Session Controller 的控制帧按 **higher-seq-wins** 推进（重放帧不能把值退回去）。`faceOf(key)` 返回 per-key 身份稳定的 observable face；键没见过时快照是 `undefined`（不是缺 face），所以组件可以在值出现之前先订阅。
- `dsh-client-ui-session` 把 `projection` 注册成 keyed hook 源（`faceOf(key)`），`dsh-client-ui-renderer` 把它变成 slot 组件拿到的 `useProjection` prop。
- `TodoDock` 通过 slot 注入拿到 `useProjection`，读 `"todos"`。**从未见过的 key 读 `undefined`**（能力缺失），所以首写前 TodoPanel 拿 `[]` 也不渲染（`todos.length === 0` 时 return null）。

---

## 2. 消息内 task 状态（形态 4）：`更新任务清单 0/4 已完成 · 启动后台 bash job（60s 模拟流水线） +2`

### 2.1 组件归属

`dsh-client-ui-tool` 的 **`TodoRow`**，通过 **`todoToolview`** 注册进 `tool.call.toolview` 槽，**key 为 `todo_write`**：

```js
ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "todo_write",
    locale: CONVERSATION_NS   // "conversation" 命名空间，复用 conversation 包的字典
}, TodoRow));
```

渲染链：聊天流 durable tool-call 节点 → `conversation.chat.node` key `tool-call` 的 **`ToolCallTree`**（ui-tool 注册）→ `ToolCall` 组件按 `entryKey: toolName` 分发到 `tool.call.toolview` 子槽（`renderSlot("tool.call.toolview", owner, …)`），**命中的 keyed 视图替换掉 `GenericToolCard` 通用行**。`todo_write` 不在 `TOOL_VARIANTS` 表里（命中 keyed 视图就替换，表里加它也不可达）。

### 2.2 一行里的三个片段

`TodoRow` 渲染到共享 **`ToolRow`**（`DisclosureRow` 骨架）：

```js
title: t("todo.rowTitle"),                                  // "更新任务清单"
summary: summary.text,                                      // "0/4 已完成 · 启动后台 bash job（60s 模拟流水线）"
summarySuffix: summary.extra > 0 ? `+${summary.extra}` : null,  // "+2"
icon: <IconChecklistOutline14/>
```

折叠态尾部（`ToolRow` 的 `collapsedContent`）：`separator` + summary（+ suffix）。点行头展开显示 Input/Output 区块（`ioCard`：`bodyRaw` = args 内容、`output` = 结果）。

**「0/4 已完成」**：`summarize(argsRaw, t)` 把**该次调用的 argsRaw JSON 解析出来**取 `todos` 数组（解析失败或没有 `todos` 数组就返回 null，回落到通用摘要），交给 `planSummary(todos)`：

```js
done: todos.filter(t => t.status === "completed").length,
total: todos.length,
activeContent: 第一个 in_progress 条目的 content（须是非空字符串，否则 null）,
activeExtra: 首个之外还有几个 in_progress（`named ? active.length - 1 : 0`）
```

head = `t("todo.completed", {done, total})` = 「`{done}/{total} 已完成`」（key 在 conversation 字典）。text 组装：`activeContent === null ? head : `${head} · ${activeContent}``——即「0/4 已完成 · 启动后台 bash job（60s 模拟流水线）」。args 的取法两种块形状都认：`("kind" in block ? block.call?.argsRaw : block.argsRaw)`。

**「+2」**：`summarySuffix = activeExtra > 0 ? "+{extra}" : null`。activeExtra = 首个 in_progress 之外的进行中条目数。截图场景 3 条 in_progress，命名了第一条「启动后台 bash job（60s 模拟流水线）」，`+2` 表示还有 2 条进行中（并行策略下多条同时 in_progress 是常态，注释明确说只命名第一个、计数其余，避免并行清单被单条摘要吞掉）。

### 2.3 状态语义

`TodoRow` 复用 `toolRowModel(toolName, block)` 的 `state`：`!done → "running"`；done 时按 `error.code === "interrupted"` / `block.isError` 得 `"stopped"` / `"error"` / `"ok"`。`ToolRow` 里的状态表现（`leadingFor` / `stateStatus`）：

- error → `StateDot state="error"`；stopped → `StateDot state="warning"`；running → 隐藏文本 `row.running`（供无障碍）。
- 注释明确：**非 ok 状态沿用共享行的点语义——被取消的调用没写 `todo/write`，不能读成一次成功的清单更新**。

注意：这行的数字来自**该次调用的 args 快照**，不是当前投影——它和形态 3 的 dock 是同一数据域的两个不同渲染（见第 4 节）。

---

## 3. header jobs 弹层（形态 1）：交互确认

`dsh-client-ui-jobs` 的 **`JobListAction`**，注册在 `conversation.session.header.actions` 槽（id `job-list`、order 20）：

**数据**：`useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS`——来自 sessions store 的 `jobsBySession` Map，由 `session/jobs` 帧 last-wins 更新（空数组存为缺省 key）。wire 形态 `PublicJobSnapshot`（`dsh-tool-jobs` 的类型声明）：`{id, kind, label, status, detail?, startedAt, finishedAt?}`，status ∈ running/stopping/completed/killed/failed。**不走 durable 聊天事件，是会话级实时推送**。

**触发按钮**：`liveCount > 0` 时前面有 `StateDot state="ongoing"`（矩阵动画点）+ 计数文案 + `IconChevronDownOutline14`（打开时加 `triggerOpen` 类旋转）。计数文案：有运行中任务 → `count.live.one/other`（「{count} 个后台任务运行中」），否则 `count.idle.one/other`（「{count} 个后台任务」）。无任务时整个组件返回 null。

**展开/收起**：

- `useState(false)` 默认收起；点击 trigger `setOpen(v => !v)` 切换（并重置 `now`）。
- 外部点击关闭：primitives 的 `useDismissOnOutsidePointer(rootRef, open, setOpen)`。
- Esc 关闭并把焦点还给 trigger。
- jobs 清空时自动收起。

**时长计时刷新**：**仅当打开且有 live job 时**才跑 `setInterval(1000)` 更新 `now`；关弹层或全部结算即停。live 行时长 = `now - startedAt`（每秒跳），settled 行 = `(finishedAt ?? startedAt) - startedAt`（固定）。`formatDuration` 最多两个相邻单位：`duration.seconds`「{seconds}秒」/ `duration.minutes`「{minutes}分{seconds}秒」/ `duration.hours`「{hours}小时{minutes}分」。

**行结构**：`li`（live 行加 `rowSettled` 样式），五个元素：`StateDot(dotState(status))`（running→ongoing 矩阵点、stopping/killed→warning、completed→done、failed→error）+ `job.kind` + `job.label`（命令/名称，带 title）+ 状态文字（`job.detail ?? status`）+ 时长。

**排序**（`ordered`）：live 行在前按 startedAt 升序；settled 行按 finishedAt 降序（同毫秒回退 startedAt），不依赖宿主 Map 迭代序。

---

## 4. 四者关系

### 4.1 角色分工

- **形态 1（header jobs 弹层）＝ 会话级实时汇总**：所有后台 job 的当前快照（bash job、subagent job 等），推送到 `jobsBySession` store，只管「现在有哪些 job、什么状态、跑了多久」。与聊天流无关，job 结束仍在列表里（settled 行）。
- **形态 2（workflow-run 卡）＝ 聊天流里的 workflow 事件记录**：`conversation.chat.node` key `workflow-run`（`dsh-client-ui-workflow-run`），渲染 durable 事件节点（run→phase→member 三层）。
- **形态 3（任务清单卡）＝ 聊天流任务清单的当前折叠态**：`todos` 投影是 `todo/write` durable 事件的 last-wins 折叠；钉在输入框上方常驻展示，模型每写一次清单它就更新一次（不产生新的聊天节点）。
- **形态 4（消息内 task 行）＝ 聊天流里单次 todo_write 调用的记录**：`tool-call` 节点 + `tool.call.toolview` keyed 分发，每次调用产生一行，内容 = 该次调用 args 的静态快照（0/4、第一个进行中项、+N）。

### 4.2 相互区别与联系

- **3 与 4 共享同一数据域（todo 清单），渲染位置不同**：4 是逐事件渲染（每次 `todo_write` 一行，可回放、忠实于当时参数）；3 是聚合渲染（只看最后一次写入的整表，`turn/start` 会清空）。两者各自算数、不共享代码：**dock 的 header 计数是面板内联算的，todo 行的计数是从 args 算的**。文案 key 也因此分家——dock 用 `todo.progress.*`，行用 `todo.completed` / `todo.rowTitle`（都在 conversation 包的字典里，被 ui-tool 以 `CONVERSATION_NS` 引用）。
- **1 与 2 是不同领域**：jobs（`session/jobs` 帧，实时）vs workflow-run（durable 节点）。同一个后台活动可能同时在两处出现：模型启动的 bash job 在 header 弹层有行；若它属于某次 workflow 运行，聊天流里另有 workflow-run 卡。两者无数据耦合。
- **槽位全景**（同层并列，按 order）：
  - `conversation.session.header.actions`：job-list(20) 等。
  - `conversation.chat.node`：user / steering / context / assistant-step / command / manual-compaction / compaction（conversation 包注册）、tool-call（ui-tool）、workflow-run（ui-workflow-run）——**chat 流节点**。
  - `conversation.input.dock`：**todo(0) < goal(10) < queue(20)**——输入框上方常驻 dock 栈（goal dock 读 `useProjection("goal")` 显示当前目标，带 edit/pause/resume/clear，`dsh-client-ui-goal`；queue dock 显示待发消息）。
  - `conversation.input.plan`：PlanChip（`dsh-client-ui-plan`，读 `plan` 投影）。
- **durable 与否的分界线**：聊天流节点（2、4）与投影（3 的数据源）都吃 durable session 事件（`todo/write`、`tool-workflow/*` 等）；header 弹层（1）吃的是线帧里的会话实时状态。客户端侧两套聚合引擎（投影值存储、sessions store）互不相通。

### 4.3 当时列的 dsh-one 对齐需求（历史）

以下清单是给**已下线的自研聊天区**排的（要在 dsh-one 里自己把 TodoPanel / TodoRow / jobs 弹层重新实现一遍）。现在这些组件由官方前端原样跑，清单不再有意义，留作记录。原文列了：host 侧要 `dsh-tool-todo` 的工具与投影单元、`dsh-session` 的类型、`dsh-session-projection` 的驱动与帧、jobs 通路；客户端侧要投影值存储、`useProjection` 框架座、conversation 的 dock、ui-tool 的 `ToolRow` / `ToolCallTree` / `TodoRow`、ui-jobs 的 `JobListAction`。当时的「关键语义约束」（投影是 last-wins 整表、todo 行是 args 快照，两者别混用同一份派生函数；dock 的 chevron 折叠态向上；`+N` 的含义；列表身份 = content）以第 1、2 节的描述为准，不另抄一遍。
