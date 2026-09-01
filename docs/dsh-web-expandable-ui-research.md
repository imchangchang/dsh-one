# dsh web 可展开 UI 调研 vs dsh-one 现状对照

调研时间：2026-09。纯研究，未改任何代码。

研究对象：
- **dsh web 前端**：`node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*` 各包的 `lib/client.js`（未压缩，带 `//#region` 源码路径），以及 `dsh-web-frontend/dist/assets/index-*.js`（压缩 bundle，含 `dsh-client-ui-primitives` 的 `DisclosureRow` / `CodeBlock` / `JsonTree` 等原始组件定义）。
- **dsh-one**：`src/ui/chat/webview.ts`（渲染）、`src/pure/conversation.ts`（折叠）、`src/pure/chatContract.ts`（块契约）。

---

## 一、dsh web 可展开组件清单

### 1.1 统一机制：`DisclosureRow`（primitives，bundle `q7` 函数）

所有「行式展开」共用这一个组件，语义（从压缩 bundle 还原）：

- `expandable` + `expandOnRowClick`：整行变 `role=button`、`tabIndex=0`、`aria-expanded` 挂在行上，点击整行切换。
- 只 `expandable` 不 `expandOnRowClick`：只有行首图标是可点按钮，`aria-expanded` 挂图标。
- `previewChevron`（默认 = expandable）：折叠态显示「原图标 + hover 浮现 chevron」。
- `keepContentWhenOpen`：展开后折叠态摘要（`collapsedContent`）仍保留在行内。
- `children` 只在 `open` 时渲染。

使用 `DisclosureRow` 的组件：

| 组件 | 包 / 源码路径 | 展开触发 | 展开后显示 | 折叠态行内摘要 |
|---|---|---|---|---|
| `ReasoningRow`（Think 推理块） | `dsh-client-ui-conversation` `chat/ReasoningRow.js`（client.js:9389） | 整行点击（expandOnRowClick） | 推理全文（`thinkBody`，pre-wrap） | 「Think」+ 分隔点 + **首行**（流式中为最新一行，`firstLine`/`latestLine`） |
| `ContextInjectionRow`（上下文注入） | `dsh-client-ui-conversation` `chat/ContextInjectionRow.js`（client.js:4941） | 整行点击 | 按 producer 声明的 form 渲染 body（text / files / json / entries / sections / opaque），超长文本截断（`boundedText` MAX_CHARS）、未知块用 `JsonBlock`（`… truncated, N characters total`） | 「上下文注入/回顾」+ 分隔点 + source 标签 + 摘要行；`keepContentWhenOpen` |
| `GenericCommandCard`（slash 命令卡） | `dsh-client-ui-conversation` `chat/GenericCommandCard.js`（client.js:9586） | 整行点击 | 命令输出全文（`pre`）；**仅当 text 含换行时可展开**（`expandable = body !== null`） | 命令名 + 分隔点 + 摘要（运行中/失败/输出首段） |
| `CompactionCommandCard` | `dsh-client-ui-conversation` `chat/CompactionCommandCard.js` | 同上 | 委托给 `GenericCommandCard` 或 `CompactionItem` | 同上 |
| `ToolRow`（工具调用卡） | `dsh-client-ui-tool` `tool/components/ToolRow.js`（client.js:689） | 整行点击 | 按 variant 选一个 body：`TerminalBlock`（maxLines:∞）/ `DiffBlock`（maxLines:8）/ `ReadBlock`（8）/ `SearchBlock`（8）/ `WebBlock`；代码类工具是 `CodeBlock` + **IN/OUT 卡**（`ioCard`，IN=输入 JSON、OUT=输出，`max-height:150px` 内部滚动）；尾部 **Inspect** 按钮（跳轨迹面板） | 工具图标 + 动作短语 + 分隔点 + 摘要（terminal 描述 / 搜索标题 / 错误摘要），失败红字；`keepContentWhenOpen` |
| `WorkflowRunPanel`（workflow 运行） | `dsh-client-ui-workflow-run` `WorkflowRunPanel.js`（client.js:78） | 整行点击（StatusDisclosure = DisclosureRow + expandable:true） | **run 级**：phase 列表；**phase 级**：成员列表 | run 名 + N 个成员 + 状态；phase 名 + N 个成员 + 聚合状态；带**自动折叠状态机**（`advanceDisclosureState`：clean 自动收起、abnormal/running 自动展开、焦点在内延迟收起） |
| `CordisDefineRow`（cordis 插件定义卡） | `dsh-client-ui-cordis`（client.js:301） | 整行点击 | 插件定义详情 | 插件名 + 用途 + 状态 |

### 1.2 手工折叠（button + `aria-expanded` / `<details>` 语义，不走 DisclosureRow）

| 组件 | 包 / 源码路径 | 展开触发 | 展开后显示 | 备注 |
|---|---|---|---|---|
| `TodoPanel`（任务清单卡） | `dsh-client-ui-conversation` `skeleton/TodoPanel.js`（client.js:6597） | header 按钮（`aria-expanded`，chevron） | todo 项列表，`max-height:180px` 滚动 | **默认折叠**；头部 = 图标 + 「任务」+ 进度摘要（「3 进行中 · 1 待处理」） |
| `QueueDock`（排队消息） | `dsh-client-ui-conversation` `queue/QueueDock.js`（client.js:6709） | 计数 header 按钮（chevron） | 排队消息列表（含编辑/插话/删除操作） | **仅 >1 条时出现折叠 header**；单条直接内联一行 |
| `CompactionItem`（压缩摘要标记） | `dsh-client-ui-conversation` `chat/CompactionItem.js`（client.js:4301） | 整行按钮（chevron，`aria-expanded`） | 压缩摘要（MarkdownText） | **默认折叠**；无 summary 时不可展开（disabled） |
| `SkillRow`（skill 卡） | `dsh-client-ui-skill`（client.js:113） | 手工 disclosure（`data-expandable` + `aria-expanded` + hover chevron） | 指令全文卡（`instructionsCard`，max-height:260 滚动） | 有 output 才可展开 |
| `BashRow`（bash 示例卡） | `dsh-client-ui-tool`（client.js:1128 附近） | 同上 | `TerminalBlock` 输出 | 同上 |

### 1.3 原始组件级展开（primitives，供 ToolRow / MarkdownText 复用）

| 组件 | 展开行为 | 证据（bundle） |
|---|---|---|
| `TerminalBlock` | 输出行折叠：「展开其余 N 行输出」/「收起」 | bundle `expandAria`/`expandRest` |
| `CodeBlock` | 代码块行折叠：「展开其余 S 行」/「收起」，带复制按钮 | bundle（zh 文案「展开其余 S 行」） |
| `DiffBlock` | diff 行折叠：「展开其余 L 行差异」 | bundle |
| `SearchBlock` | 每个文件一个可折叠 header（`aria-expanded`）+ 结果行折叠 | bundle `fileHeader` |
| `JsonTree` | JSON 树**逐节点**展开（`data-json-expander`，`role=button` + `aria-expanded` + `aria-controls`，expand/collapseNode 标签） | bundle；trajectory 用它渲染 request options / message source payload |
| `JsonBlock` | 超长 JSON 截断提示（`… truncated, {total} characters total`） | bundle + conversation `json.truncated` |

### 1.4 面板 / 会话级

| 组件 | 包 | 展开行为 |
|---|---|---|
| 轨迹面板（TrajectoryView/Table） | `dsh-client-ui-trajectory` | **按 turn 折叠**（`collapsedTurns` + `toggleTurn`）、**按 assistant 折叠**（`collapsedAssistants`，即"assistant 消息 + 其后一串工具调用"整体收起成摘要行）、工具栏「Collapse turns / Collapse calls」一键折叠全部；选中记录的详情用 **tabs**（Summary/Preview/Raw/Source/Payload）+ `JsonTree` |
| 子代理目录树 | `dsh-client-ui-subagent` | 目录分支逐层展开/折叠（`expanded` Set + `toggleBranch`，`branch.expand/collapse` aria-label，递归只渲染展开的分支） |
| workspace 会话分组 | `dsh-client-ui-workspace` | 分组折叠（`expandedGroups`，`aria-expanded`）+ 会话搜索面板折叠（`searchExpanded`） |
| sidebar / layout | `dsh-client-ui-sidebar` + `layout` | 侧栏整体折叠（`sidebarCollapsed`，拖拽调宽） |
| agent-preset / jobs / message-feedback / context-meter | `dsh-client-ui-agent-preset` / `jobs` / `message-feedback` / `conversation` | 都是 **popover 弹层**（dropdown/menu），不是 disclosure；message-feedback 的备注编辑弹层带 `aria-expanded` |
| attachment 图片 | `dsh-client-ui-attachment` | 缩略图点击 → 全屏 lightbox（modal 预览原图） |

### 1.5 明确**没有**展开逻辑的包

- `dsh-client-ui-deliverables`、`dsh-client-ui-goal`：纯状态投影/命令输入，无 UI 组件。
- `dsh-client-ui-reference`、`dsh-client-ui-directory-picker-browse`：无展开。

---

## 二、dsh-one 现状对照表

| # | dsh-one UI | 位置 | 当前可否展开 | 机制 | 对比 dsh web |
|---|---|---|---|---|---|
| 1 | 思考过程（reasoning 块） | `webview.ts` renderBlock `case 'reasoning'`（:2772） | ✅ | `<details>` + summary「思考过程」，默认折叠，展开态持久化在 `detailsOpen`（按消息/块位置 key，换会话清空） | web 的 ReasoningRow 也是默认折叠；**差异**：web 折叠态在行内显示推理**首行预览**，dsh-one 只有「思考过程」四个字 |
| 2 | 上下文注入（user context） | `renderMessage` `m.context`（:2479） | ✅ | `<details>` 默认折叠 | web 的 ContextInjectionRow 有 source 标签 + 摘要 + 结构化 body；dsh-one 只折叠了纯文本（`context-body` = m.text），无 source/结构 |
| 3 | 任务清单卡（todo_write） | `renderTodoPanel`（:2376） | ✅ | `<details>` 默认折叠，头部「任务 + 进度摘要 + chevron」 | 对齐 web TodoPanel |
| 4 | workflow-run 卡 | `renderWorkflowRun`（:2565） | ✅ | run 级 + phase 级两级折叠，`advanceWorkflowDisclosure` 状态机（含自动收起），状态持久化按 runId | 对齐 web WorkflowRunPanel（含 run/phase 自动折叠状态机） |
| 5 | 工具输出（长输出） | `renderToolOutput`（:2833） | ✅ | 默认预览 5 行（`truncateLines` OUTPUT_PREVIEW_LINES）+「… 共 N 行，点击展开」toggle | 对齐 web TerminalBlock 的「展开其余 N 行」（但 web 是行内按钮、dsh-one 是整行点击） |
| 6 | 工具卡整体（IN/OUT） | `renderTool`（:2790） | ❌ | **单行**：动作短语 + title（+detail 第二行），无 chevron、无展开 | web ToolRow 整行可展开出 IN（args JSON）+ OUT（result）；**这是主要缺口** |
| 7 | 代码块（markdown 内） | `md()`（:246，marked + DOMPurify） | ❌ | 渲染成普通 `<pre><code>`，无折叠、无复制按钮 | web MarkdownText 的 CodeBlock 支持「展开其余 S 行」+ 复制 |
| 8 | diff | `renderDiff`（:2849） | ❌ | 全量渲染 del/add 行 | web DiffBlock 折叠到 8 行 +「展开其余 L 行差异」 |
| 9 | command 卡 | `renderMessage` `case 'command'`（:2511） | ❌ | 单行 `/${name} ${args}` + 状态 + text，无展开 | web GenericCommandCard 多行输出可展开 |
| 10 | 排队消息（queue） | `renderQueueItem`（:2178） | ❌ | 每条消息一行（含编辑/插话/删除），无数 header | web QueueDock >1 条时折叠成计数 header |
| 11 | workspace 分组 | `renderWorkspaceGroup`（:1942） | ✅ | 行点击折叠 + header「折叠/展开所有」按钮 | 对齐 web workspace 分组 |
| 12 | 子代理菜单 | `appendSubagentRow`（:1013） | ⚠️ 部分 | 递归**平铺缩进**树（每级 16px），无分支折叠；`doing/subagent-header-tree` 正在修（缩进 + 嵌套数据链路） | web 子代理目录树分支可逐层展开 |
| 13 | 图片预览 | `messageImageThumb` / `openLightbox`（:2254/:2306） | ✅ | 缩略图点击 → 全屏 lightbox | 对齐 web attachment lightbox |
| 14 | 消息块「详情」 | — | ❌ | 无此层（消息就是块列表） | web 同样没有消息级展开；web 的「详情」落在独立的轨迹面板 Inspector |
| 15 | 轨迹面板 / Inspect | — | ❌ | 无此功能（无 trajectory 数据链路） | web ToolRow 的 Inspect 按钮跳轨迹面板看完整调用链 |

---

## 三、dsh-one 可优化的展开点清单（按优先级）

数据可用性判断基于 `chatContract.ts` 契约 + `conversation.ts` 折叠逻辑。

### P0 — 高价值、数据现成

**1. 工具卡 IN/OUT 展开（对齐 web ToolRow）**
- 数据：✅ **完全可用**。`tool/call` 事件的 `data.arguments` 折叠时就在手里（`conversation.ts` `applyToolCall` 已用它算 todo_write 的 planSummary，只是没存）；输出 `block.output` 已有。
- 改动面：`chatContract.ts` `ChatToolBlock` 加 `arguments?: string`；`conversation.ts` `applyToolCall` 存 args；`webview.ts` `renderTool` 加 chevron + 展开 IN/OUT 卡。
- 备注：`docs/backlog/open/tool-call-expandable.md` 已挂条目，本报告就是它的前置调研。对齐形态：web 的 ioCard（IN/OUT 两栏、150px 内滚动、失败红字）。

**2. 代码块折叠 + 复制（对齐 web CodeBlock）**
- 数据：✅ 完全可用。text 块全文就在 `ChatTextBlock.text`，渲染时 marked 出的 `<pre><code>` 就是它。
- 改动面：纯 `webview.ts`（md 后处理：超长代码块加「展开其余 S 行」toggle + 复制按钮），`conversation.ts` 无改动。
- 价值：dsh web 的代码块是高频展开场景，dsh-one 目前长代码块直接铺满。

### P1 — 中价值、数据现成

**3. diff 折叠（对齐 web DiffBlock 8 行上限）**
- 数据：✅ 已有（`ChatToolBlock.diff`）。
- 改动面：纯 `webview.ts` `renderDiff`。

**4. command 卡多行输出展开（对齐 web GenericCommandCard）**
- 数据：✅ 已有（`ChatCommandMessage.text`；含换行才可展开——web 同款判定）。
- 改动面：`webview.ts` `renderMessage` command 分支。

**5. 推理块折叠态加首行预览（对齐 web ReasoningRow summary）**
- 数据：✅ 已有（`ChatReasoningBlock.text`）。
- 改动面：纯 `webview.ts`，把 `<summary>` 从「思考过程」改成「思考过程 · 首行…」。

**6. queue 计数折叠（对齐 web QueueDock）**
- 数据：✅ 已有（`ChatState.queue`，`queued` placement 多条时）。
- 改动面：`webview.ts` render() 的 queue 区；⚠️ 注意 dsh-one 每条排队消息带编辑/插话/删除操作，折叠后操作入口要藏进展开态，交互与 web（操作在行内 hover）不完全相同，需斟酌形态。

**7. 上下文注入结构化 body（对齐 web ContextInjectionRow 的 files/entries/sections form）**
- 数据：⚠️ **部分可用**。dsh-one 折叠模型里 `m.context` 只有 source.kind 字符串、body 是纯文本 `m.text`；web 的 files/entries/sections 结构化 body 来自 durable source 的 producer 字段，dsh-one 需要 host 在 fold 时把 source 解析出来补进契约才能做。当前只能做到「展开看全文」+ 折叠态摘要（无 source 标签）。
- 改动面：`chatContract.ts` + `conversation.ts`（解析 source）+ `webview.ts`。

### P2 — 大件 / 需要数据链路

**8. 工具输出 JSON 友好展示（对齐 web JsonTree/JsonBlock）**
- 数据：⚠️ 部分。`block.output` 已有但 fold 时被 `truncate` 4000 字符硬截断（`conversation.ts` OUTPUT_LIMIT）+ webview 5 行预览；web 对 JSON 输出是 JsonTree 逐节点展开。要做需先解决「截断数据不可恢复全文」：fold 保留全文 or 输出为 JSON 时结构化。
- 低配版（P1 可做）：`renderToolOutput` 展开态若内容是 JSON，prettify 后展示 + 复制。

**9. 轨迹面板 + Inspect**
- 数据：❌ dsh-one 完全没有 trajectory/session 查询链路，是整块新功能，不是「加展开」。web 的 Inspect 按钮（tool 卡尾部）指向它。若只想要"看完整调用链"，性价比不高；列为远期。

### 已对齐、无需动的点（避免重复劳动）

- 任务清单卡（todo_write 卡 + 消息内 todos 摘要）✅ 已可展开/已对齐。
- workflow-run 卡 run/phase 两级展开 ✅ 已对齐（含自动折叠状态机）。
- workspace 分组折叠 ✅、图片 lightbox ✅、工具输出行预览展开 ✅。
- 子代理菜单树形化正在 doing（`subagent-header-tree`，修嵌套 + 缩进问题），不重复列。

---

## 附：dsh web 各包可展开特征统计（grep 计数）

```
dsh-client-ui-trajectory   71   （turn/assistant 折叠 + JsonTree + tabs）
dsh-client-ui-conversation 46   （ReasoningRow / ContextInjectionRow / GenericCommandCard / TodoPanel / QueueDock / CompactionItem）
dsh-client-ui-tool         30   （ToolRow / BashRow / ToolCallTree 递归子调用）
dsh-client-ui-sidebar      17   （侧栏折叠）
dsh-client-ui-workflow-run 14   （run/phase DisclosureRow + 状态机）
dsh-client-ui-skill        12   （SkillRow 手工 disclosure）
dsh-client-ui-cordis        8   （CordisDefineRow DisclosureRow）
dsh-client-ui-workspace     7   （分组折叠 / searchExpanded）
dsh-client-ui-layout        6   （侧栏几何折叠）
dsh-client-ui-subagent      5   （目录树分支展开）
（其余包为 popover/菜单类或 0）
```
