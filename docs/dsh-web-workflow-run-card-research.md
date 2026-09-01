# dsh web「workflow / 后台任务卡片」渲染逻辑研究报告

研究对象（均为编译产物，读 lib/*.js + *.d.ts）：
- 主：`dsh-client-ui-workflow-run`（`WorkflowRunPanel` 渲染 + durable 节点定义）
- 辅：`dsh-client-ui-jobs`（header 上的后台任务列表，理解与 workflow-run 的关系/差别）
- 辅助材料：`dsh-client-runtime`（durable 事件折叠引擎）、`dsh-client-ui-conversation`（chat node 渲染座）、`dsh-tool-workflow` / `dsh-workflow`（事件与状态类型）、web bundle 里的 `StateDot` / `DisclosureRow`（primitives，从运行中的 GUI `/assets/` 抓取）

> 注意：primitives（StateDot/DisclosureRow）没有随 npm 包发布源码，我是从本机运行中的 GUI（http://127.0.0.1:3080/assets/）抓的 web bundle 里提取的实现，行号为 bundle 内偏移，仅供定位，非源码行号。

---

## 1. 卡片整体结构

入口组件 `WorkflowRunPanel`（`dsh-client-ui-workflow-run/lib/client.js:304`），渲染一棵三层嵌套：

```
<section.root data-workflow-run data-run-status>
└─ RunHeader                      ← 运行级折叠行（run 级 disclosure）
   ├─ chevron(IconChevronRightOutline14) + title(name)
   └─ 折叠态尾部：separator · "N 个成员" · StateDot + 状态文字
   └─ 展开态内容：phaseList
      └─ PhaseSection × N         ← 阶段级折叠行（phase 级 disclosure）
         ├─ chevron + 阶段名
         └─ 折叠态尾部：separator · "N 个成员" · 聚合状态文本（如"运行中 2"）
         └─ 展开态内容：members
            └─ MemberRow × M      ← 成员行（不可折叠，纯展示/可点击）
               ├─ StateDot · 成员名 · 状态文字
```

- **name**：`node.data.name`，渲染在 `RunHeader` 的 title（`t("run.title", { name })`，中文文案就是 `{name}`，见 client.js:444）。
- **status**：`node.data.status`（running/completed/failed/cancelled/interrupted），挂在 section 的 `data-run-status` 属性上（client.js:395），并决定 run 级徽标。
- **成员计数"3 个成员"**：`runFacts.activityCount` = 所有 phase 的 `phase.members.length` 之和（`runDisclosureFacts`，client.js:96），传给 `RunHeader` 的 `count`（client.js:398），文案来自 `memberCount(count, t)` → `t("run.members.other", {count})` = "`{count} 个成员`"（client.js:76、zh 字典 445-446）。截图里的"3 个成员"就是所有 phase 成员总数。
- **折叠/展开箭头**：`StatusDisclosure`（client.js:78）包了一层 primitives 的 `DisclosureRow`，icon 传 `IconChevronRightOutline14`（14px 右向 chevron）。`DisclosureRow` 的实现里：展开态显示旋转后的向下 chevron，折叠态显示右向；`data-open` 标记在根上。chevron 永远常驻（`previewChevron: false`），不是 hover 才出现。

**顶部"运行中 2"计数**：截图里顶部那行的"运行中 2"是 phase 行的聚合状态文本（见第 3 节 `phaseStatusSummary`），不是 run 行——run 行的折叠态尾部只显示一个状态词（"运行中"）+ 状态点，不做计数聚合。

---

## 2. status 徽标

两层徽标都用 primitives 的 `StateDot` + 状态文字，无胶囊（README.zh.md 明确"不使用胶囊"）。

### 状态 → 点语义映射

`dotState(status)`（client.js:54-64）：

| status | dotState | 说明 |
|---|---|---|
| running | `ongoing` | 动画矩阵点（见下） |
| completed | `done` | 实心圆点，成功色 |
| failed | `error` | 实心圆点，错误色 |
| cancelled | `warning` | 实心圆点，警告色 |
| interrupted | `warning` | 实心圆点，警告色（cancelled/interrupted 共用警告色） |

### i18n 文案 key

`STATUS_KEYS`（client.js:47-53）+ zh/en 字典（client.js:443-483）：

| key | 中文 | 英文 |
|---|---|---|
| `status.running` | 运行中 | Running |
| `status.completed` | 已完成 | Completed |
| `status.failed` | 失败 | Failed |
| `status.cancelled` | 已取消 | Cancelled |
| `status.interrupted` | 已中断 | Interrupted |
| `statusCount.running` | 运行中 {count} | Running {count} |
| `statusCount.completed` | 已完成 {count} | Completed {count} |
| `statusCount.failed` | 失败 {count} | Failed {count} |
| `statusCount.cancelled` | 已取消 {count} | Cancelled {count} |
| `statusCount.interrupted` | 已中断 {count} | Interrupted {count} |

`statusCount.*` 用于 phase 行聚合（第 3 节）。

### 视觉（CSS 变量，bundle 里 `_dot_10orb_3`）

- `StateDot` 本体：`width/height` 可传 size（默认 10），背景 `currentColor`，通过 `data-state` 属性变色：
  - `[data-state=done]` → `--dsw-alias-state-success-primary`
  - `[data-state=warning]` → `--dsw-alias-state-warn-primary`
  - `[data-state=error]` → `--dsw-alias-state-error-primary`
  - `ongoing` 不是圆点，而是 10×10 的 4×4 网格矩阵（`_matrix_10orb_4`），每格 `fill:currentColor; opacity:.15`，逐格 `@keyframes _dsh-state-dot-chase` 1s 无限闪烁（扫描动画），颜色 `--dsh-state-ongoing: var(--dsw-static-deepseek-450)`。
- 圆点结构：`:before` 是 10% 透明度的外圈晕影，`:after` 是 60% 尺寸的实心内点——典型的"发光状态点"。
- 尺寸槽：run 尾部 `statusTail` 高 20px；成员行 `dotSlot` 是 16×24px 的固定槽（对齐用，不是圆点大小）。

---

## 3. phase 分组与展开/折叠

### phase 数据与 `workflowPhaseKey`

`projectWorkflow`（client.js:516-548）按 `workflowPhaseKey(member.phase)`（client.js:491）分组：

```js
function workflowPhaseKey(phase) {
  return phase === null ? "missing" : `value:${phase.length}:${phase}`;
}
```

- 用「长度+内容」编码避免碰撞，同时保留「缺省（null）与空字符串是两种身份」的区分（d.ts 注释：`null` 是缺省字段，空串是另一种身份）。
- 分组只来自**真正开始过的成员**；同 phase 字符串归一组，组内成员按事件到达顺序保持 `seq` 顺序。成员结算只改状态，不删不改序。
- 每个 phase 渲染为 `PhaseSection`（client.js:258），key 用 `phase.key`，折叠态尾部显示 `memberCount(members.length)` + `phaseStatusSummary(members, t)`（client.js:286）。

### phase 聚合状态文本

`phaseStatusSummary`（client.js:158-170）：统计成员里各 status 的个数，只挑非 completed 的活跃状态（running/failed/cancelled/interrupted，按此顺序）参与显示，用 ` · ` 连接：
- 例：2 running + 1 completed → `"运行中 2 · 已完成 1"`（截图里的"运行中 2"即此形态）
- 全部 completed → `"已完成 N"`
- 特殊规则：有 interrupted 且也有 completed 时，completed 排最前（`["completed", ...active]`），即 `"已完成 1 · 已中断 1"`。

### 状态驱动的展开/折叠（核心逻辑）

这是这个卡片最精巧的部分，纯 JS 状态机，实现在 `initialDisclosureState`（client.js:99）+ `advanceDisclosureState`（client.js:106）+ `useLayoutEffect`（client.js:315-342）。

每层（run / phase）维护一个 facts：
```js
{ mode: "abnormal" | "running" | "clean", activityCount: N }
```
- `phaseDisclosureFacts`（client.js:87）：成员里有 failed/cancelled/interrupted → `abnormal`；否则有 running → `running`；否则 → `clean`。
- `runDisclosureFacts`（client.js:93）：run status 异常或任一 phase abnormal → `abnormal`；run running 或任一 phase running → `running`；否则 clean。activityCount = 各 phase 成员数之和。
- `abnormal(status)` = failed || cancelled || interrupted（client.js:84）。

**初始状态**（`initialDisclosureState`，挂载时）：`open: facts.mode !== "clean"`，即：
- run 运行中/失败/已取消/已中断 → 默认展开；全部 completed → 默认折叠。
- phase 同理：有活跃成员（running/异常）默认展开，全 completed 默认折叠。
- 也就是说「全部完成就收起来，只要还有动静就展开」——截图里"3 个成员 / 展开后列出 backlog=已完成、git=运行中、skills=运行中"正对应：run running → 展开，各 phase 有 running 成员 → 各自展开。

**更新逻辑**（每次 facts 变化时在 layoutEffect 里跑）：
1. facts 没变（mode、activityCount 都相同）→ 保持现状；但如果挂着 `pendingCleanCollapse` 且焦点已离开内容区，则折叠（client.js:107-114）。
2. facts 变 clean（全部完成了）：
   - 当前 open 且焦点在展开内容里 → 延迟折叠：保持 open，打 `pendingCleanCollapse` 标记，等 blur 时折叠（`settleRunBlur`/`settlePhaseBlur`，client.js:368-391）。
   - 否则立即折叠（client.js:115-122）。
3. 从 clean 变非 clean（phase 有新成员开始）、或从非 abnormal 变成 abnormal → **自动展开**（client.js:123-127）。
4. 其他运行中更新 → 保持用户当前手动选择（不打扰，client.js:128-132）。

**run 级联动**（client.js:325-332）：当某个 phase 从 clean 开始新周期（`phaseStartedCycle`）且 run 是 active 但当前折叠 → 强制展开 run 一次，展示更新的摘要。README 原话："已完成阶段在同一 phase key 下开始新的运行成员时，该 Phase 与外层运行会再次自动展开"。

**细节**：
- `preventPendingHeaderFocus`（client.js:152）+ `onMouseDownCapture`（client.js:396, 261）：pendingCleanCollapse 期间点击 header 时 preventDefault，避免"点击折叠行的动作又被焦点停留在内容区挡住"。
- 用户手动 toggle（`toggleRun`/`togglePhase`，client.js:343-367）会清掉 `pendingCleanCollapse`，之后状态由 facts 驱动。
- phase 选择状态存在 `disclosures.phases` Map 里（按 phase key），run 折叠/展开不重置 phase 的选择；组件 remount 才按当前 facts 重建初始状态。

---

## 4. 成员行为

`MemberRow`（client.js:210-257）：

- **label**：`readableMember(member.label, t)` —— 空 label 显示 `member.empty`（"空成员名"），正常显示 label。
- **状态徽标**：`StateDot(dotState(member.status))` 在 16×24 固定槽里，右侧 64px 固定宽状态文字列（`memberStatus`）显示 `t(STATUS_KEYS[member.status])`。
- **点击行为 → 打开子会话**：`navigableMembers`（client.js:171-179）决定哪些成员可点击：
  ```js
  member.status === "running" &&
  sessions.ids 含 childId &&
  sessions.byId[childId].origin === "subagent" &&
  sessions.byId[childId].parentId === sessionId &&
  sessions.byId[childId].running
  ```
  即**只有运行中的、父会话是当前会话的普通 subagent 子会话**可打开。可打开的成员渲染为 `<button>`，`aria-label = t("member.open", {name})`（"打开 {name}"），点击调 `openSession(member.childId)`（client.js:252-254），注入的 `openSession` 就是 `ctx.sessions.open(id)`（client.js:637-639）。
  - 不可打开的行渲染为 `<div>`（无点击）；但键盘聚焦时（`focused` state）也会渲染成 button 以显示焦点环，`tabIndex=-1`、`aria-disabled`、无 onClick（client.js:213, 239-256）。README 说明：带下划线的成员名是唯一可见的导航提示；终态成员永不提供冷会话入口（只保留复盘展示）。
- **视觉**：可打开行的成员名有下划线 + `--dsw-alias-state-business-primary` 颜色（CSS `.memberButton .memberLabel`）；焦点环 2px business-primary。

---

## 5. 数据来源：durable 事件折叠

「workflow-run」是一个 **durable Conversation Node**：由 `workflowRunDefinition`（client.js:571-615）注册到 runtime 的 `conversationEvents` registry（client.js:628），把四类 `tool-workflow/*` Session 事件按 `runId` 折叠成一个 chat 流里的 keyed 节点，渲染成独立卡片（不替换原 workflow 工具卡）。

### 事件 → 状态机（`ConversationNodeDefinition`，见 `dsh-client-runtime/lib/types/client/contract/conversation.d.ts:151`）

| 事件 | match role | 状态变化 |
|---|---|---|
| `tool-workflow/run-start`（data: runId, name） | start | `state = { name, members: [] }` |
| `tool-workflow/agent-start`（runId, seq, label, phase?, childId） | update | `updateAgentStart`（client.js:549）：push `{ seq, label, phase?, childId }` |
| `tool-workflow/agent-end`（runId, seq, outcome） | update | `updateAgentEnd`（client.js:561）：按 seq 回填 `outcome` |
| `tool-workflow/run-end`（runId, stopReason） | update | 设 `stopReason` |

事件类型定义在 `dsh-tool-workflow/lib/types/types.d.ts`（`ToolWorkflowRunStartData` 等，含注释说明语义）。

### 折叠成 `WorkflowRunChatData`

`buildViewNode`（client.js:601-614）→ `projectWorkflow`（client.js:516-548）产出最终 payload：

```ts
WorkflowRunChatData = {
  name: string,
  status: WorkflowRunStatus,        // running|completed|failed|cancelled|interrupted
  phases: WorkflowRunPhaseData[]    // { key, phase: string|null, members: WorkflowRunMemberData[] }
}
WorkflowRunMemberData = { seq, label, childId, status }
```

status 推导（client.js:494-511, 535, 545）：
- run status：`stopReason` 存在 → `statusFromStopReason`：`completed→completed, cancelled→cancelled, error→failed`（`WorkflowStopReason` 是 closed union，见 `dsh-workflow/lib/types/types.d.ts:55`）；`stopReason` 缺失 → 若所在 turn/step 已关闭（`locationClosed`，client.js:512，即"结束事件丢了但位置已经关了"）→ `interrupted`，否则 `running`。
- member status：`outcome` 存在 → `statusFromOutcome`：`completed→completed, cancelled→cancelled, failed→failed`；缺失 → 同 run 的中断判断（interrupted/running）。
- 即"**stopReason/outcome 缺失 + 位置已关闭 = interrupted**"是中断语义的来源。

### durable 机制（runtime 侧）

- `conversationEvents.register(definition)` → 引擎对每个事件跑 `match`，命中后按 start/update 增量维护每个 `runId` 的 Context 状态（`ConversationEventRegistry`，runtime client.js:10152）。
- 节点按 `conversationContextKey(kind, id)` 稳定键值进 chat 流：`ChatNodeSeat`（`dsh-client-ui-conversation/lib/client.js:5480`）从 `snapshot.chat.nodes.get(nodeKey)` 取节点，按 `routedNode.kind`（`workflow-run`）dispatch 到 keyed slot `conversation.chat.node`（renderSlot，client.js:5511），fallback 是 `JsonBlock`（未知 kind 显示 JSON）。节点还带 `anchorSeq`、`location`（放 chat 流位置）、`visibility`（conversation.d.ts:111-116）。
- `buildNode` 校验 key/target 稳定性（runtime client.js:6802-6809）。
- 事件经 `dsh-tool-workflow`（模型侧 tool）写入父 Session 的日志，前端回放/追加（README"持久状态与回放"一节：update 历史尾页 pending，直到更早页面补入唯一 start；此后 prepend、完整回放、实时 append 得同一状态）。
- 注册装配（client.js:627-641）：`apply(ctx)` 做三件事——注册 definition、注册 zh/en 字典（`locale.register("workflowRun", ...)`）、注入 `conversation.chat.node` slot 的 `workflow-run` keyed renderer（`inject` 声明依赖 conversationEvents/slots/sessions/locale）。

---

## 6. CSS / 样式线索

### workflow-run 自己的 CSS（`WorkflowRunPanel.module.css`，client.js:11-44 的编译产物）

| 类 | 关键样式 | 用途 |
|---|---|---|
| `.root` | width:100%; min-width:0 | 卡片根 |
| `.runHeader` | 32px 高、`background: var(--dsw-alias-bg-module-platform)`、`border-radius:8px`、`padding:0 8px`、gap:6px、flex | 运行行（浅灰底圆角条） |
| `.runLeading` | 16×16、label-tertiary | chevron 槽 |
| `.runTitle` | max-width:42%、14px、font-weight:510、label-secondary、ellipsis | 运行名 |
| `.runSummary` | flex:1、12px、label-tertiary、ellipsis | "N 个成员" |
| `.statusTail` | 20px 高、11px、font-weight:510、label-secondary、gap:4px | 状态点+文字 |
| `.separator` | 2×2 圆点、label-tertiary | 分隔点 |
| `.phaseHeader` | 32px 高、无背景、gap:6px | 阶段行 |
| `.phaseTitle` | max-width:42%、14px、label-secondary | 阶段名 |
| `.phaseCount` | flex:1、13px、label-tertiary | 阶段成员数 |
| `.phaseStatus` | width:132px、右对齐、13px、label-secondary | 阶段聚合状态（如"运行中 2 · 已完成 1"） |
| `.phaseList` | 列布局、gap:4px、`padding:4px 0 0 16px`（≤560px 时 12px） | 阶段列表缩进 |
| `.members` | 列布局、gap:2px、`padding-left:16px`（≤560px 12px） | 成员列表缩进 |
| `.memberRow/.memberButton` | 100% 宽、min-height:24px、gap:12px、border-radius:4px、label-secondary | 成员行 |
| `.memberButton .memberLabel` | business-primary + underline | 可打开成员的导航提示 |
| `.dotSlot` | 16×24 固定槽、flex:none | 对齐状态点 |
| `.memberLabelWrap` | flex:1、ellipsis；focus-visible 时 outline:2px business-primary | 成员名 |
| `.memberStatus` | width:64px、右对齐、13px、label-secondary | 成员状态文字 |
| `.empty` | 13px、label-tertiary | "没有启动成员" |

### primitives 的 DisclosureRow / StateDot（bundle 实现）

- `DisclosureRow`（bundle 中 `q7`）：受控组件，props 有 `icon/title/open/expandable/onToggle/expandOnRowClick/previewChevron/keepContentWhenOpen/collapsedContent/rowClassName/leadingClassName/titleClassName`。`expandOnRowClick` 时整行 role=button、tabIndex=0、aria-expanded、支持 Enter/Space（onKeyDown）。`keepContentWhenOpen` 时折叠内容只在关闭态渲染。行高 24px 默认（workflow-run 覆盖为 32px）。
- `StateDot`（bundle 中 `Pu`）：`{state, size=10, className}`。`state==="ongoing"` → 4×4 矩阵扫描动画 svg（`data-state=ongoing`）；否则 `<span data-state>` 圆点，颜色按第 2 节的 data-state CSS 规则。

### 可借鉴的颜色变量

- `--dsw-alias-state-success-primary`（完成绿）、`--dsw-alias-state-warn-primary`（警告黄）、`--dsw-alias-state-error-primary`（错误红）、`--dsw-static-deepseek-450`（运行中蓝/品牌色）
- `--dsw-alias-bg-module-platform`（行背景）、`--dsw-alias-label-secondary` / `-tertiary`（文字两级灰）
- `--dsw-alias-state-business-primary`（可交互/焦点环蓝）

---

## 7. 顺带：dsh-client-ui-jobs 与 workflow-run 的关系

`JobListAction`（`dsh-client-ui-jobs/lib/client.js:117`）是**会话 header** 上的触发器按钮（slot `conversation.session.header.actions`，id `job-list`，order 20，client.js:266-271），不是 chat 流节点：

- 数据：`state.jobsBySession[sessionId]`（每个 session 的后台任务列表），无任务时不渲染任何东西（client.js:139）。
- 形态：按钮（live 时带 ongoing 点 + `"{count} 个后台任务运行中"` 计数 + 旋转 chevron）→ 点击弹出 336px 宽的浮层列表（`_menu`：border-l2、bg menu、shadow-lv3、radius 12px）。
- 每行：StateDot（job 状态：running→ongoing、stopping/killed→warning、completed→done、failed→error，client.js:52-62）+ kind 小标签 + label + detail/status + 持续时长（`formatDuration`，client.js:81，运行中每秒 tick 刷新，client.js:126-135）。
- **与 workflow-run 的区别**：jobs 是"这个会话的后台任务清单"（一维列表，含时长，不进聊天流）；workflow-run 是"聊天流里的一个 durable 工作流记录卡"（两层折叠分组，按 phase 组织成员）。两者共用 primitives 的 StateDot 徽标和计数文案风格（`count.live.*` 与 `statusCount.*` 都叫"运行中 N"），但结构完全不同。dsh-one 截图里的卡片（3 成员/phase 分组/运行中计数）对应的是 **workflow-run** 形态，不是 jobs。

---

## 8. 对 dsh-one 的启示

以 dsh web 这套样式重做 dsh-one 聊天流里的后台任务卡片，要点如下。

**数据结构差异（必须自己造）**：dsh web 的卡片数据是 durable 事件折叠出来的 `{name, status, phases[{key, phase, members[{seq, label, childId, status}]}]}`，且 status 有 5 值（含 interrupted 语义 = 结束事件缺失但位置已关闭）。dsh-one 目前的后台任务模型（backlog/git/skills 等）需要先对齐成「run → phase → member」三层 + 每层一个 5 值 status；若 dsh-one 没有 phase 概念，至少要有「任务组 + 子成员」两层，否则"展开后列出各成员状态"无从渲染。成员计数（"3 个成员"）= 所有 phase 成员数之和，直接照抄即可。

**视觉可直接借鉴**：
- 行布局：32px 高 runHeader（`bg-module-platform` 浅灰底、radius 8px、padding 0 8px）+ 阶段行 32px 无底 + 成员行 24px，左侧逐级缩进 16px（窄屏 12px）——这套"折叠行 + 缩进树"骨架可以整体照搬。
- 徽标：`StateDot` 的语义映射（running=矩阵动画蓝、completed=绿、failed=红、cancelled/interrupted=黄）和文案（运行中/已完成/失败/已取消/已中断；"运行中 2"这种 `statusCount.*` 计数文案）直接复用。
- 聚合文案：`phaseStatusSummary` 的 `"运行中 2 · 已完成 1"` 格式（活跃状态优先、completed 全绿时的兜底、interrupted+completed 时 completed 前置）值得原样搬。

**最值得抄的算法是状态驱动的展开/折叠**：`mode: abnormal|running|clean` + `initialDisclosureState`（非 clean 默认展开）+ `advanceDisclosureState`（变 clean 延迟折叠、clean→active 自动展开、运行中更新保持用户选择、phase 新周期联动展开 run）。这个逻辑与具体 UI 框架无关，可以直接移植成 dsh-one 的 hook/工具函数。注意两个细节也要带上：pendingCleanCollapse 期间点击 header 的 `preventDefault`（防止折叠被焦点挡住），以及"全部完成后自动收拢、新活动又自动展开"的体验。

**差异与简化点**：
- dsh web 的卡片挂在 runtime 的 durable 节点引擎上（事件回放/重连一致性），dsh-one 若没有这套事件流，直接维护一个状态对象 + 订阅更新即可，不必复刻 durable 折叠。
- `navigableMembers` 的"仅运行中的直系 subagent 可点击打开会话"规则很精，dsh-one 若子任务可点击跳转，建议保留同等约束（只对 live 且直属子任务开放）。
- 不需要 jobs 形态的 header 按钮，除非 dsh-one 也想在会话头部加"后台任务总数"入口——那是另一套东西（浮层列表 + 时长计时）。
- primitives 的 DisclosureRow/StateDot 没发布为 npm 包，需要按 bundle 里的行为（受控 disclosure、键盘支持、expandOnRowClick）在 dsh-one 里自己实现等价组件，或直接简化成 div+onClick。
