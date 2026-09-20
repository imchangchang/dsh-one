# dsh web「workflow / 后台任务卡片」渲染逻辑研究报告

写于 2026-09-01（自研聊天区时期），2026-09-20 复核。纯研究，当时未改任何代码。

- **第 1–7 节仍然有效**：讲官方 `WorkflowRunPanel` 卡片怎么渲染、数据怎么折叠，以及它和 header jobs 弹层的区别。现在装配对话区里跑的就是这个组件。
- **第 8 节是历史**：那是给已下线的自研聊天区写的「我们要照这样做卡片」的建议（#68 下线），不要再按它施工。
- **引用口径**：`dsh-client-ui-workflow-run` 与 `dsh-client-ui-jobs` 的行号已按本机 dsh **0.1.6-alpha.1** 复核一致，可以用；其他包的行号不复核、已删掉——这些是编译产物，行号每发一个 dsh 版本都可能变。
- **0.1.6-alpha.1 复核出的归属变化**：撰写时把 durable 节点引擎记在 `dsh-client-runtime`（该包名已不在安装里），现在引擎在 `dsh-client-ui-conversation`（`ConversationEventRegistry`，`ctx.uiConversation.events`）；`ConversationNodeDefinition` 的类型路径也随之改为 `dsh-client-ui-conversation/lib/types/client/contract/conversation.d.ts`。
- **primitives（`StateDot` / `DisclosureRow`）现在有 npm 包**：`@deepseek-ai/dsh-client-ui-primitives`（alpha 通道 0.1.6-alpha.2，包内有 `lib/index.js` 与逐组件的 `.d.ts`）。撰写时它没发布，只能从运行中 GUI 的页面上抓 bundle 还原，所以下面凡写「bundle」的地方都是当时的做法。本机装的 dsh 0.1.6-alpha.1 里没有这个包（它被各 UI 包在构建时打进页面 bundle）。

研究对象（均为编译产物，读 `lib/*.js` + `*.d.ts`）：

- 主：`dsh-client-ui-workflow-run`（`WorkflowRunPanel` 渲染 + durable 节点定义）
- 辅：`dsh-client-ui-jobs`（header 上的后台任务列表，理解与 workflow-run 的关系/差别）
- 辅助材料：`dsh-client-ui-conversation`（durable 事件引擎 + chat node 渲染位置）、`dsh-tool-workflow` / `dsh-workflow`（事件与状态类型）、页面 bundle 里的 `StateDot` / `DisclosureRow`（primitives）

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

- **name**：`node.data.name`，渲染在 `RunHeader` 的 title（`t("run.title", { name })`，中文文案就是 `{name}`）。
- **status**：`node.data.status`（running/completed/failed/cancelled/interrupted），挂在 section 的 `data-run-status` 属性上，并决定 run 级徽标。
- **成员计数"3 个成员"**：`runFacts.activityCount` = 所有 phase 的 `phase.members.length` 之和（`runDisclosureFacts`，client.js:93），传给 `RunHeader` 的 `count`，文案来自 `memberCount(count, t)` → `count === 1 ? "run.members.one" : "run.members.other"`（client.js:75-76，zh 字典 445-446）= "`{count} 个成员`"。截图里的"3 个成员"就是所有 phase 成员总数。
- **折叠/展开箭头**：`StatusDisclosure`（client.js:78）包了一层 primitives 的 `DisclosureRow`，icon 传 `IconChevronRightOutline14`（14px 右向 chevron）。`DisclosureRow` 的实现里：展开态显示旋转后的向下 chevron，折叠态显示右向；`data-open` 标记在根上。chevron 永远常驻（`previewChevron: false`），不是 hover 才出现。

**顶部"运行中 2"计数**：截图里顶部那行的"运行中 2"是 phase 行的聚合状态文本（见第 3 节 `phaseStatusSummary`），不是 run 行——run 行的折叠态尾部只显示一个状态词（"运行中"）+ 状态点，不做计数聚合。

---

## 2. status 徽标

两层徽标都用 primitives 的 `StateDot` + 状态文字，无胶囊（`dsh-client-ui-workflow-run` 的 `README.zh.md` 明确"不使用胶囊"）。

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

### 视觉（CSS 变量）

- `StateDot` 本体：`width/height` 可传 size（默认 10，见 `@deepseek-ai/dsh-client-ui-primitives` 的 `StateDot.d.ts`），背景 `currentColor`，通过 `data-state` 属性变色：
  - `[data-state=done]` → `--dsw-alias-state-success-primary`
  - `[data-state=warning]` → `--dsw-alias-state-warn-primary`
  - `[data-state=error]` → `--dsw-alias-state-error-primary`
  - `[data-state=idle]` → `--dsw-alias-label-tertiary`（第四个状态，workflow 不用）
  - `ongoing` 不是圆点，而是 4×4 网格矩阵（`--dsh-state-ongoing: var(--dsw-static-deepseek-450)`），每格 `fill:currentColor; opacity:.15`，逐格 `animation: _dsh-state-dot-chase … 1s infinite`（扫描动画）。CSS 类名带构建哈希（0.1.6-alpha.1 是 `_matrix_1tljr_4`，撰写时是 `_matrix_10orb_4`），**每次构建都变**，定位请认 `--dsh-state-ongoing` 这个变量名。
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
  即**只有运行中的、父会话是当前会话的普通 subagent 子会话**可打开。可打开的成员渲染为 `<button>`，`aria-label = t("member.open", {name})`（"打开 {name}"），点击调 `openSession(member.childId)`（client.js:252-254），注入的 `openSession` 就是 `ctx.sessions.open(id)`。
  - 不可打开的行渲染为 `<div>`（无点击）；但键盘聚焦时（`focused` state）也会渲染成 button 以显示焦点环，`tabIndex=-1`、`aria-disabled`、无 onClick。README 说明：带下划线的成员名是唯一可见的导航提示；终态成员永不提供冷会话入口（只保留复盘展示）。
- **视觉**：可打开行的成员名用 `--dsw-alias-link` 色 + 500 字重（`.memberButton .memberLabel`），hover / focus-visible 时出现虚线下划线；焦点环 2px business-primary。

---

## 5. 数据来源：durable 事件折叠

「workflow-run」是一个 **durable Conversation Node**：由 `workflowRunDefinition`（client.js:571-615）注册到 `ctx.uiConversation.events`（client.js:628），把四类 `tool-workflow/*` Session 事件按 `runId` 折叠成一个 chat 流里的 keyed 节点，渲染成独立卡片（不替换原 workflow 工具卡）。

### 事件 → 状态机（`ConversationNodeDefinition` 见 `dsh-client-ui-conversation/lib/types/client/contract/conversation.d.ts`）

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

- run status：`stopReason` 存在 → `statusFromStopReason`：`completed→completed, cancelled→cancelled, error→failed`（`WorkflowStopReason` 是 closed union，见 `dsh-workflow/lib/types/types.d.ts`）；`stopReason` 缺失 → 若所在 turn/step 已关闭（`locationClosed`，client.js:512，即"结束事件丢了但位置已经关了"）→ `interrupted`，否则 `running`。
- member status：`outcome` 存在 → `statusFromOutcome`：`completed→completed, cancelled→cancelled, failed→failed`；缺失 → 同 run 的中断判断（interrupted/running）。
- 即"**stopReason/outcome 缺失 + 位置已关闭 = interrupted**"是中断语义的来源。

### durable 机制（引擎侧，0.1.6-alpha.1）

- 引擎是 `dsh-client-ui-conversation` 的 `ConversationEventRegistry`（`ctx.uiConversation.events`）：对每个事件跑 definition 的 `match`，命中后按 start/update 增量维护每个 Context 的状态；definition 还可选声明 `buildLocationData` / `buildViewNode`，由引擎把值物化成 `ConversationViewNode { key, kind, id, target, data }`。撰写时这段记在 `dsh-client-runtime`，且当时提到的节点字段 `anchorSeq` / `visibility` 在 0.1.6-alpha.1 的契约里已经没有。
- 折叠出的节点进 chat 流，由 `conversation.chat.node` 的 keyed slot 渲染：`key: "workflow-run"`，`dsh-client-ui-workflow-run` 在 `apply()` 里注册（同时注册 definition、zh/en 字典、以及这个 keyed renderer，并注入 `openSession`）。未知 key 时的兜底是 `JsonBlock`（未知 kind 显示 JSON）。
- 事件经 `dsh-tool-workflow`（模型侧 tool）写入父 Session 的日志，前端回放/追加（README"持久状态与回放"一节：update 历史尾页 pending，直到更早页面补入唯一 start；此后 prepend、完整回放、实时 append 得同一状态）。写入点是 `dsh-tool-workflow/lib/index.js` 的 `createWorkflowRecorder`：`start` 写 `run-start`、监听 `workflow/agent-start` / `workflow/agent-end` 写对应的成员事件、`finish` 写 `run-end`（某次 append 失败就停掉这一条的记录并打一条 warn，不影响工具本身继续执行）；上游 `workflow/*` 事件由 `dsh-workflow-ptc/lib/index.js` 的 `emitWorkflowEvent` 发出。
- envelope 是 `{type, seq, time, data}`（`dsh-session` 的类型定义；事件本身不带 sessionId，由线帧携带），这四个事件名在 `dsh-session/lib/types/known-event-types.js` 里也列着。

---

## 6. CSS / 样式线索

### workflow-run 自己的 CSS（`WorkflowRunPanel.module.css`，编译在 `dsh-client-ui-workflow-run/lib/client.js` 顶部）

| 类 | 关键样式 | 用途 |
|---|---|---|
| `.root` | width:100%; min-width:0 | 卡片根 |
| `.runHeader` | 32px 高、`background: var(--dsw-alias-bg-module-platform)`、`border-radius:8px`、`padding:0 8px`、gap:6px、flex | 运行行（浅灰底圆角条） |
| `.runLeading` | 16×16、label-tertiary | chevron 槽 |
| `.runTitle` | max-width:42%、13px（`--dsh-content-font-size-secondary`）、font-weight:510、label-secondary、ellipsis | 运行名 |
| `.runSummary` | flex:1、13px、label-tertiary、ellipsis | "N 个成员" |
| `.statusTail` | 20px 高、11px、font-weight:510、label-secondary、gap:4px | 状态点+文字 |
| `.separator` | 2×2 圆点、label-tertiary | 分隔点 |
| `.phaseHeader` | 32px 高、无背景、gap:6px | 阶段行 |
| `.phaseTitle` | max-width:42%、13px、label-secondary | 阶段名 |
| `.phaseCount` | flex:1、13px、label-tertiary | 阶段成员数 |
| `.phaseStatus` | 13px 下约 132px 宽、右对齐、label-secondary | 阶段聚合状态（如"运行中 2 · 已完成 1"） |
| `.phaseList` | 列布局、gap:4px、`padding:4px 0 0 16px`（≤560px 时 12px） | 阶段列表缩进 |
| `.members` | 列布局、gap:2px、`padding:0 0 0 16px`（≤560px 12px） | 成员列表缩进 |
| `.memberRow/.memberButton` | 100% 宽、min-height:24px、gap:12px、border-radius:4px、label-secondary | 成员行 |
| `.memberButton .memberLabel` | `--dsw-alias-link` + 500 字重，hover / focus-visible 出虚线下划线 | 可打开成员的导航提示 |
| `.dotSlot` | 16×24 固定槽、flex:none | 对齐状态点 |
| `.memberLabelWrap` | flex:1、ellipsis；focus-visible 时 outline:2px business-primary | 成员名 |
| `.memberStatus` | width:64px、右对齐、13px、label-secondary | 成员状态文字 |
| `.empty` | 13px、label-tertiary | "没有启动成员" |

### primitives 的 DisclosureRow / StateDot

- `DisclosureRow`：受控组件，props 有 `icon/title/open/expandable/onToggle/expandOnRowClick/previewChevron/keepContentWhenOpen/collapsedContent/className/rowClassName/leadingClassName/chevronClassName/titleClassName`（逐条注释见 `@deepseek-ai/dsh-client-ui-primitives` 的 `DisclosureRow.d.ts`）。`expandOnRowClick` 时整行 role=button、tabIndex=0、aria-expanded、支持 Enter/Space。行高 24px 默认（workflow-run 覆盖为 32px）。
- `StateDot`：`{state, size = 10, className}`（默认 10 见 `StateDot.d.ts`）。`state === "ongoing"` → 4×4 矩阵扫描动画 svg；否则 `<span data-state>` 圆点，颜色按第 2 节的 data-state 规则。

### 可借鉴的颜色变量

- `--dsw-alias-state-success-primary`（完成绿）、`--dsw-alias-state-warn-primary`（警告黄）、`--dsw-alias-state-error-primary`（错误红）、`--dsw-static-deepseek-450`（运行中蓝/品牌色）
- `--dsw-alias-bg-module-platform`（行背景）、`--dsw-alias-label-secondary` / `-tertiary`（文字两级灰）
- `--dsw-alias-state-business-primary`（焦点环蓝）、`--dsw-alias-link`（可点击成员名）

---

## 7. 顺带：dsh-client-ui-jobs 与 workflow-run 的关系

`JobListAction`（`dsh-client-ui-jobs/lib/client.js:117`）是**会话 header** 上的触发器按钮（slot `conversation.session.header.actions`，id `job-list`，order 20），不是 chat 流节点：

- 数据：`state.jobsBySession[sessionId]`（每个 session 的后台任务列表），无任务时不渲染任何东西（client.js:139）。
- 形态：按钮（live 时带 ongoing 点 + `"{count} 个后台任务运行中"` 计数 + 旋转 chevron）→ 点击弹出 336px 宽的浮层列表（`_menu`：max-height `min(420px, 100vh - 140px)`、`--dsw-specific-menu` 底色、`--dsw-elevation-prominent` 阴影、radius 20px）。
- 每行：StateDot（job 状态：running→ongoing、stopping/killed→warning、completed→done、failed→error，client.js:52-62）+ kind 小标签 + label + detail/status + 持续时长（`formatDuration`，client.js:81，运行中每秒 tick 刷新，client.js:126-135）。
- **与 workflow-run 的区别**：jobs 是"这个会话的后台任务清单"（一维列表，含时长，不进聊天流）；workflow-run 是"聊天流里的一个 durable 工作流记录卡"（两层折叠分组，按 phase 组织成员）。两者共用 primitives 的 StateDot 徽标和计数文案风格（`count.live.*` 与 `statusCount.*` 都叫"运行中 N"），但结构完全不同。截图里的卡片（3 成员/phase 分组/运行中计数）对应的是 **workflow-run** 形态，不是 jobs。
- **workflow 运行不进 jobs**：`dsh-tool-workflow` 全文没有 jobs 引用；workflow 的成员由引擎直接启动（`dsh-workflow-ptc/lib/index.js` 的 `this.subagents.start(...)`），不走 `dsh-tool-subagent` 那条注册 job 的路径。所以父会话的 `session/jobs` 帧在 workflow 运行期间是空的（除非父代理同时跑了别的后台工具）；成员子会话自己的后台任务记在各自 sessionId 下（jobs 按 owner 作用域）。

---

## 8. 当时写给 dsh-one 的启示（历史）

这一节是给**已下线的自研聊天区**写的：以 dsh web 这套样式重做 dsh-one 聊天流里的后台任务卡片。前提（自己在 dsh-one 里渲染卡片）已经不存在了，留着只为记录当时的数据结构对比（官方 `{name, status, phases[{key, phase, members[{seq, label, childId, status}]}]}` 有五值 status，含 interrupted = 结束事件缺失但位置已关闭；dsh-one 当时是扁平的后台任务模型）、视觉参数、状态驱动展开/折叠的算法（`mode: abnormal|running|clean` + `initialDisclosureState` + `advanceDisclosureState`）与简化点（不复刻 durable 折叠、`navigableMembers` 的「仅运行中的直系 subagent 可点开」约束、不用 jobs 形态的 header 按钮）。
