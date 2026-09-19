# 旧侧栏 vs 现装配侧栏：源码级功能与样式对照

本文件是 issue #128 的产出，供用户逐条挑剩下的差异。**只出对照结论，不改任何功能代码。**

> **写作时间与适用版本**：2026-09-16，对分支 `develop/cordis-chat` 的提交 `d31fbdc`（该分支已整体合入 `main`）。此后本文跟着后续条目陆续补过结论（#151 展开态口径、#152 搜索高亮、#153 未读计数、#154 回收站抽屉与行、#155 分组拖拽与源行半透明、#213 / #215 / #216 标签组；逐条见 C1）。**表里的 `文件:行` 是写作时那份代码的行号**，代码此后有改动、行号会漂移；要看当前事实请读代码与 `docs/architecture.md`。旧侧栏（`src/ui/sessionsView.ts` 等）在 2.0.0 已摘钩（`src/extension.ts` 不再挂它，只作 #65 的迁移参照物），代码留在仓库里不再随主线演进。

## 怎么读这份对照

- **两侧正本**：旧侧栏（vanilla，迁移参照物，只读勿改）是 `src/ui/sessionsView.ts`（宿主侧 view provider + 消息处理 + 全部 CSS 的 `SESSIONS_STYLE`）、`src/ui/sessionsWebview.ts`（前端 HTML / CSS / 逻辑）、`src/ui/sessionsStore.ts`（数据与状态）、`src/pure/sessionTree.ts`（分组 / 排序 / 过滤）、`src/pure/sessionTags.ts`（标签色与内置组）；现装配侧栏是 `packages/dsh-workspace-tree/`（`@dsh-one/dsh-workspace-tree`）的 `src/workspaceTree/*.ts`（23 个文件）与 `src/workspaceTreePlugin.ts`，加 `src/ui/assembly/shell/sidebarLayoutPlugin.ts`（密度档与侧栏外框）、`src/pure/{workspaceTreeView,workspaceTreePrefs,treeGroups,sessionMarks,sessionEligibility,sessionTags,sessionTagGroups,recycleActions,recycleBinState}.ts`。
- **判断只取四个值**：**一致** / **缺**（现在没有）/ **不同**（都有但不一致）/ **现在更好**。
- **证据**：每条都写 `文件:行`。只写文件名的那几种（`rows.ts` / `tree.ts` / `styles.ts` / `selection.ts` / `tagGroups.ts` / `modals.ts` / `toolbar.ts` / `groupFilterBar.ts` / `recycleDrawer.ts` / `recycleEntry.ts` / `hoverCard.ts` / `format.ts` / `search.ts` / `locale.ts`）都在 `packages/dsh-workspace-tree/src/workspaceTree/` 下；`sessionsView.ts` / `sessionsWebview.ts` / `sessionsStore.ts` 在 `src/ui/` 下；`pure/xxx.ts` 在 `src/pure/` 下。读不出来的写「未核实」，不臆断。
- 语言按仓库铁律：官方机制名词用英文原词（`slot` / `shadow` / `seam` / `combo`），不造词。

---

# A. 功能对照表

## A1. 会话列表与工作区分组

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 工作区分组的顺序 | **当前文件夹优先，其余按工作区 `updatedAt` 降序**（`pure/sessionTree.ts:417-421`），未分组桶收尾 | 工作区注册顺序（网关给的官方顺序）+ 未分组桶收尾（`pure/workspaceTreeView.ts` 的 `deriveGroups`） | **不同**（本文原先判「一致」，渲染实测推翻了它，见 `legacy-vs-current-sidebar-render.md` 的 C-1） |
| 「当前工作区」排最前 + 蓝色标识 | 按**当前会话**判：`sessionsWebview.ts:2311`（`has-active`）、`2337`（披 `vscode` 徽标）；置顶在 `pure/sessionTree.ts:416` | 按 **VS Code 当前打开的文件夹**判（#112）：`pure/workspaceTreeView.ts:283-306`、`353-360`；徽标 `workspaceTree/rows.ts:634`；置顶 `workspaceTree/tree.ts:542` | 不同（判据换了；观感同为「排最前 + 蓝色标识」） |
| 空工作区行 | `sessionsWebview.ts:2310`、`2366-2369`：hover **不**换折叠三角、点击不响应 | `workspaceTree/rows.ts:569`、`613-622`：hover 照常换三角、点击能展开（展开后仍是空的）；`styles.ts:301-303` | 不同（小） |
| 首次打开时的展开态 | `sessionsStore.ts:242`、`334`：`collapsed` 集合默认空 → **所有工作区都展开** | `pure/workspaceTreePrefs.ts` 的 `groupExpansion` 默认是**空记录** → **全部折叠**，只有当前会话那一组自动展开（`autoExpandGroup`，由 `workspaceTree/tree.ts` 那条 effect 调） | 不同（最显眼的一条，见 C1-1；#151 定了口径：跟官方一致） |
| 工作区行 hover 四枚动作（＋ / 终端 / 打开文件夹 / 移除） | `sessionsWebview.ts:2340-2363` | `workspaceTree/rows.ts:509-553`（同一组条件：未分组桶少三枚；当前工作区不给「打开文件夹」） | 一致 |
| 未分组桶行 | `sessionsWebview.ts:2339-2363`（只有 ＋）、`2373`（**无**右键菜单） | `workspaceTree/rows.ts:415`（菜单里也有新建）、`572`（右键菜单无条件开） | 现在更好（未分组桶也能开菜单，多了整桶归档等项） |
| 会话行结构（状态位 / 图钉 / 标题 / 时间 / ⋯） | `sessionsWebview.ts:2427-2461` | `workspaceTree/rows.ts:1197-1297` | 不同（状态位从**行尾**挪到**行首**，见 A4） |
| 行尾相对时间 | `sessionsWebview.ts:2444`（`description`；**有状态标记就不显示时间**） | `workspaceTree/rows.ts:1224-1230` + `format.ts:11-14`（官方 `relativeTime`；与状态点**同时**显示，hover 时让位给 ⋯） | 不同 |
| 空白会话显示占位名「新会话」 | `sessionsWebview.ts:2427-2438`（label 由 store 给） | `workspaceTree/format.ts:32-34`（`displayTitle` → `session.new`） | 一致 |
| 工作区展开后列出**全部**会话（不截断到 5 条） | `pure/sessionTree.ts:307`：展开就把 `sessionIds` 全列出来，没有条数上限 | `workspaceTree/rows.ts:190-200`（明确不调用官方的 `collapsedSessionRows`） | 一致 |
| 会话行 hover 只出 ⋯ | `sessionsWebview.ts:2452-2461` | `workspaceTree/rows.ts:1236-1247` | 一致 |

## A2. 多选与批量

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 进入多选 | 只有会话行菜单「选择多个」：`sessionsWebview.ts:3299-3304`、`3090-3095` | 会话行菜单 + **顶栏常驻一枚**：`rows.ts:1024-1028`、`selection.ts:24-36`、`tree.ts:646`、`toolbar.ts:335-351` | 现在更好（多一个常驻入口） |
| 行勾选资格（置顶不可勾 + 原因提示） | `sessionsWebview.ts:2973-2990`、`2417-2425` | `rows.ts:986`（`canRecycle`）、`1199-1210`（提示挂勾选框） | 一致 |
| 组头三态全选（含「有置顶时最满只到部分」） | `sessionsWebview.ts:2315-2323`、`3064-3089` | `selection.ts:48-67`、`tree.ts:743-783`（`pure/sessionEligibility.ts:86-128`） | 一致 |
| 批量动作条 | `sessionsWebview.ts:3106-3136`：按钮自带计数（「移入回收站 (N)」「归档 (N)」），位置在搜索框下、第一个工作区上 | `selection.ts:90-147`：「已选 N 项」+ 三枚按钮（不计在按钮上），位置在**分组过滤条下方**（`tree.ts:1489-1499`） | 不同（计数位置、按钮文案、位置） |
| 批量归档的「能归档几条」 | `sessionsWebview.ts:3124-3129`：按钮写可归档子集数 | `tree.ts:923-943` + `modals.ts:185-188`：按钮不写数，确认弹窗里写明跳过几条 | 不同（信息从按钮挪进弹窗） |
| 批量移入回收站 = 立即执行 + 回执 + 退出多选 | `sessionsWebview.ts:3111-3120` | `tree.ts:797-819`、`1111` | 一致 |
| 搜索结果行也能勾选 | `sessionsWebview.ts:2575-2580` | `rows.ts:1362-1365`、`tree.ts:1270-1278` | 一致 |
| 退出多选即清空勾选 | `sessionsWebview.ts:3098-3103` | `tree.ts:638-642` | 一致 |

## A3. 右键菜单（逐项，含二级项与出现条件）

### A3.1 会话行菜单（旧 10 项 / 现 11 项）

| 菜单项 | 旧（`文件:行`） | 现（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 标题行「会话: X」 | `sessionsWebview.ts:3297` | `rows.ts:1018-1022` | 一致 |
| 选择多个 | `sessionsWebview.ts:3299-3304` | `rows.ts:1023-1028` | 一致 |
| 在新标签页打开 | 无 | `rows.ts:992-1006`（宿主没有编辑器标签页时整项不出现） | 现在更好（新增项） |
| 重命名 | `sessionsWebview.ts:3305-3313`（**宿主** `showInputBox`，见 `sessionsView.ts:823-825`） | `rows.ts:1030-1034` + `modals.ts:381-456`（面板内官方 Modal） | 不同（弹窗从 VS Code 原生框换面板内模态） |
| 置顶 / 取消置顶（✓） | `sessionsWebview.ts:3314-3323` | `rows.ts:1036-1040` | 一致 |
| 标为未读 / 标为已读（✓；运行中或后代在跑时禁用 + 原因提示） | `sessionsWebview.ts:3324-3336` | `rows.ts:1041-1053`（`sessionBusy`） | 一致 |
| 移到分组…（就地展开的二级项：各组 / 不归入 / 新建） | `sessionsWebview.ts:3337-3341`、`3406-3456` | `rows.ts:1054-1060`、`tree.ts:1202-1240` | 一致（子项内容一致：三个预设组（待办 / 进行中 / 已完成，`#213` 起恢复，恒在、不可删改）+ 自建组 + 「不归入标签组」+「新建标签组…」。出现条件不同：旧**恒出现**，现只有这一行有行菜单时才有入口） |
| 分叉会话 | `sessionsWebview.ts:3342-3354`（**没有完成的轮次**时禁用） | `rows.ts:1061-1077`（**空白会话**时禁用） | 不同（禁用判据更粗，理由见该行注释） |
| 复制引用 | `sessionsWebview.ts:3355-3363` | `rows.ts:1078-1082` | 一致 |
| 移入回收站（置顶禁用） | `sessionsWebview.ts:3366-3379` | `rows.ts:1083-1098`（同一份判定、同一份原因文案） | 一致 |
| 归档会话（置顶 / 运行中 / 未读 / 待交互禁用） | `sessionsWebview.ts:3380-3397` | `rows.ts:1099-1113` | 一致 |
| 打开方式 | ⋯ 按钮或行右键（坐标锚定）：`sessionsWebview.ts:2454-2480` | 同：`rows.ts:1183-1196`（选择态与编辑态让位） | 一致 |

### A3.2 工作区行菜单（旧 6 项 / 现 9 项）

| 菜单项 | 旧（`文件:行`） | 现（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 标题行「工作区: X」 | `sessionsWebview.ts:3465` | `rows.ts:408-412` | 一致 |
| 新建会话（未分组桶） | 无（未分组桶没有菜单） | `rows.ts:414-416` | 现在更好 |
| 复制文件夹引用 | `sessionsWebview.ts:3466-3474` | `rows.ts:417-425`（没有路径的行不给） | 一致 |
| 分组…（二级项 = 分组列表，勾选即归组，勾完不关菜单） | `sessionsWebview.ts:3475`、`3520-3573`：**hover 在右侧弹一层**；没有分组时给一行灰字说明 | `rows.ts:426-432`：**就地展开**在菜单内；**没有分组时整项不出现** | 不同（展开方式 + 无分组时的表现） |
| 归档该工作区全部会话（无够格项时禁用） | `sessionsWebview.ts:3476-3487` | `rows.ts:433-446`（未分组桶文案不同） | 一致 |
| 在新窗口打开文件夹 | `sessionsWebview.ts:3488-3496` | `rows.ts:447-455`（宿主没有编辑器窗口时不出现） | 一致 |
| 复制路径 | `sessionsWebview.ts:3497-3505` | `rows.ts:456-464` | 一致 |
| 重命名工作区 | 无 | `rows.ts:465-473` + `tree.ts:1531-1542` | 现在更好（新增项） |
| 从列表移除 | `sessionsWebview.ts:3506-3514` | `rows.ts:474-483`（危险色） | 一致 |
| 打开方式 | 只右键，且多选态不开：`sessionsWebview.ts:2373-2381` | 只右键（`rows.ts:572-577`），选择态行点击接管 | 一致 |

### A3.3 标签组 pill 菜单（自建组：旧 8 项 / 现 8 项；预设组：旧 8 项 / 现 6 项）

| 菜单项 | 旧（`文件:行`） | 现（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 怎么打开 | **右键 pill**：`sessionsWebview.ts:2002-2010` | 组头右侧 **⋯ 按钮**：`tagGroups.ts` 的 `TagGroupBlock` | 不同 |
| 标题行「分组: X」 | `sessionsWebview.ts:2113` | `tagGroups.ts` 的 `tagGroupMenuItems`（`tag-menu-title`） | 一致 |
| 在此分组新建会话 | `sessionsWebview.ts:2116-2124` | `tagGroups.ts`（`tag-new-session`）+ `tree.ts` 的 `onTagMenuSelect` | 不同（未分组桶里这一项不落，因为那一桶开不出会话） |
| 归档 N 个会话（无可归档时禁用 + 提示） | `sessionsWebview.ts:2128-2139` | `tagGroups.ts`（`tag-archive`） | 一致 |
| 移 N 个会话到回收站（全置顶时禁用） | `sessionsWebview.ts:2140-2153` | `tagGroups.ts`（`tag-recycle`，无可回收时禁用） | 一致 |
| 移出分组 | `sessionsWebview.ts:2154-2162` | `tagGroups.ts`（`tag-ungroup`）+ `tree.ts` 的 `onTagMenuSelect` | 一致 |
| 重命名分组…（宿主输入框） | `sessionsWebview.ts:2164-2172`（**内置组也能改名**，改名覆盖 l10n 默认名） | 自建组：`tagGroups.ts`（`tag-rename`）+ 面板内模态；**预设组：这一项不出现**（`#213` 定了预设组不可改名，名字恒从词典出） | 不同（弹窗形态 + 预设组不再可改名） |
| 颜色（二级子菜单 6 色，当前色 ✓） | `sessionsWebview.ts:2174`、`2189-2224`（内置组同样能换色） | `tagGroups.ts`（同一菜单里的**一节**：小标题 + 6 个色块项；预设组同样有这一节） | 不同（二级 → 一节；预设组可换色这一条一致） |
| 删除分组（旧仅在非内置组出现） | `sessionsWebview.ts:2175-2185` | 自建组：`tagGroups.ts`（`tag-delete`，危险色）；**预设组：这一项不出现**，动作层也拒（`pure/sessionTagGroups.ts` 的 `deleteTagGroup` 对预设 id 直接回 null） | 一致（`#213` 把预设组不可删这一条按旧侧栏恢复；旧内置组的会话归属不再是「迁入时丢弃」） |

### A3.4 回收站行菜单

| 菜单项 | 旧（`文件:行`） | 现（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 标题行「会话: X」 | `sessionsWebview.ts:2868` | 无 | 缺（小：行本身就显示标题） |
| 恢复 | `sessionsWebview.ts:2869-2877` | `recycleDrawer.ts` 的 `RecycleRow`（`menuItems` 的 `restore`） | 一致（另外现在行尾有常驻「还原」按钮） |
| 归档（无法恢复） | `sessionsWebview.ts:2878-2886` | `recycleDrawer.ts` 的 `RecycleRow`（`menuItems` 的 `archive`，危险色 + 「永久归档」文案） | 一致 |
| 打开方式 | ⋯ 按钮 **与右键**（两者开同一份菜单）：`sessionsWebview.ts:2848-2861` | **只有右键**（拿到的是与行尾那两枚动作同一份项）：`recycleDrawer.ts` 的 `RecycleRow` 的 `onContextMenu`（**#154 补回**；行上不再有 ⋯ 按钮，点行本身是打开会话） | 不同（⋯ 按钮没了；右键入口 #154 起回来了） |

## A4. 状态显示

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 状态优先级（待交互 > 运行中 / 后代在跑 > 未读 / 完成） | `sessionsWebview.ts:2391-2406` | `pure/workspaceTreeView.ts:406-457` | 一致 |
| 状态点位置 | **行尾**固定 16px 槽：`sessionsWebview.ts:472-480`、`2446-2449` | **行首** 16×20 的 slot：`styles.ts:298`、`rows.ts:1211-1215` | 不同 |
| 状态点尺寸与动画 | 绿/黄点 6px、运行中自绘 10px 像素环：`sessionsView.ts:453-470` | 官方 `StateDot`（默认 10px，出处是官方 primitives 包的 `StateDot.d.ts`；`rows.ts:211` 未传 size） | 不同（点从 6px 变 10px） |
| 状态点与时间的关系 | 互斥（有标记就不显示时间）：`sessionsWebview.ts:2443-2449` | 同时显示，hover 时时间让位给 ⋯：`rows.ts:1224-1230`、`styles.ts:315` | 不同 |
| 工作区行的计数 | **三项**（待交互 / 运行中 / 未读），10px 小字 + 点或环图标：`sessionsWebview.ts:1839-1855`、`sessionsView.ts:418-420` | **三项**（运行中 / 等待交互 / 未读），官方 `StateDot` + 数字，**跟在工作区标题文字之后**（#138 起；此前绝对定位在行尾），第三项由 #153 补回：`rows.ts` 的 `ProjectRow` / `ActivityBadge`、`pure/workspaceTreeView.ts:474-520` | 一致（三项的桶与互斥优先级同源：每个会话只进一个桶，待交互 > 运行中 > 未读；差别只在观感——官方点 + 数字，且我们的渲染顺序是运行中 → 等待交互 → 未读） |
| 标签组折叠态计数（待交互 / 运行中 / 未读） | `sessionsWebview.ts:1956-1971` | `pure/sessionTagGroups.ts:381-390` + `tagGroups.ts:339-371` | 一致 |
| 活跃定时任务标记（闹钟） | 无 | `rows.ts:274-287`（官方 `hasActiveSchedule`，树里与搜索结果行都有） | 现在更好（官方能力保留下来了） |
| 未读：绿点 + 标题加粗 | `sessionsWebview.ts:2404`、`2438`、`sessionsView.ts:471` | `pure/workspaceTreeView.ts:444`、`rows.ts:1221`、`styles.ts:417-418` | 一致 |
| 当前会话高亮 | 蓝色（`list.activeSelectionBackground`）：`sessionsView.ts:441-444` | 悬停底色 token：`rows.ts:1137` | 不同（高亮更淡，与官方侧栏同一门语言） |
| 悬停卡（标题 / 路径 / 创建时刻 / 各状态） | 无，只有原生 `title`：`sessionsWebview.ts:2412` | 官方 `HoverCard`：`rows.ts:214-263`、`686-693`、`1302-1312`，判据 `hoverCard.ts:31-56`（容器右侧不足 244+8px 时不渲染） | 现在更好（但在 VS Code 侧栏里恒不出现，见 C-21） |

## A5. 置顶 / 未读 / 标签分组

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 置顶图钉（标题前常驻） | `sessionsWebview.ts:2429-2433` | `rows.ts:76`、`1216`（同一份描边路径） | 一致 |
| 置顶排序 | 同层最前，**置顶项之间按置顶的先后**；其后还有一层「活跃会话前置」：`pure/sessionTree.ts:287-295`、`337-380` | 同层最前，**置顶项之间保持官方顺序**；没有「活跃前置」这一层：`pure/sessionMarks.ts:135-139`、`tree.ts:520-523`、`pure/sessionTagGroups.ts:365-367` | 不同 |
| 未读标记（绿点 + 加粗） | `sessionsWebview.ts:2404`、`2438` | `pure/workspaceTreeView.ts:444`、`rows.ts:1221` | 一致 |
| 清未读的时机 | 会话被宿主的对话 tab **打开**那一刻清（`sessionsStore.ts:1345-1363`，邮件语义） | 在侧栏里**打开**这条会话时清（`tree.ts:341-344`） | 不同（触发点不同，结果接近） |
| 标签组块（pill + 贯穿竖线 + 组内缩进） | `sessionsWebview.ts:1975-2012`、`sessionsView.ts:581-634` | `tagGroups.ts:223-445`、`styles.ts:501-545`（#122 回到旧规格） | 一致 |
| 内置三组（待办 / 进行中 / 已完成） | 每个工作区 seed：`pure/sessionTags.ts:13-20`、`sessionsStore.ts:2146`（内置组也能改名 / 换色） | **已恢复（#213）**：三个预设组恒在（渲染用的视图桶由 `pure/sessionTagGroups.ts` 的 `withPresetTagGroups` 恒补，持久数据里不预写；旧文件里 `preset-*` 的定义与归属照常收下）、名字走 l10n、**不可删、不可改名**、颜色可改 | 存在性一致（#213 把 #98/#107 的「迁入时丢弃」反过来）；改名不同（旧可改、现不可改） |
| 拖会话入组 / 拖到组外移出 | `sessionsWebview.ts:2016-2052`、`1571`（MIME `text/dsh-session`） | `tagGroups.ts:193-210`、`411-435`、`tree.ts:973-984`（同一对 MIME 名） | 一致 |
| 拖 pill 换组序（含插入指示线） | `sessionsWebview.ts:2059-2110`（MIME `text/dsh-tag`） | `tagGroups.ts:289-318`、`tree.ts:987-994` | 一致 |
| 空组自动清理 | 有：`sessionsStore.ts` 的 `pruneEmptyCustomTags`（在 `moveToRecycleBin` / `moveToRecycleBinMany` 里**当场**调，判据 = 在基线里 ∧ 不在回收站） | 有：`tree.ts` 的空组清理 + `pure/sessionTagGroups.ts` 的 `pruneTagGroups`（判据由调用方给；#216 起与旧侧栏一致：在基线里 ∧ 不在归档 ∧ **不在回收站**，回收站集合一变就当场重跑） | 一致（#216 对齐） |
| 新建标签组的默认色 | 按**自建组数**在橙 / 紫 / 红里轮换（`pure/sessionTags.ts` 的 `nextCustomColor`，只看自建组、不看预设组） | 按 `TAG_COLORS` 顺序取第一个**本工作区还没被任何组占用**的颜色（预设组的当前颜色算占用；`pure/sessionTagGroups.ts` 的 `nextTagColor`，6 色全占用才回落按组数轮换） | 不同（#215 起判的是颜色而不是数量；都只给默认值，手选不受限） |
| 标签组折叠态存在哪 | 标签组文件里（`sessionsStore.ts:1105-1111`） | 客户端存储：`pure/workspaceTreePrefs.ts:38-48`、`tagGroups.ts:82-84` | 不同（存储位置；用户不可感知） |

## A6. 回收站

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 底部入口行（🗑 + 文案 + 计数 + 两枚图标） | `sessionsWebview.ts:2632-2658`、`sessionsView.ts:327-350` | `recycleEntry.ts:122-157`、`styles.ts:365-378`（槽位是官方 `sidebar.footer.action`，与官方 cordis 面板那条并存） | 一致 |
| 计数 0 时整体灰态、两枚图标禁用 | `sessionsWebview.ts:2635`、`2647`、`2651` | `recycleEntry.ts:115`、`125`、`styles.ts:370` | 一致 |
| 点主区 | **只开**：`sessionsWebview.ts:2643` | **开 / 合切换** + `aria-expanded`：`recycleEntry.ts:138-142`（事实源 `recycleDrawerStore.ts`） | 现在更好 |
| 抽屉滑出、半高 / 上拉到 90%、提手拖动、点提手收起、点外面收起、Esc 收起 | `sessionsWebview.ts:2612-2617`、`2661-2769` | `recycleDrawer.ts:42-50`、`89-244` | 一致（现值的过渡时长与缓动取官方 token，见 `styles.ts:447-461`） |
| 抽屉头 | 「‹ 返回」+ 标题（紧跟计数徽标）+ 清空（34×34，危险色）+ 「恢复全部」文本按钮：`sessionsWebview.ts:2772-2800` | **#154 起补齐同一套三样**：‹ 返回（接手原来那枚 ✕）+ 标题（紧跟计数）+ 清空 + 恢复全部（两枚与底部入口行同一形态 26×26，`styles.ts` 的 `.dshOneTree_drawerIconButton`） | 一致（#154 之前是「标题 + 计数 + ✕」，清空与全部还原只剩入口行那两枚） |
| 内容按原工作区分块、块内最近移入最上、块头可折叠 | `sessionsWebview.ts:1660-1692`、`2804-2821` | `pure/workspaceTreeView.ts:609-616`、`recycleDrawer.ts:315-362` | 一致 |
| 回收站行显示 | 状态点 + 图钉 + 标题 + 时间：`sessionsWebview.ts:2824-2863` | **#154 起同一套**：状态点（同一枚官方 `StateDot`、同一口径的 state）+ 图钉（同一枚标记）+ 标题（未读加粗）+ 时间 + 行尾两枚动作；未置顶的行没有图钉 | 一致（#154 之前是「标题 + 时间 + 动作」，没有状态点与图钉） |
| 回收站行动作 | 只有 ⋯ 菜单（恢复 / 归档） | 行内「还原」与「永久归档」两枚常显按钮 **+** 行的右键菜单（同一份两项）：`recycleDrawer.ts` 的 `RecycleRow` | 现在更好 |
| 清空 = 永久归档，先过确认弹窗 | `sessionsWebview.ts:2891-2960` | `tree.ts:913-916`、`modals.ts:136-216` | 一致 |
| 确认弹窗里按工作区列出明细 + 跳过数 | `sessionsWebview.ts:3138-3257` | `modals.ts:184-212` | 一致 |
| 挪进回收站的会话不进主树 | `pure/sessionTree.ts:258-261`（`excludedSessionIds`） | `pure/workspaceTreeView.ts:202-214` | 一致 |
| 认不出的 id 自动清账 | `sessionsStore.ts:1980-1981` | `tree.ts:455-463`、`recycleBinStore.ts:155-166` | 一致 |

## A7. 重命名 / 删除 / 新建 / 打开

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 会话重命名（菜单入口） | 宿主 `showInputBox`：`sessionsView.ts:823-825` | 面板内官方 Modal：`tree.ts:1543-1554`、`modals.ts:381-456` | 不同（弹窗形态） |
| 会话行内改名（点当前会话行） | `sessionsWebview.ts:2462-2473`、`2504-2566` | `rows.ts:1161-1182`、`tree.ts:353-437`；#121 起先问宿主「这条会话真的开在面板里吗」 | 现在更好（修掉了「点当前会话点不出对话区」） |
| 工作区重命名 | 无 | `rows.ts:465-473`、`tree.ts:1531-1542` | 现在更好（新增） |
| 新建会话（工作区行 ＋ / 菜单） | `sessionsWebview.ts:2340-2344` | `rows.ts:510-517`、`tree.ts:1366` | 一致 |
| 新建未分组会话 | 专用命令 `sessionNewUngrouped`：`sessionsWebview.ts:2341` | `startSession(undefined)`：`tree.ts:1366` | 一致（底层不同，行为同） |
| 打开会话（点行） | `sessionsWebview.ts:2465-2473` | `tree.ts:341-344`、`424-437`（打开 + 清未读 + 请宿主把面板亮到这条） | 现在更好 |
| 从列表移除工作区 | 宿主 modal 确认：`sessionsView.ts:1075-1092` | 面板内 `DeleteWorkspaceModal`：`tree.ts:1605-1610`、`modals.ts:459-503` | 不同（弹窗形态） |
| 复制引用 / 复制路径 / 复制文件夹引用 | 宿主剪贴板 + 宿主信息框：`sessionsView.ts:910-929`、`958-961` | 官方 `writeClipboard` + 面板内飘提示：`tree.ts:679-708`；文件夹引用走官方 grammar（`pure/fileReference.ts`） | 不同（回执位置；内容更稳） |
| 在终端打开 / 在新窗口打开文件夹 / 在 VS Code 打开 | `sessionsWebview.ts:2345-2357`、`3488-3504` | `rows.ts:518-541`、`447-455`、`tree.ts:711-720` | 一致 |
| 在新标签页打开会话 | 无 | `rows.ts:992-1006` | 现在更好（新增，#72 多开通道） |

## A8. 搜索与过滤

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 搜索框的形态 | 搜索框常显（不是点开才出现的放大镜胶囊）：`sessionsWebview.ts:519-558` | `toolbar.ts:196-252`（#132 起改回官方那套**两态**：平时一枚放大镜，点开才展开成输入框） | 不同（跟官方一样，用户点名要的；旧侧栏的常显形态已下线） |
| 输入去抖 | 200ms：`sessionsWebview.ts:540-545` | 250ms：`search.ts:3`、`tree.ts:474-482` | 不同（几乎不可感知） |
| 内容全文搜索（后端索引） | `sessionsStore.ts:1414-1440`（`session.search`，命中给 snippet） | `tree.ts:467-487`、`1161-1162`（官方 `sessions.search`，命中给 snippet） | 一致 |
| 命中片段显示位置 | 会话行**下方**独立一块：`sessionsWebview.ts:1392-1402`、`2572-2582` | 搜索结果行的**第二行**：`rows.ts:1394-1403` | 不同 |
| 命中的关键词高亮 | `sessionsWebview.ts:2588-2606`（标题 / 组名 / 片段三处包 `<mark class="dsh-mark">`，样式 `sessionsView.ts:569-575`） | **已补回（#152 照旧侧栏那一版补，#166 起每一处都标）**：`rows.ts` 的 `highlightMatches` 把标题 / 工作区名 / 片段三处里每一处命中词各包一个 `<mark class="dshOneTree_searchMark">`（大小写不敏感、重叠只算一处、相邻都标），样式见 `styles.ts` 的搜索高亮那一段；常驻判据是装配实验室的 F-49 | 一致（官方搜索结果本身没有高亮，是照旧侧栏这一版补的；标几处按 #166 的用户口径） |
| 搜索时的列表形态 | 仍是分组的树，只留下有命中的组与行：`pure/sessionTree.ts:254`、`sessionsWebview.ts:1229-1260` | 整块换成平铺的搜索结果行（官方 SearchResults 形态）：`tree.ts:1258-1288` | 不同 |
| 无命中 / 加载中 / 索引不可用文案 | `sessionsWebview.ts:1251-1275` | `tree.ts:1282-1288`（`search.pending` / `search.noMatches` / `search.unavailable`） | 一致 |
| 结果条数上限提示 | `sessionsWebview.ts:1261`（「换更精确的关键词」） | `tree.ts:1426-1436`（`search.hasMore`） | 一致 |
| 输入上限 500 + 清空按钮 | `sessionsWebview.ts:524`、`527-555` | `search.ts:4`、`toolbar.ts:237-250` | 一致 |
| 工作区分组过滤（单胶囊 + 菜单） | `sessionsWebview.ts:675-693`、`708-767` | `groupFilterBar.ts:35-132` | 一致（现值没有「当前选中项在菜单里置顶列出」这一条，改用勾选态表示） |
| 过滤计数 = 成员工作区数 | `sessionsWebview.ts:702` | `tree.ts:586-588`、`groupFilterBar.ts:58` | 一致 |
| 视图选项（按工作区 / 单列表、手动序 / 最近更新） | 无（旧侧栏只有按工作区一种，也没有排序选项） | 无（#131 起那一枚与它带出的单列表模式一起退役，两侧一致） | 一致（曾作为「现在更好」的一项，按用户要求去掉） |
| 手动刷新按钮 | 有（点一下转圈 + 禁用 450ms）：`sessionsWebview.ts:559-570` | 无（数据由官方会话服务推送） | 缺（用户少了一个手动刷新入口） |

## A9. 拖拽与排序

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 会话拖进标签组 / 拖到组外移出 | `sessionsWebview.ts:2016-2052`、`1571` | `tagGroups.ts:193-210`、`411-435`、`tree.ts:973-984` | 一致 |
| 拖 pill 换组序 | `sessionsWebview.ts:2059-2110` | `tagGroups.ts:289-318`、`tree.ts:987-994` | 一致 |
| 拖进组时的落点高亮 | `sessionsView.ts:629`（组色淡底） | `styles.ts:540`（组色淡底） | 一致 |
| 拖拽中的源行视觉 | 半透明：`sessionsView.ts:634`（会话行 `.45`）、`sessionsView.ts:229`（管理视图的组行 `.55`） | **#155 起按旧侧栏补**：会话行拖起来挂 `dshOneTree_dragging`（`.45`，`rows.ts` 的 `withDragGuard` 负责挂/摘），「管理分组…」里被拖的组行挂 `dshOneTree_manageRowDragging`（`.55`）；两条规则与理由写在 `styles.ts`（官方侧栏**没有**源行拖拽形态——只有落点插入线，实测见 F-50 的 ⑨） | 一致（官方无对应物时照旧侧栏补） |
| 工作区分组的拖拽排序 | 有（管理视图里拖组行，指针事件 + 抓手）：`sessionsWebview.ts:1107-1168`、`sessionsView.ts:983-989` | **#155 起有**：在「管理分组…」第一层，每行前面一枚抓手（旧侧栏那枚 6 点把手）→ `modals.ts` 的 `dropOnGroup` 算完整顺序 → 树层 `applyGroupReorder` → 纯层 `reorderGroups` 判定 → 仍走唯一那条 `writeGroups` 落盘 | 一致（载荷换成与 pill 拖拽同一套自定义 MIME `text/dsh-group`，落点判定与标记画法同款） |
| 排序口径 | 置顶最前（按置顶顺序）→ **活跃会话前置**（运行中 / 后代在跑 / 未读 / 待交互）→ 其余按最近更新：`pure/sessionTree.ts:337-380` | 置顶最前（置顶之间保持原顺序）→ 官方顺序（#131 起不再有「最近更新」那一档）：`tree.ts:520-523` | 不同（少了「活跃前置」这一层） |

## A10. 折叠与展开

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 单个工作区折叠 / 展开（点组头） | `sessionsWebview.ts:2366-2369` | `rows.ts:569`、`tree.ts:1359-1365` | 一致（差别只在空组也响应点击，见 A1） |
| 折叠全部 / 展开全部（图标随态翻转；搜索态恒按「折叠全部」显示） | `sessionsWebview.ts:510-514`、`571-575`、`604-611` | `tree.ts:573-581`、`toolbar.ts:259-275`（#118 同一口径） | 一致 |
| 标签组折叠 + 折叠态计数 | `sessionsWebview.ts:1988-2000` | `tagGroups.ts:323-372` | 一致 |
| 回收站抽屉里块的折叠（与主树折叠互不影响） | `sessionsStore.ts:1328-1335` | `pure/workspaceTreePrefs.ts:33-38`、`recycleDrawer.ts:294-308` | 一致 |
| 首次打开时的展开态 | 全部展开 | 只展开当前会话那一组 | 不同（同 A1，最显眼的一条） |

## A11. 键盘

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| Esc 关菜单 / 二级菜单 / 抽屉 / 弹窗 | `sessionsWebview.ts:213-221`、`2763-2769`、`2952-2959`、`3257-3263` | 官方 `Menu` / `Modal` 自己处理 Esc；抽屉 `recycleDrawer.ts:186-195` | 一致 |
| 改名输入框的 Enter 提交 / Esc 取消（IME 组合中的 Enter 不算提交） | `sessionsWebview.ts:2513-2526`、`2271-2276` | `rows.ts:944-983`（`compositionstart/end` + `isComposing` 两条判据） | 一致 |
| 搜索框按 Esc 清空 | 无 | 有：`toolbar.ts:232-235` | 现在更好（小） |
| 方向键在列表里上下走 | 都没有（旧侧栏也是鼠标为主） | 无 | 一致 |

## A12. 空态 / 加载 / 错误

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 加载中 | `sessionsWebview.ts:1218`、`1225`（「Loading…」） | `tree.ts:1425`（`empty.loading`） | 一致 |
| 零工作区 | `sessionsWebview.ts:1245-1249`（指向顶栏 ＋） | `tree.ts:1177`、`1440` | 一致 |
| 分组里没有成员 | `sessionsWebview.ts:1229-1236`（两句提示） | `tree.ts:1179-1192`、`1438`（多一枚「管理分组…」入口按钮） | 现在更好 |
| 搜索无命中 | `sessionsWebview.ts:1251-1259` | `tree.ts:1282-1288`（`search.noMatches`） | 一致 |
| 全文搜索降级提示（索引没开） | `sessionsWebview.ts:1263-1275` | `tree.ts:1283-1288`（`search.unavailable`） | 一致 |
| 「一条会话都没有」的通用空态 | 旧没有这一态 | `tree.ts:1439`（`empty.none`） | 现在更好（小） |
| dsh 未安装 / 启动中 / 服务未启动 | 面板内空态：`sessionsWebview.ts:1726-1751` + 一键安装脚本块（平台下拉 + 命令条 + 复制）：`1764-1816` | 宿主侧状态页：`src/ui/sidebarStatusPage.ts:26-51`（未安装 → 标题 + 说明 + 「查看安装指南」按钮；启动中 → 两行提示；未启动 → 说明 + 启动按钮）。安装脚本块现在住在**安装指南页**里：`src/pure/installGuidePage.ts:333`、`292-315` | 不同（空态从面板内挪到宿主侧状态页；平台下拉 + 一键命令挪进安装指南页） |
| 装配失败（服务在跑但页面装不起来） | 旧没有这一态（旧侧栏不走装配） | `src/pure/sidebarStatus.ts:55-58`、`sidebarStatusPage.ts:33-38`（提示 + 重试） | 现在更好 |

## A13. 其它

| 功能 | 旧：怎么做（`文件:行`） | 现：怎么做（`文件:行`） | 判断 |
| --- | --- | --- | --- |
| 悬停提示 | 自实现（webview 里原生 `title` 不显示）：`sessionsWebview.ts:352-414`、`sessionsView.ts:698-706` | 官方 `Tooltip` 组件 + 部分原生 `title`：`toolbar.ts:206-221`、`rows.ts:596` | 不同（机制） |
| 顶栏设置齿轮 | 无 | `toolbar.ts:309-326`（宿主有独立设置页时才渲染） | 现在更好（新增） |
| 主题与颜色 | 全用 VS Code 变量（`--vscode-*`）：`sessionsView.ts:34-37`、`441-444` | 全用官方 token（`--dsw-alias-*`）+ 主题映射（`sidebarLayoutPlugin.ts:374-384`）；标签色是 6 色字面值（`tagGroups.ts:58-65`，因为官方 token 里没有这一类） | 不同（来源切换） |
| 界面文案词典 | 扩展自带 l10n bundle 注入 webview：`sessionsWebview.ts:40` | 官方 locale 词典（键名沿用官方）：`workspaceTree/locale.ts` 全篇 | 不同（机制） |
| 读屏语义 | 行是普通 `div`，没有角色 | `role="treeitem"` + `aria-selected` / `aria-checked` / `aria-expanded` 等：`rows.ts:1140-1154`、`590` | 现在更好 |
| 浮层与模态 | 自实现 popover + 面板内 modal：`sessionsWebview.ts:262-350`、`155-205` | 官方 `Menu`（portal）与官方 `Modal` | 不同（机制） |

---

# B. 样式对照表

**现值一律给出档位表出处**：`workspaceTree/styles.ts` 的档位表（`SCALE_TIERS`，`styles.ts:112-192`；规则表头的说明在 `styles.ts:31-102`）与密度表（`sidebarLayoutPlugin.ts` 的 `DENSITY_PROFILE`，`sidebarLayoutPlugin.ts:120-195`，两列 `official` / `vscode`）。

表里「现值」一栏的写法：`密度键：official 值 / vscode 值`，后面跟消费它的 CSS 规则位置。

| 项 | 旧值（`文件:行`） | 现值（档位表键 / `文件:行`） | 差异 |
| --- | --- | --- | --- |
| 工作区行高 | 32px（`sessionsView.ts:390-394`） | `row-height`：34px / 34px（`sidebarLayoutPlugin.ts` 的密度表；消费点 `styles.ts` 的 `.dshOneTree_projectRow`） | 不同（30px→34px：行家族取官方侧栏原值，#134） |
| 会话行高 | 32px（`sessionsView.ts:433-437`） | `session-row-height`：32px / 32px（同上；消费点 `.dshOneTree_sessionRow`、`.dshOneTree_drawerRow`） | 一致（同为 32px 量级，#134 起这一项两边同值） |
| 行字号 | 12px（`sessionsView.ts:393`、`436`） | 标题 `title-font-size`：14px / 14px；元信息 `meta-font-size`：12px / 12px（消费点 `styles.ts` 的 `.dshOneTree_title` / `.dshOneTree_time`） | 不同（标题比旧值大一号：#123 起标题取官方标题档） |
| 文字行高 | 未显式声明（随 `--vscode-font-size`，约 1.4 倍） | 标题 `title-line-height`：20px / 20px；元信息 `meta-line-height`：20px / 18px（消费点同上） | 不同（现在显式取官方行高；元信息比官方原值紧一档） |
| 行圆角 | 会话行 4px（`sessionsView.ts:436`）；工作区行没有圆角（`390-394`） | `row-radius`：8px / 8px（消费点 `styles.ts` 的两条行规则与溢出按钮 / 搜索结果行 / 入口行主区 / 抽屉块头） | 不同（两个行种统一取官方原值；这也是唯一进密度表的圆角） |
| 行内边距 | 会话行 `0 6px 0 20px` + 外边距 `0 4px`（`sessionsView.ts:434`）；工作区行 `0 10px`（`391`） | `row-padding-inline`：8px / 8px（消费点 `styles.ts` 的行规则，同时是骨架件与行形件对齐的「行内容基准」）；行通栏出血，左内边距不再承担层级缩进 | 不同（行从「左右各留 4px + 左缩进 20px」改成通栏 + 官方 8px 内边距） |
| 行间距 | 列表容器 `padding: 2px 0`，**行与行之间没有间距**（`sessionsView.ts:81`） | `row-gap`：2px / 2px（`sidebarLayoutPlugin.ts:129`；消费点 `styles.ts:256`），行与行之间真的有 2px | **不同**（本文原先判「一致」，渲染实测推翻了它：旧侧栏那 2px 在列表容器上下、不在行与行之间，见 `legacy-vs-current-sidebar-render.md` 的 C-5） |
| 组间距 | **工作区块之间没有间距**，`margin: 4px 0 2px` 只出现在标签组块上（`sessionsView.ts:581`） | `group-gap`：4px / 4px（`sidebarLayoutPlugin.ts:134`；消费点 `styles.ts:258`、`347`、`441`），块与块之间真的有 4px | **不同**（同 C-5：原先判「一致」，实测推翻） |
| 分节头下边距 | 顶栏 / 分组栏 / 选择条的 1px 分隔线（`sessionsView.ts:44-47`、`92-95`、`84-87`） | `section-header-gap`：4px / 4px（`sidebarLayoutPlugin.ts:142`；消费点 `styles.ts:236`）；没有分隔线 | 不同（分隔线换成留白） |
| 行内图标位 | 工作区文件夹 / 折叠三角 16×16（`sessionsView.ts:397-401`）；图钉 14×14（`447-452`） | `.dshOneTree_slot` 16×20（`styles.ts:298`，档位表记名 `styles.ts:145-146`）；图钉 14px（`styles.ts:417`） | **不同**（原先判「一致」，渲染实测推翻了它：旧 16×16、现 16×20，高度差 4px，见 `legacy-vs-current-sidebar-render.md` 的 C-6）；图钉 14px 两侧同值 |
| 行内动作按钮 | 20×20、圆角 3px（`sessionsView.ts:496-500`） | `.dshOneTree_rowIconButton` 16×16、圆角 4px（`styles.ts:318`；档位表记名 `styles.ts:147-148`） | 不同（按钮变小 4px） |
| 状态点尺寸 | 绿 / 黄点 6px（`sessionsView.ts:464-466`）；运行中自绘 10px 像素环（`sessionsView.ts:453-461`；画法由共享模块承担，见 `sessionsWebview.ts:476-482`） | 官方 `StateDot`，默认 10px（出处是官方 primitives 包的 `StateDot.d.ts`；`rows.ts:211` 未传 size） | 不同（6px → 10px） |
| 分组过滤胶囊尺寸 | 高约 23px（`padding: 3px 9px 3px 8px` + 12px 字，无显式行高）：`sessionsView.ts:96-103`；计数角标 11px / 16px 行高 / 圆角 999px（`116-120`） | `pill-height`：28px / 26px、`pill-font-size`：13px / 12px、`pill-padding-start`：8px / 7px、`pill-padding-end`：4px / 2px（`sidebarLayoutPlugin.ts:176-179`；消费点 `styles.ts:353`）；圆角 999px 取容器档（`styles.ts:188`） | 不同（高度显式化，两侧都比旧值高） |
| 工作区行「宿主」小胶囊 | 10px 字、`padding: 0 7px`、圆角 999px（`sessionsView.ts:422-427`） | `.dshOneTree_workspaceBadge` 16px 高 / 圆角 10px / 11px 字 / 内边距 `0 4px`（`styles.ts` 的规则上方逐项写了取的哪一档：高取标准档行内图标按钮的 16px、圆角取容器档小胶囊、字号取标准档小胶囊、内边距取标准档胶囊触发器；#138 从 20px 高收紧一档） | 不同（旧是自定值，现取官方同形件的档） |
| 抽屉尺寸 | 默认 50%、上拉 90%（`sessionsWebview.ts:2612-2613`）；提手 16px 高、把手 36×4 / 圆角 2px（`sessionsView.ts:314-322`） | 默认 50% / 90%（`recycleDrawer.ts:42-43`、`238`）；提手 12px、把手 32×3 / 圆角 2px（`styles.ts:462-464`）；过渡时长与缓动取官方 token（`styles.ts:453`） | 不同（提手与把手都缩小一档） |
| 回收站入口行 | 行高由 `padding: 7px 4px 7px 14px` + 12px 字撑出（`sessionsView.ts:334-339`）；行内图标按钮 26×26（`341`）；行盒吃满宽度、标签吃满余量（`344`） | **#137 起整套按旧侧栏规格取定值**（不再走密度档）：行盒吃满宽度、右侧 8px，主区 `7px 4px 7px <行内容基准>`，计数胶囊 10px/16px 行高/圆角 8px/内边距 `0 5px`，动作按钮 26×26（`styles.ts:394-418`）；行高由内边距 + 标题档行高撑出 34px；`footer-row-height` 密度键随本条退场（`sidebarLayoutPlugin.ts:200-205`） | 基本一致（两处刻意不同：左内边距走 #125 的行内容基准、按钮形状仍是官方圆形） |
| 空态字号与内边距 | 主行 12px、次要行 11px、内边距 `20px 12px`（`sessionsView.ts:503-508`） | `.dshOneTree_empty` 13px、内边距 `16px 12px`（`styles.ts:261`，取官方 `empty` 那一条的同值） | 不同 |
| 菜单项几何 | 最小高 30px、圆角 8px、内边距 `4px 10px`、行内间隙 8px、字号 12px、图标位 14×14（`sessionsView.ts:654-670`）；弹层 `min-width: 180px`、圆角 12px、内边距 4px（`644-653`） | 官方 `Menu` 的 **compact 档**：项高 26px / 圆角 5px / 间隙 6px / 内边距 `3px 7px` / 字号 12px / 行高 18px / 图标位 14×14；列表 `min-width: 164px` / 圆角 7px / 内边距 2px（`styles.ts:114-132`）。所有菜单都传 `compact: true`（如 `rows.ts:1285`、`toolbar.ts:80`、`tagGroups.ts:390`） | 不同（整套收紧：30→26px、8→5px、10→7px） |
| 选择态动作条 | `padding: 6px 8px` + 1px 下边线；按钮 `padding: 3px 10px` / 12px 字（`sessionsView.ts:84-88`） | 通栏横带：上下 .5px 发丝线 + 官方悬停底色，纵向走 `group-gap`（4px）、横向走 `row-padding-inline`（`styles.ts:441-446`）；按钮是官方 `Button` 的 `sm` 档 28px（`selection.ts:119-143`，档位表记名 `styles.ts:93-98`） | 不同（无描边框，改成横带 + 官方按钮） |
| 骨架窗口件（顶栏图标按钮 / 搜索框） | 图标按钮 24×24、圆角 4px（`sessionsView.ts:70-74`）；搜索框 `padding: 3px 22px 3px 6px`、圆角 4px、12px 字（`53-57`） | `icon-button-size`：28px / 26px；`search-height`：28px / 26px（折叠态那枚圆放大镜）；`search-expanded-height`：30px / 26px；搜索圆角 10px、字号 13px（`sidebarLayoutPlugin.ts:153-158`；消费点 `styles.ts:234`、`243-250`） | 不同（整套换成官方那套两态的几何） |
| 标签组（pill / 竖线 / 组内缩进） | pill 高 16px、圆角 4px、10px 粗体字；组头高 22px；竖线 `left: 16px; top: 19px; bottom: 2px; width: 2px`；组内行缩进 24px（`sessionsView.ts:584-627`） | 同一组值逐字沿用（`styles.ts:507-538`），并在档位表里登记为例外（`styles.ts:202-208`，理由：官方没有「标签组」这个形态，量不出档） | 一致（#122 已把竖线与缩进改回旧规格） |
| 颜色 token 的取法 | 全用 VS Code 变量（`--vscode-foreground` / `--vscode-list-hoverBackground` / `--vscode-charts-*` 等）：`sessionsView.ts:34-37`、`441-444`、`594-599` | 全用官方 token（`--dsw-alias-*`）：`styles.ts` 全篇；标签色是 6 个色值字面量（`tagGroups.ts:58-65`，官方 token 里没有标签色板这一类） | 不同（颜色来源从 VS Code 主题换成官方 token，随两端一致） |
| 字体族与基准字号 | `var(--vscode-font-family)` / `var(--vscode-font-size)`（`sessionsView.ts:34-37`） | 树不声明字形（`styles.ts` 无 `font-family`），继承官方侧栏壳给的字体 | 不同（**未核实**官方壳给的具体字体族与基准字号：官方 css 不在本仓库） |
| 悬停提示外观 | 自绘：`font-size: 11px`、`padding: 3px 8px`、圆角 6px（`sessionsView.ts:698-706`） | 官方 `Tooltip` 组件自带外观（`toolbar.ts:206-221`） | 不同（机制） |

---

# C. 结论

## C1. 剩余差异清单（按用户能感知的程度排序）

前面数字是这份清单的编号，方便逐条挑。

1. **首次打开时的展开态**：旧侧栏打开时所有工作区都是展开的，现在只有当前会话所在的那一个自动展开，其余全折叠（`pure/workspaceTreePrefs.ts` 的 `groupExpansion` 空记录 + `autoExpandGroup`）。这是进入侧栏第一眼就能看到的差别。→ **保持现状（#151 定了口径：跟官方一致）**：官方 `WorkspaceBrowser` 的展开记录初值是空的、只在没碰过当前组时展开它，所以「旧侧栏全展开」不是官方行为，没照旧改。常驻判据 = 装配实验室的 F-51。
2. **会话行状态点的位置与大小**：旧的在行尾、固定 16px 槽、和相对时间互斥（有标记就不显示时间）；现在的在行首（`styles.ts:298`），点从 6px 变成官方 `StateDot` 的 10px，而且和相对时间同时显示（`rows.ts:1224-1230`）。→ **建议用户拍板**：位置跟官方（现状）还是跟旧侧栏（行尾互斥）。
3. **搜索命中的关键词高亮**（原记「现在没有任何高亮」）：旧侧栏在标题、工作区名、命中片段三处把关键词包成 `<mark>` 加粗变色（`sessionsWebview.ts:2588-2606`、`sessionsView.ts:569-575`）。→ **已改（#152；标几处见 #166）**：现在三处里每一处命中词都包成 `<mark class="dshOneTree_searchMark">`，样式取官方业务色、无底色；官方搜索结果本身没有高亮（0.1.6-alpha.1 实测），所以这是照旧侧栏那一版补的，常驻判据是装配实验室的 F-49。
4. **搜索时的列表形态**：旧的是「仍是分组树，只留下有命中的组」，现在是「整块换成平铺的结果行」（`tree.ts:1258-1288`，官方 SearchResults 的形态）。→ **保持现状**（这是对齐官方 web 的结果，也是 #98 的方向）；如果用户更习惯旧形态，可以另立条目。
5. **手动刷新按钮没了**：旧顶栏有刷新（点击转圈 + 禁用 450ms，`sessionsWebview.ts:559-570`）；现在数据靠官方会话服务推送，没有任何手动刷新入口。→ **建议用户拍板**（正常推送下不需要；但用户想「强制拉一次」时没有入口）。
6. **dsh 未安装 / 服务未启动的空态换了位置**：旧的在侧栏面板里（`sessionsWebview.ts:1726-1751`），现在是宿主侧的状态页（`sidebarStatusPage.ts:26-51`）；旧面板里那块「一键安装脚本」（平台下拉 + 命令条 + 复制）现在搬到安装指南页（`src/pure/installGuidePage.ts:333`、`292-315`）。→ **保持现状**（未安装时网关起不来，装配页组装不了，状态页必须在宿主侧渲染，理由写在 `sidebarStatus.ts:1-12`）。
7. **整套菜单与行的密度收紧了**：菜单项 30px → 官方 compact 档 26px、圆角 8px → 5px、行内边距 10px → 7px；行家族（工作区行 / 会话行 / 抽屉会话行 / 搜索结果行）取官方侧栏原值——工作区行 34px、会话行 32px、圆角 8px、行内边距 8px、标题 14px/20px（#134 用户拍板：行参考官方侧栏自己的尺寸）。→ **保持现状**（这是 #113 定下、#134 收口的口径：要么官方标准档、要么官方紧凑档，不再有自造中间值；菜单一侧仍取紧凑档）。
8. **重命名 / 删除的弹窗形态**：会话改名、工作区改名、标签组改名、删除工作区、删除标签组，旧的走 VS Code 原生 `showInputBox` / `showWarningMessage`，现在全在面板内用官方 Modal（`modals.ts` 全篇）。→ **保持现状**（可移植与两端一致的要求；如果用户更认原生框，可另立条目）。
9. **工作区行的计数少了「未读」一项**：旧的是三项（待交互 / 运行中 / 未读，`sessionsWebview.ts:1839-1855`），装配版起初只有运行中与等待交互两项，跟在标题文字之后（`rows.ts` 的 `ProjectRow` / `ActivityBadge`）。→ **已改（#153）**：第三项补回来了，三枚逐项同形（同一枚官方 `StateDot`、同一档字号与间隙、同一个容器），桶与互斥优先级按旧的那一版（每个会话只进一个桶：待交互 > 运行中 > 未读），未读判定吃客户端那份手动未读集合（不是官方「跑完还没被打开」的提醒），位置仍在工作区标题文字之后（#138）。常驻判据 = 装配实验室的 F-52。
10. **回收站的抽屉头与行**：旧的抽屉头有「‹ 返回 / 清空 / 恢复全部」三样，装配版起初只有标题 + 计数 + ✕，清空与全部还原只剩底部入口行那两枚；旧的行的菜单由 ⋯ 按钮或右键打开，起初按钮常显、右键入口没了；旧的回收站行有状态点与图钉，起初两样都没有。→ **已改（#154）**：抽屉头三样补齐（返回接手 ✕ 的位置与标记，清空与恢复全部沿用入口行那两枚同一形态、同一能力口）；行的右键菜单回来（与行尾两枚动作同一份项）；行上补状态点与图钉（与主树同一枚组件、同一口径）。常驻判据 = 装配实验室的 F-53。
11. **标签组 pill 的菜单**：旧的右键 pill 打开（`sessionsWebview.ts:2002-2010`），现在是组头右侧的 ⋯ 按钮（`tagGroups.ts:262-276`）；旧的「颜色」是二级子菜单（`2189-2224`），现在是同一菜单里的一节。→ **建议用户拍板**（颜色那一节现在一眼能看全，但右键盘多了一个按钮）。
12. **排序少了「活跃会话前置」这一层**：旧的在每个工作区里先把运行中 / 有后代在跑 / 未读 / 待交互的会话提到前面（`pure/sessionTree.ts:337-380`），现在只有「置顶最前」，其余保持官方顺序（#131 起不再有「最近更新」那一档，`tree.ts:520-523`）。另外旧置顶项之间按置顶的先后排，现在按官方顺序排。→ **建议用户拍板**（旧行为更利于「先看有事要处理的」）。
13. **空工作区也能展开**：旧的空组 hover 不换成折叠三角、点击没反应（`sessionsWebview.ts:2366-2369`），现在照样能展开收起（展开后仍是空的）。→ **保持现状（#151 定了口径：跟官方一致）**：官方空工作区行同样能收能展，F-51 的 ③ 把「悬停显形、`aria-expanded` 翻转、展开后仍零会话行、重载后态不丢」逐条钉住。
14. **工作区分组的拖拽排序**（原「不能再拖拽排序」）：旧的管理视图里可以拖动组行改顺序（`sessionsWebview.ts:1107-1168`），装配树原先没有这个入口。→ **已改（#155）**：「管理分组…」第一层的每行前面有一枚抓手（旧侧栏那枚 6 点把手），拖到另一行的上/下半即插到它前/后（落点判定与标记画法与同页 pill 拖拽同一套，载荷是自定义 MIME `text/dsh-group`），松手即生效；顺序判定用纯层 `reorderGroups`，落盘仍只有 `writeGroups` 一条，拖回原位不产生写入。
15. **给工作区打标的入口位置变了**：旧的在「管理分组…」视图里勾选工作区（`sessionsWebview.ts:1071-1106`），现在在工作区行的右键菜单「分组…」里勾（`rows.ts:426-432`）；现在的「管理分组…」只列组、能建 / 改名 / 删除（`modals.ts:514-618`）。→ **保持现状**（同名功能的入口从一处挪到另一处，功能没丢），但若用户习惯在管理视图里打标，可以补。
16. **内置标签组（待办 / 进行中 / 已完成）**：旧侧栏每个工作区都预置这三组（`pure/sessionTags.ts` 的 `PRESET_TAGS`）。#98/#107 一度在迁入时丢弃它们，→ **已改（#213，2026-09-19，用户要求「加回来」）**：装配侧栏照旧侧栏那套恢复三个预设组——**恒存在**（任何工作区桶里都能看到，不靠该工作区存过标签桶；渲染用的视图桶由 `pure/sessionTagGroups.ts` 的 `withPresetTagGroups` 恒补，持久数据里不预写）、**不可删、不可改名**（菜单里不出现这两项，动作层 `deleteTagGroup` / `updateTagGroup` 再拒一道）、**颜色可改**（照旧侧栏 `setTagColor` 对预设组没有门槛）、**名字走 l10n**（`PRESET_TAG_L10N` 的三条键，名字不落数据）；旧文件里 `preset-*` 的定义与归属迁入时照常收下（原先归在这三组里的会话重新显示在组里）。常驻断言 = `npm run verify:lab` 的 F-64（另见 F-16 的迁入那一档）。
17. **拖动会话时源行半透明**：旧的有 `.dragging { opacity: .45 }`（`sessionsView.ts:634`），装配树原先拖拽过程中源行没有任何变化（目标组的高亮还在）。→ **已改（#155）**：拖起来的会话行按旧侧栏那一份值压淡、松手恢复；这条是「官方优先、官方没有才照旧侧栏补」的落地——官方侧栏拖动时源行没有任何形态（只有落点插入线），实测见装配实验室的 F-50。
18. **「分组…」二级菜单的展开方式**：「分组…」旧的是 hover 在右侧弹一层、没有分组时给一行灰字说明，现在是就地展开在菜单内、没有分组时整项不出现（`rows.ts:426-432`）。→ **保持现状**（窄侧栏里就地展开更好点，注释里写了理由）。
19. **分叉会话的禁用判据更粗**：旧的按「这条会话有没有完成的轮次」判（`sessionsWebview.ts:3342-3354`），现在只能按「是不是空白会话」判（`rows.ts:1061-1077`，会话快照里没有前者那个事实）。→ **保持现状**（待官方快照带上该字段再收细）。
20. **「当前工作区」的判据换了**：旧的按「当前会话」判，现在按「VS Code 当前打开的文件夹」判（#112，`pure/workspaceTreeView.ts:283-306`）。→ **保持现状**（这是用户报的 bug 的修法：以前点哪条会话哪组就跳到最前）。
21. **悬停卡在 VS Code 侧栏里不出现**：官方 `HoverCard` 固定 244px 宽、定位在锚点右侧，VS Code 侧栏宽度不够，所以按判据抑制（`hoverCard.ts:31-56`；官方 web 上正常）。→ **保持现状**（取舍写在那个文件头：宁可不显示，也不让它压住树）。
22. **搜索去抖 200ms → 250ms**（`search.ts:3`）。→ **保持现状**（用户基本感知不到）。
23. **回收站行菜单少了「会话: X」标题行**（`sessionsWebview.ts:2868` → `recycleDrawer.ts:417-444`）。→ **保持现状**（回收站行空间紧，标题行收益低）。

## C2. 已经一致或更好的部分（可以放心）

**一致**（行为与观感都对上了）：

- 会话行结构、工作区行 hover 的四枚动作。（工作区分组的**顺序**不一致：旧侧栏当前文件夹优先、其余按 `updatedAt` 降序，见 A1 第一行与 `legacy-vs-current-sidebar-render.md` 的 C-1。）
- 状态优先级（待交互 > 运行中 / 后代在跑 > 未读 / 完成）、未读的绿点与加粗标题。
- 置顶图钉、标签组的形态（pill + 贯穿竖线 + 组内缩进，逐字沿用旧值）、标签组折叠计数。
- 拖会话入组 / 拖出、拖 pill 换组序（连自定义 MIME 名字 `text/dsh-session` / `text/dsh-tag` 都一样）、拖组行换分组顺序（#155 补，载荷 `text/dsh-group`）。
- 回收站入口行的形态与「计数 0 灰态 + 两枚禁用」、抽屉的滑出 / 半高 / 上拉 90% / 点提手收起 / 点外面收起 / Esc、按工作区分块与块内倒序、归档前一律确认。
- 「折叠全部 / 展开全部」的图标翻转与「搜索态恒按折叠全部显示」这条口径。
- 键盘语义（Esc 关浮层、改名输入框的 Enter / Esc、IME 组合中的 Enter 不算提交）。
- 搜索的输入上限 500、清空按钮、无命中 / 加载中 / 索引不可用的文案、命中的关键词高亮（三处每一处都标，`<mark>` + 官方业务色、无底色；#152 补、#166 定「每处都标」）。
- 分组过滤胶囊（单胶囊 + 计数 + ▾ + 下拉里「全部 / 各组 / 新建分组… / 管理分组…」）、过滤计数 = 成员工作区数。
- 空态（加载中、零工作区、分组无成员、搜索无命中）、会话行内改名、各处的资格判定（能不能勾、能不能移进回收站、能不能归档）。
- 工作区行尾的三项活状态计数（待交互 / 运行中 / 未读，同一枚官方 `StateDot` + 数字；#153 补回第三项）、回收站抽屉的头三样与行上的状态点 / 图钉 / 右键菜单（#154 补齐）。

**现在更好**（新增或修好的）：

- 顶栏多了：设置齿轮、多选入口（视图选项那一枚已于 #131 退役）；搜索栏是官方那套两态（#132 起：平时一枚放大镜，点开才展开成输入框，Esc / 清除收起并清空）。
- 会话行菜单多了「在新标签页打开」；工作区行菜单多了「重命名工作区」；未分组桶也能开菜单。
- 会话行点击补了「先问宿主这条会话是否真的开在面板里」这一步，修掉了「点当前会话点不出对话区」（#121）。
- 回收站：入口行主区改成开 / 合切换、回收站行多了常驻「还原」按钮与危险色的「永久归档」、动作失败有飘提示。
- 活跃定时任务标记（闹钟）按官方能力渲染出来了；官方 `HoverCard` 悬停卡在官方 web 上可用。
- 装配失败有自己的状态页与重试按钮（旧侧栏没有这一态）。
- 读屏语义（`role="treeitem"` + `aria-*`）成套补上。

---

# D. 纪律与说明

## D1. 证据规则

- 每条判断都写了 `文件:行`。写「缺」的条目都用搜索确认过在装配侧零命中（例：刷新按钮 `grep -rn refresh packages/dsh-workspace-tree/src/workspaceTree/` 零命中；命中的只有回收站那两枚「还原 / 永久归档」按钮用的 `IconRefreshOutline16`）。本文写作之后补回来的条目（搜索高亮 #152 等）已在原位改标为「已改」，不再算「缺」。
- **未核实的条目**（已在原位标注）：
  - 官方侧栏壳给内容区的**字体族与基准字号**：官方 css 不在本仓库，只能确认树自己没声明。
  - 官方 `StateDot` 的 10px 取自官方 primitives 包的 `StateDot.d.ts`（`size` 的默认值），不是本仓库的源码断言。
- 行号都指向本文写作时的当次工作区代码（`develop/cordis-chat`，`d31fbdc`）——旧侧栏那几个文件此后也被动过（例如 #22 删过一批未使用符号），所以两侧的行号都可能与当前 `main` 对不上，看文首的说明。

## D2. 旧侧栏已退役的工程手段（机制不同，不构成功能缺口）

这些小节的共同点是：**旧侧栏必须自己做、现在由官方件或 React 代劳**，所以读者不会在界面上看到差别，只有实现换了。

| 旧侧栏的手段 | 旧侧栏为什么需要它（`文件:行`） | 现在的做法 |
| --- | --- | --- |
| 列表保活对账（自己写 diff，按内容签名决定复用哪个 DOM 节点） | `sessionsWebview.ts:143-150`、`1332-1693`：整个列表由一层手写 reconcile 重建，重建会销毁节点，所以必须自己算签名 | React 渲染，重绘由框架处理（`workspaceTree/rows.ts`、`tree.ts`）。编辑态与草稿因此从行里搬到树层持有，免得重绘把它丢掉（`tree.ts:140-153`） |
| 菜单打开期间冻结整表重建 | `sessionsWebview.ts:188-195`、`1194-1196`：菜单锚在行上，重建会连锚一起销毁 | 菜单是官方 `Menu` 的 portal 浮层，重绘不影响它（`rows.ts:1242-1295`） |
| 拖拽期间冻结整表重建 | `sessionsWebview.ts:2492-2498`、`2016-2052` | 拖拽由 React 属性承担（`tagGroups.ts:178-186`、`193-210`），不需要冻结 |
| IME 守护（组合期间不许重建列表） | `sessionsWebview.ts:3600-3602` 与 `renderSessions` 里的冻结分支 | 换成「重绘后把焦点与选区还给输入框」：`rows.ts:897-936`、`tree.ts:148-153` |
| 自实现 tooltip（webview 里原生 `title` 不显示） | `sessionsWebview.ts:352-414`、`sessionsView.ts:698-706` | 官方 `Tooltip` 组件（`toolbar.ts:206-221`）；少量位置仍用原生 `title` |
| 自实现 popover 与二级弹层（定位、点外面关、Esc 关） | `sessionsWebview.ts:262-350` | 官方 `Menu`（`portal` + `closeOnPointerLeave`），二级项改成就地展开 |
| 回收站的「视图切换」状态机（`recycleView` + 整块重建列表） | `sessionsWebview.ts:169`、`1656-1692`、`2661-2691` | 抽屉是自有渲染 + 一份模块级开合态（`recycleDrawerStore.ts`），入口行与树主组件读同一份（#114） |
| 宿主 push 快照 + webview post 的双向消息 | `sessionsView.ts:795-808`、`810-1054`（几十个 `case`） | 改成订阅官方服务（`workspaceTree/tree.ts` 里的一组 `use*`），状态持久化走宿主能力口（`stateRead/stateWrite`，键名与旧文件名逐字相同：`groups` / `pinned` / `unread` / `tags` / `recycle-bin`，见 `pure/sessionMarks.ts:26-29`、`pure/treeGroups.ts:36-37`、`pure/sessionTagGroups.ts:45`、`recycleBinStore.ts:39`） |
| 状态存在 VS Code 的 Memento / globalState | `sessionsStore.ts:103-121`（`sessions.collapsed` / `sessions.unread` 等键） | 用户可感知的持久状态住宿主能力口、落 `~/.dsh/dsh-one/`；纯视图态走客户端存储（`pure/workspaceTreePrefs.ts:1-13`），这是 AGENTS.md 的铁律「插件状态按官方惯例存储」 |

（说明：这些改动带来的**功能**差异都已经写进 A 表与 C1，这一节只解释「为什么实现看起来完全换了」。）
