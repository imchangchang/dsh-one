# dsh web 可展开组件清单

**本文只剩官方可展开组件清单，是查官方组件用的；二、三节（旧自研聊天区的对照与优化清单）已于 2026-09-20 删除，需要的话从 git 历史取。**

写于 2026-09-01（自研聊天区时期），2026-09-20 复核。纯调研，当时未改任何代码。

装配对话区里跑的就是下面清单里这些官方前端组件（chat 树的 block list 只有两件：官方外框 `dsh-client-ui-layout` 与官方侧栏 `dsh-client-ui-sidebar`，见 `src/ui/assembly/wireFilter.ts` 的 `CHAT_BLOCK_LIST`），读它们能知道官方给用户提供了哪些展开交互、自己写插件时要照哪种形态走。

**引用口径**：只写包名与组件名（例如 `dsh-client-ui-conversation` 的 `TodoPanel`），不写行号——这些是编译产物，行号每发一个 dsh 版本都可能变。复核基线是本机 dsh 0.1.6-alpha.1。撰写时记的行号已经对不上：对话侧的 `ReasoningRow` / `ContextInjectionRow` / `GenericCommandCard` / `CompactionCommandCard` / `CompactionItem` 当时记在 `dsh-client-ui-conversation` 下，0.1.6-alpha.1 已经搬到 `dsh-client-ui-chat`。

研究对象：

- **官方 dsh web 前端的组件包**：`node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*` 各包的 `lib/client.js`（未压缩，带 `//#region` 源码路径注释）。
- **primitives**（`DisclosureRow` / `StateDot` / `CodeBlock` / `JsonTree` 这类底层件）：撰写时只能从 `dsh-web-frontend/dist/assets/index-*.js` 的压缩 bundle 里还原。现在 `@deepseek-ai/dsh-client-ui-primitives` 已经作为 npm 包发布（alpha 通道 0.1.6-alpha.2，包里有 `lib/index.js` 与逐组件的 `.d.ts`，例如 `DisclosureRow.d.ts` 写明了每个 prop 的含义），可以直接读。本机装的 dsh 0.1.6-alpha.1 里没有这个包——它是各 UI 包的声明依赖，构建时打进页面 bundle，所以 `dsh-web-frontend/dist/assets/` 下那份页面仍是查运行时行为的去处（CSS 已从 JS bundle 拆到同目录的 `.css`，类名带构建哈希）。

---

## 组件清单

### 1.1 统一机制：`DisclosureRow`（primitives）

所有「行式展开」共用这一个组件，语义（读 `@deepseek-ai/dsh-client-ui-primitives` 的 `DisclosureRow.d.ts` 与页面上跑的实现）：

- `expandable` + `expandOnRowClick`：整行变 `role=button`、`tabIndex=0`、`aria-expanded` 挂在行上，点击整行切换。
- 只 `expandable` 不 `expandOnRowClick`：只有行首图标是可点按钮，`aria-expanded` 挂图标。
- `previewChevron`（默认 = expandable）：折叠态显示「原图标 + hover 浮现 chevron」。
- `keepContentWhenOpen`：展开后折叠态摘要（`collapsedContent`）仍保留在行内。
- `children` 只在 `open` 时渲染。

使用 `DisclosureRow` 的组件：

| 组件 | 包 | 展开触发 | 展开后显示 | 折叠态行内摘要 |
|---|---|---|---|---|
| `ReasoningRow`（Think 推理块） | `dsh-client-ui-chat` | 整行点击（expandOnRowClick） | 推理全文（`thinkBody`，pre-wrap） | 「Think」+ 分隔点 + 首行（流式中为最新一行：`firstLine` / `latestLine`） |
| `ContextInjectionRow`（上下文注入） | `dsh-client-ui-chat` | 整行点击 | 按 producer 声明的 form 渲染 body（text / files / json / entries / sections / opaque），超长文本截断（`boundedText`，`MAX_CHARS` = 20000）、未知块用 `JsonBlock`（`… truncated, N characters total`） | 「上下文注入/回顾」+ 分隔点 + source 标签 + 摘要行；`keepContentWhenOpen` |
| `GenericCommandCard`（slash 命令卡） | `dsh-client-ui-chat` | 整行点击 | 命令输出全文（`pre`）；**仅当 text 含换行时可展开**（`body = text.includes("\n") ? text : null`） | 命令名 + 分隔点 + 摘要（运行中/失败/输出首段） |
| `CompactionCommandCard` | `dsh-client-ui-chat` | 同上 | 委托给 `GenericCommandCard` 或 `CompactionItem` | 同上 |
| `ToolRow`（工具调用卡） | `dsh-client-ui-tool` | 整行点击 | 按 variant 选一个 body：`TerminalBlock`（不限行）/ `DiffBlock`（8 行）/ `ReadBlock`（8 行）/ `SearchBlock`（8 行）/ `WebBlock`；代码类工具是 `CodeBlock` + **IN/OUT 卡**（`ioCard`，IN=输入 JSON、OUT=输出，每段 `max-height:150px` 内部滚动）；尾部 **Inspect** 按钮（跳轨迹面板） | 工具图标 + 动作短语 + 分隔点 + 摘要（terminal 描述 / 搜索标题 / 错误摘要），失败红字；`keepContentWhenOpen` |
| `WorkflowRunPanel`（workflow 运行） | `dsh-client-ui-workflow-run` | 整行点击（`StatusDisclosure` = DisclosureRow + `expandable:true`） | **run 级**：phase 列表；**phase 级**：成员列表 | run 名 + N 个成员 + 状态；phase 名 + N 个成员 + 聚合状态；带**自动折叠状态机**（`advanceDisclosureState`：clean 自动收起、abnormal/running 自动展开、焦点在内延迟收起） |
| `CordisDefineRow`（cordis 插件定义卡） | `dsh-client-ui-cordis` | 整行点击 | 插件定义详情 | 插件名 + 用途 + 状态 |

### 1.2 手工折叠（button + `aria-expanded` / `<details>` 语义，不走 DisclosureRow）

| 组件 | 包 | 展开触发 | 展开后显示 | 备注 |
|---|---|---|---|---|
| `TodoPanel`（任务清单卡） | `dsh-client-ui-conversation` | header 按钮（`aria-expanded`，chevron） | todo 项列表，`max-height:180px` 滚动 | **默认折叠**；头部 = 图标 + 「任务」+ 进度摘要（「3 进行中 · 1 待处理」） |
| `QueueDock`（排队消息） | `dsh-client-ui-conversation` | 计数 header 按钮（chevron） | 排队消息列表（含编辑/插话/删除操作） | 多条时默认折叠成计数 header，单条直接内联显示 |
| `CompactionItem`（压缩摘要标记） | `dsh-client-ui-chat` | 整行按钮（chevron，`aria-expanded`） | 压缩摘要（MarkdownText） | **默认折叠**；无 summary 时不可展开（disabled） |
| `SkillRow`（skill 卡） | `dsh-client-ui-skill` | 手工 disclosure（`data-expandable` + `aria-expanded` + hover chevron） | 指令全文卡（`instructionsCard`，max-height:260 滚动） | 有 output 才可展开 |
| `BashRow`（bash 卡） | `dsh-client-ui-tool` | 同上 | `TerminalBlock` 输出 | 同上 |

### 1.3 原始组件级展开（primitives，供 ToolRow / MarkdownText 复用）

| 组件 | 展开行为 | 证据（读 `@deepseek-ai/dsh-client-ui-primitives` 的编译产物与页面 bundle） |
|---|---|---|
| `TerminalBlock` | 输出行折叠：展开按钮 + 收起按钮，可见文字与 aria 标签都由调用方传入的 labels 对象给（`expand(n)` / `collapse` / `expandAria(n)` / `collapseAria`） | `expandAria(n)` / `collapseAria` 两个标签工厂 |
| `CodeBlock` | 代码块行折叠（同上），带复制按钮 | labels 里的 `copy` / `expand` / `collapse` |
| `DiffBlock` | diff 行折叠（同上） | labels 里的 `expand` / `collapse` |
| `SearchBlock` | 每个文件一个可折叠 header（`aria-expanded`）+ 结果行折叠 | `fileHeader` |
| `JsonTree` | JSON 树**逐节点**展开（`data-json-expander`，`role=button` + `aria-expanded` + `aria-controls`，expand/collapseNode 标签） | `data-json-expander`；trajectory 用它渲染 request options / message source payload |
| `JsonBlock` | 超长 JSON 截断提示（字典 key `json.truncated`，zh「… 已截断，共 {total} 字符」/ en「… truncated, {total} characters total」） | `dsh-client-ui-chat` 的字典 + `JsonBlock` |

### 1.4 面板 / 会话级

| 组件 | 包 | 展开行为 |
|---|---|---|
| 轨迹面板（TrajectoryView/Table） | `dsh-client-ui-trajectory` | **按 turn 折叠**（`collapsedTurns`）、**按 assistant 折叠**（`collapsedAssistants`，即「assistant 消息 + 其后一串工具调用」整体收起成摘要行）、工具栏「Collapse turns / Collapse calls」一键折叠全部；选中记录的详情用 **tabs**（Summary/Preview/Raw/Source/Payload）+ `JsonTree` |
| 子代理目录树 | `dsh-client-ui-subagent` | 目录分支逐层展开/折叠（`expanded` Set + `toggleBranch`，递归只渲染展开的分支） |
| workspace 会话分组 | `dsh-client-ui-workspace` | 分组折叠（`expandedGroups`，`aria-expanded`）+ 会话搜索面板折叠（`searchExpanded`） |
| sidebar / layout | `dsh-client-ui-sidebar` + `dsh-client-ui-layout` | 侧栏整体折叠（`sidebarCollapsed`，可拖拽调宽）。**这两件在我们三棵树的 block list 里**（外框由自有 frame 插件接管，侧栏由 `packages/dsh-workspace-tree` 接管），列在这里只为知道官方原本怎么做 |
| agent-preset / jobs | `dsh-client-ui-agent-preset` / `dsh-client-ui-jobs` | **popover 弹层**（`Menu` 原语：trigger 带 `aria-expanded`，点开出现浮层），不是 disclosure |
| context-meter / message-feedback | `dsh-client-ui-conversation` / `dsh-client-ui-message-feedback` | context-meter 是 `Tooltip` 弹层（触发按钮带 `aria-expanded`）；message-feedback 的备注编辑用 `Modal` + `Tooltip`，不是 disclosure |
| attachment 图片 | `dsh-client-ui-attachment` | 缩略图点击 → 全屏 lightbox（`ImageLightbox`，modal 预览原图） |

### 1.5 展开逻辑的分布（0.1.6-alpha.1 复核）

- `dsh-client-ui-deliverables`：**有**可展开行——`PresentRow` 用 `DisclosureRow`（present 调用状态 + 可展开的结果文本），另有 `ProducedFiles` 的「还有 N 个」展开。撰写时记的「纯状态投影，无 UI 组件」已不成立。
- `dsh-client-ui-goal`：**有 UI**（`GoalBar` / `GoalDock` / `GoalCommandInputView`，注册 goal dock 与 goal chat node），但没有 disclosure / `aria-expanded`——它不做展开。
- `dsh-client-ui-reference`、`dsh-client-ui-directory-picker-browse`：全文无 `aria-expanded`，无展开逻辑。
