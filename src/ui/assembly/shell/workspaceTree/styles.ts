/**
 * 侧栏树的全部样式（自有类名前缀 `dshOneTree_`，数值逐字取自官方 css-module、
 * 颜色只用官方 token；密度/间距项写成 `var(--dsh-one-density-<项>, <官方原值>)`
 * ——没人给偏好时取官方原值，宿主给了就更紧凑，本件不判断宿主）。分节注释沿用
 * 搬运前的说明。
 */

// ---------------------------------------------------------------------------
// 样式：数值逐字取自官方 css-module（Rows.module.css / WorkspaceBrowser.module.css，
// 骨架四区的几件另见对应规则上方的出处注；#104），
// 颜色只用官方 token 变量；类名前缀 dshOneTree_ 是本插件自有命名空间。
//
// ## 密度偏好（#85 A 项，键面 #104 扩到骨架四区）：消费 shell 给的 CSS 变量，缺省即官方档
// 几何/间距项（行高、行间空隙、分组空隙、行内边距、分节头高、字号、列表底部
// 留白、图标按钮/搜索胶囊尺寸，以及 #104 扩出来的顶栏行内边距与行内间隙、
// 分组胶囊的高/字号/内边距、回收站入口行行高、抽屉块头高）写成
// `var(--dsh-one-density-<项>, <官方原值>)`：
// - **本插件不判断宿主**：没人给偏好时取官方字面量（官方 web 侧原样），宿主
//   （我们的 VS Code 侧栏外框 @dsh-one/vscode-sidebar-shell）在容器上设这组
//   变量时自动变紧凑——本件据此保持可移植（AGENTS.md 铁律「能移植的必须移植」）。
// - 变量是**可选输入**、不是契约：官方 web 无人设 → 走兜底；任何宿主都可以只
//   设其中几项（未设的项独立回落官方值）。
// - 观感语言（图标/颜色/字体族/动效曲线）**不在这组变量里**：那些继续
//   逐字沿用官方，这里只调密度（issue #85 / #104 的范围）。**唯一的例外是行圆角**
//   （#113）：它在两个真实档位之间有不同的取值（标准档 8px / 紧凑档 5px），
//   所以跟着这套变量下发（`--dsh-one-density-row-radius`）。
// - 变量名与官方原值两栏一一对应，改动时两边同步（test/assemblyShellContract.test.ts
//   有两条契约测试守着「shell 设的键集 = 树消费的键集」与「新键各挂各的规则」）。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 官方档位表（#113）：侧栏里每一处几何（高度 / 圆角 / 字号 / 图标位 / 间距）都从下面三
// 档里取，**不自造中间值**——新增控件按表取档，并在它的规则上方写明取了哪一档。
//
// 出处写法：官方 css-module 的类名是「哈希前缀 + 稳定后缀」，这里写**后缀**（前缀随官方
// 构建变，按后缀搜），版本 0.1.6-alpha.1。
//
// ## 紧凑档（compact）—— 官方 primitives `Menu` 的 compact 变体
// 官方 web 前端的 Menu css-module（`dsh-web-frontend/dist/assets/index-J8NrHpw_.css`，
// 模块前缀 `1nxmc`）逐条是：
//   列表（含子菜单）`._list_1nxmc_8._compactList_1nxmc_128{min-width:164px;padding:2px;border-radius:7px}`
//   项        `._compactList_1nxmc_128 ._item_1nxmc_92{min-height:26px;gap:6px;padding:3px 7px;border-radius:5px;font-size:12px;line-height:18px}`
//   项内图标  `._compactList_1nxmc_128 ._itemIcon_1nxmc_144{width:14px;height:14px}`
//   分隔线    `._compactList_1nxmc_128 ._separator_1nxmc_82{margin:2px}`
//   分组标题  `._compactList_1nxmc_128 ._label_1nxmc_124{padding:4px 7px;font-size:11px;line-height:16px}`
// —— 属「官方支持但官方未用」的变体（48 个官方 bundle 的 Menu 调用点无一传 compact，
// 举证与实测数值见 shell/contextMenuPlugin.ts 文件头）。**本插件的行 / 胶囊 / 抽屉行 /
// 菜单整体取这一档**：用户要的「侧栏与右键菜单风格一致」就是这件事。
//
// ## 标准档（standard）—— 官方侧栏自己的原值（= 密度表的 official 列）
// 官方 ui-workspace 的 `Rows.module.css`（前缀 `YDXeBa`）与 `WorkspaceBrowser.module.css`
// （前缀 `bhn1Oq`）是主源；骨架四区的几件另有同族出处——分组胶囊与分块块头取
// ui-model-selection 的 `ModelSelection.module.css`（前缀 `_7KE1Ra`），回收站入口行取
// ui-cordis 的 `CordisPanel.module.css`（前缀 `Nqubda`）。每个键的出处逐条写在
// sidebarFramePlugin.ts 的密度表对应项上方，此处不重复。**没人给偏好时就用这一档**，
// 所以它不另抄一份值表；「shell 的 official 列 = 树侧兜底字面量」由
// test/assemblyShellContract.test.ts 守着。
//
// ## 容器档（container）—— 官方容器类的圆角与容器内留白
//   列表类容器圆角 7px：官方紧凑档的列表 `._list_1nxmc_8._compactList_1nxmc_128{border-radius:7px}`
//     （官方 ui-cordis 的 `.Nqubda_versionPicker select{height:26px;border-radius:7px}` 同值，
//     那一处还顺带印证了 26px 这个行高档）
//   卡片类容器圆角 12px：官方 ui-tool 的 `.fsXYAq_card{border-radius:12px}`、
//     ui-skill 的 `.iWrAna_instructionsCard{border-radius:12px}`、
//     ui-agent-preset 的 `.rtSEdW_cardMain{border-radius:12px 12px 0 0}`
//   胶囊类 999px：官方 ui-cordis 的 `.Nqubda_transitionActions button{border:.5px solid
//     var(--dsw-alias-border-l3);border-radius:999px;padding:2px 8px}`（官方 capsule 家族都是
//     999px；官方 pill 原件 `._pill_e3ygd_1{height:24px;border-radius:12px}` 在 24px 高下与
//     999px 同形）
//   圆形 50%：官方 ui-workspace 的 `.bhn1Oq_iconButton{border-radius:50%}`
//   小状态胶囊：官方 ui-cordis 的 `.Nqubda_rowStatus{height:20px;border-radius:10px;
//     padding:0 6px;font-size:11px;line-height:20px}`
//   容器底部留白 12px：官方 ui-cordis 的 `.Nqubda_body{padding:0 12px 12px}`（滚动列表容器）
//
// ## 官方变体（variant）—— 官方 primitives `Button` 的 `sm` 档
// 这一档不属于上面三档（紧凑档是官方 Menu 的项、标准档是官方侧栏自己的原值、容器档是容器
// 类的圆角与留白），而是**官方同一个控件自己的尺寸档**。出处是官方 primitives 的 Button
// css-module（`dsh-web-frontend/dist/assets/index-J8NrHpw_.css`，模块前缀 `cfgyt`，版本
// 0.1.6-alpha.1），逐条是：
//   基类   `._button_cfgyt_4{…border-radius:18px;font-size:14px;line-height:22px;padding:0 14px}`
//   默认档 `._md_cfgyt_24{height:36px}`
//   小档   `._sm_cfgyt_30{height:28px;font-size:12px;line-height:18px;padding:0 10px;border-radius:14px}`
// **用官方变体、不自己搓**：写 `<Button size="sm">` 官方件自己就带这一档（#120 实测、#127 落到
// 弹窗与选择态动作条）。它单独一组、不并进标准档：标准档那一列是**官方侧栏自己的原值**（也是
// 密度表的 official 列），而这是官方另一个控件自己的尺寸档。
//
// ## 哪个控件取哪档（新增控件照此判定）
// - **行家族**（工作区行 / 会话行 / 抽屉会话行 / 搜索结果行，外加列表里「还有 N 个会话」
//   那一行溢出按钮）→ **标准档**（#134 用户拍板：侧栏里的行参考官方侧栏自己的尺寸）：
//   高度 / 圆角 / 行内边距 / 图标位 / 文字字号与行高整套取官方侧栏的原值——工作区行 34px、
//   会话行 32px、行圆角 8px、行内边距 8px、标题 14px/20px、行内图标位 16×20 与图标按钮
//   16×16 / 圆角 4px。**#113 定的「行家族与菜单同档」作废**，**菜单仍取官方紧凑档**
//   （官方 `Menu` 的 `compact` 变体：项 26px / 字号 12px / 行高 18px / 圆角 5px /
//   内边距 3px 7px）——两条口径各管各的，行不再跟菜单走。
//   行里的元信息（时间 / 计数）仍取紧凑档的 12px / 18px（#123 的口径，本次没动）。
// - **不跟行家族的其余行形件**（#134 用户只点了侧栏的行，这些不动）：空态入口按钮
//   （自绘件，仍取紧凑档 26px）。**弹窗里的行同样不跟**（管理分组对话框的行固定 26px，
//   理由写在那条规则上方）。这几条在断言里逐条登记为「仍落紧凑档」，不是把口径放宽。
// - **回收站入口行**（`.dshOneTree_footer*`，#137）→ **不进档位表**：用户点名的参照物是
//   旧侧栏插件里的同一行，所以它的几何整套按那份旧规格取定值（行盒吃满宽度、右侧 8px、
//   主区 7px 纵向内边距、计数胶囊、26×26 的动作按钮……），逐条对应与两处刻意不同（左内边距
//   走行内容基准、计数胶囊的档位豁免）写在它那几条规则上方。这一行因此**退出密度档**。
// - **胶囊**（分组过滤条）→ **紧凑档**的高度与字号（与菜单项同高），圆角走容器档的 999px，
//   左内边距取紧凑档的项内边距 7px、右内边距取紧凑档的容器内边距 2px。
// - **菜单**→ 官方 `Menu` 传 `compact: true`（官方紧凑档），项内图标按官方该档的 14×14
//   图标位给 `{ size: 14 }`。
// - **二级菜单项**（就地展开的子项）→ 缩进 = **紧凑档的图标槽 14px + 项内间隙 6px = 20px**：
//   它落在项的左内边距上（官方原有的项内边距 7px + 20px = 27px），于是子项的图标槽与文字
//   整体右移一个缩进位、文字落在**父项文字左缘右侧 20px** 处。这不是官方件自己的几何，而是
//   「嵌套一层」的关系量——档位表里没有「缩进」这一档，所以这条规则整条登记在下面的
//   `SCALE_EXEMPT` 里。
// - **选中态勾选框的缩进**（`.dshOneTree_checkIndent`，#133）→ **标准档的图标位 16px +
//   紧凑档的行内间隙 6px = 22px**：会话行进多选后，勾选框左边先空出一层，框就落在工作区行
//   那枚文件夹图标的列上（两行的行内边距与间隙同档，7 + 22 = 29 = 7 + 16 + 6）。与二级菜单项
//   同一条理由——这是「缩进一层」这个关系量，官方没有哪个件带这种缩进，档位表里没有能拿来
//   当出处的量，所以这条规则登记在 `SCALE_EXEMPT` 里。
// - **骨架窗口件**（顶栏 / 抽屉头 / 搜索框 / 图标按钮）→ 高度取**紧凑档的行高 26px**
//   （一列里只有这一种「一个控件的高度」，比它高的东西会把这一行撑破），横向档取紧凑档的
//   容器内边距 2px；它们的官方原值（36 / 30 / 28px）留在标准档里当兜底。
// - **横向左缘基准**（#125，新增骨架件照这条判）：这一列的**左**缘只有两条基准。**骨架区**
//   （顶栏那一行 / 分组过滤条 / 抽屉头）取**行内容基准** `row-padding-inline`——它们里面的
//   东西（搜索框、分组胶囊、抽屉标题）要与列表行的内容左缘（工作区行的文件夹图标左缘）
//   对齐；搜索框还要补回官方 `searchExpanded` 自己那 2px 左外突，算式与理由写在它那条规则
//   上方。**通栏容器**（列表 / 抽屉列表 / 回收站入口行）左内缩归 0，靠里面的行自己带
//   `row-padding-inline`——行的底色因此从容器左缘铺到头（#125 的「出血不受影响」）。
//   右侧不受这条管：容器与控件的右内缩仍取骨架基线 `section-padding-inline`。
// - **纵向留白**（分节头下边距 `section-header-gap`、块与块之间 `group-gap`）→ **标准档的
//   4px**（#119：纵向取官方节奏、横向取紧凑档——紧凑档没有「块与块之间」的纵向刻度，那个
//   2px 是菜单项彼此相接的分隔线外边距；理由写在 sidebarFramePlugin.ts 文件头）。
// - **行内图标位**（`.dshOneTree_slot` / `.dshOneTree_scheduleIndicator` /
//   `.dshOneTree_rowIconButton`）→ **标准档的 16×20 / 16×16**，不取紧凑档的 14×14：
//   紧凑档那个 14×14 是官方 **14 档图标**的盒子，而本插件的行图标是官方 **16 档**
//   （`IconXxx16`）——换 14 盒子得把全部行图标同时换成 14 档，属另一件事。
// - **选择态动作条**（`.dshOneTree_selectionBar*`，#120）→ 全部由密度档与官方 token 构成：
//   条内按钮是**官方 Button 的 `sm` 档**（官方 `._sm_cfgyt_30{height:28px;font-size:12px;
//   line-height:18px;padding:0 10px;border-radius:14px}`，28px 与标准档的顶栏图标按钮 /
//   搜索框同高），不是自造尺寸；纵向留白走密度档的 `group-gap`（#119 口径：纵向取官方节奏），
//   横向走 `row-padding-inline`（**行内容基准**：条里的计数与按钮要和列表行的文字左缘对齐，
//   #134 起这一档是官方原值 8px，条跟着行一起变，两条边始终同一条竖线）；形态是通栏横带
//   （上下发丝线 + 极淡底色，颜色只用官方 token），所以它自己不带圆角/高度字面量——理由写
//   在它那条规则上方。
// - **标签组**（`.dshOneTree_tag*`，#107）与**自绘件**（勾选框里的短横线、a11y 用的 1×1
//   裁剪盒、抽屉把手）**不进本表**：标签组逐字沿用旧侧栏的取值（理由写在各自规则上方），
//   自绘件不是几何档位能表达的形态；这些例外逐条列在下面的 `SCALE_EXEMPT` 里，每条都写了理由。
// - **弹窗**（`.dshOneTree_modal*`，#127）→ **紧凑档 + 官方变体 + 标题档**：对话框是「一整块
//   行/控件堆起来的容器」，所以它自己与里面的行、输入框整套取紧凑档（高 26px / 圆角 5px /
//   字号 12px / 行高 18px / 行内间隙 6px），底部按钮取**官方 Button 的 `sm` 档**（官方变体，
//   `<Button size="sm">`），容器圆角取容器档的卡片圆角 12px 与容器内留白 12px；**标题是标题、
//   不是行**，取标题档（标准档的 14px / 20px，与抽屉标题那一档同源）。弹窗整条细节见下面
//   `.dshOneTree_modal` 那一节的注释（含为什么它不吃密度变量）。
// ---------------------------------------------------------------------------

/**
 * 档位表（代码形态，与上面的注释表一一对应）。值 = 上面那张表的取值，
 * test/sidebarStyleScale.test.ts 拿它做表驱动断言，钉住三件事：
 * ① 侧栏 CSS 里的圆角/高度/字号/图标位取值都能在这里找到出处（新控件拍脑袋的数值会红）；
 * ② 密度表的 vscode 列逐项落在它该落的档里，分三类判（#134 起的口径）——**行家族 = 标准档**
 * （表里那几项按「每一项 = 标准档里同名量的取值」判，不是「值在标准档里出现过」）；
 * **纵向留白 = 官方原值**（#119）；**其余（菜单一侧与骨架 / 胶囊 / 顶栏 / 弹窗）= 紧凑档**
 * （仍按集合判「落在紧凑档里」，含 #123 起元信息仍必须等于紧凑档字号行高那条）；
 * ③ official 列全部落在标准档里。
 * 新增一处几何时：先在注释表里补一行「值 + 官方出处」，再在这里补同名条目。
 */
export const SCALE_TIERS = {
  /** 紧凑档：官方 primitives Menu 的 compact 变体（出处见上面那一节）。 */
  compact: {
    rowHeight: '26px', // ._item_1nxmc_92{min-height:26px}
    rowRadius: '5px', // ._item_1nxmc_92{border-radius:5px}
    rowGap: '6px', // ._item_1nxmc_92{gap:6px}
    rowPaddingInline: '7px', // ._item_1nxmc_92{padding:3px 7px}
    rowPaddingBlock: '3px', // ._item_1nxmc_92{padding:3px 7px}
    fontSize: '12px', // ._item_1nxmc_92{font-size:12px}
    lineHeight: '18px', // ._item_1nxmc_92{line-height:18px}
    iconSize: '14px', // ._compactList_1nxmc_128 ._itemIcon_1nxmc_144{width:14px;height:14px}
    // 一行里一个**图标按钮**的方框边长 = 行高 26px（紧凑档里控件与行同高；官方同型见
    // ui-cordis 的 `.Nqubda_actionButton{width:28px;height:28px}`——那边是标准档的同族件）。
    iconButtonSize: '26px', // ._item_1nxmc_92{min-height:26px}
    groupLabelHeight: '24px', // ._label_1nxmc_124{padding:4px 7px} + line-height:16px = 4+16+4
    groupLabelFontSize: '11px', // ._label_1nxmc_124{font-size:11px}
    groupLabelLineHeight: '16px', // ._label_1nxmc_124{line-height:16px}
    groupLabelPaddingBlock: '4px', // ._label_1nxmc_124{padding:4px 7px}
    listRadius: '7px', // ._list_1nxmc_8._compactList_1nxmc_128{border-radius:7px}
    listPadding: '2px', // ._list_1nxmc_8._compactList_1nxmc_128{padding:2px}
    separatorMargin: '2px', // ._compactList_1nxmc_128 ._separator_1nxmc_82{margin:2px}
  },
  /** 标准档：官方侧栏原值（与 sidebarFramePlugin 的密度表 official 列同源，逐项出处见那张表）。 */
  standard: {
    projectRowHeight: '34px', // .YDXeBa_projectRow{height:34px}
    sessionRowHeight: '32px', // .YDXeBa_sessionRow{height:32px}
    rowRadius: '8px', // .YDXeBa_projectRow,.YDXeBa_sessionRow{border-radius:8px}
    rowGap: '6px', // .YDXeBa_projectRow,.YDXeBa_sessionRow{gap:6px}
    rowPaddingInline: '8px', // .YDXeBa_projectRow,.YDXeBa_sessionRow{padding:0 8px}
    titleFontSize: '14px', // .YDXeBa_title{font-size:14px}
    titleLineHeight: '20px', // .YDXeBa_title{line-height:20px}
    metaFontSize: '12px', // .YDXeBa_time{font-size:12px}
    metaLineHeight: '20px', // .YDXeBa_time{line-height:20px}
    slotWidth: '16px', // .YDXeBa_slot{width:16px}
    slotHeight: '20px', // .YDXeBa_slot{height:20px}
    rowIconButtonSize: '16px', // .YDXeBa_iconButton{width:16px;height:16px}
    rowIconButtonRadius: '4px', // .YDXeBa_iconButton{border-radius:4px}
    rowActionsHeight: '20px', // .YDXeBa_projectRow .YDXeBa_rowActions{height:20px}
    sectionHeaderHeight: '36px', // .bhn1Oq_sectionHeader{height:36px}
    sectionHeaderRadius: '12px', // .bhn1Oq_sectionHeader{border-radius:12px}
    sectionHeaderGap: '4px', // .bhn1Oq_sectionHeader{gap:4px}
    headerPaddingInline: '4px', // .bhn1Oq_sectionHeader{padding-left:4px}
    iconButtonSize: '28px', // .bhn1Oq_iconButton{width:28px;height:28px}
    searchHeight: '28px', // .bhn1Oq_search{height:28px}
    searchExpandedHeight: '30px', // .bhn1Oq_searchExpanded{height:30px}
    searchExpandedRadius: '10px', // .bhn1Oq_searchExpanded{border-radius:10px}
    searchFontSize: '13px', // .bhn1Oq_searchInput{font-size:13px}
    clearButtonSize: '24px', // .bhn1Oq_clearButton{width:24px;height:24px}
    listRowGap: '2px', // .bhn1Oq_flatList>*+*{margin-top:2px}
    listGroupGap: '4px', // .bhn1Oq_groupSection+.bhn1Oq_groupSection{margin-top:4px}
    listPaddingBottom: '16px', // .bhn1Oq_list{padding-bottom:16px}
    emptyFontSize: '13px', // .bhn1Oq_empty{font-size:13px}
    overflowRowHeight: '28px', // .bhn1Oq_sessionOverflowButton{height:28px}
    searchRowMinHeight: '48px', // .YDXeBa_searchResultRow{min-height:48px}
    searchRowTitleFontSize: '14px', // .YDXeBa_searchResultTitle{font-size:14px}
    searchRowTitleLineHeight: '20px', // .YDXeBa_searchResultTitle{line-height:20px}
    searchRowMetaLineHeight: '17px', // .YDXeBa_searchResultWorkspace,.YDXeBa_searchResultSnippet{line-height:17px}
    renameInputHeight: '44px', // .bhn1Oq_renameInput{height:44px}
    renameInputRadius: '22px', // .bhn1Oq_renameInput{border-radius:22px}
    renameInputLineHeight: '22px', // .bhn1Oq_renameInput{line-height:22px}
    drawerBlockHeaderHeight: '26px', // ._7KE1Ra_groupTitle{padding:5px 8px 3px} + line-height:18px
    // 底下一枚原是「回收站入口行的行高」（官方同座位的 `Nqubda_badge{height:42px}`）：
    // #137 把那一行整套改成旧侧栏规格（高度由纵向内边距 + 标题行高撑出，不再写死），
    // 这个量连同它的密度键一起退场，所以档位表里也不再登记。
    pillHeight: '28px', // ._7KE1Ra_trigger{height:28px}
    pillFontSize: '13px', // ._7KE1Ra_trigger{font-size:13px}
    pillPaddingStart: '8px', // ._7KE1Ra_trigger{padding:0 4px 0 8px}
    pillPaddingEnd: '4px', // ._7KE1Ra_trigger{padding:0 4px 0 8px}
    smallPillHeight: '20px', // .Nqubda_rowStatus{height:20px}
    smallPillRadius: '10px', // .Nqubda_rowStatus{border-radius:10px}
    smallPillFontSize: '11px', // .Nqubda_rowStatus{font-size:11px}
    smallPillLineHeight: '20px', // .Nqubda_rowStatus{line-height:20px}
    hoverPathLineHeight: '16px', // .YDXeBa_hoverPath{line-height:16px}
  },
  /** 容器档：官方容器类的圆角与容器内留白（出处见上面那一节）。 */
  container: {
    listRadius: '7px', // 官方紧凑档列表 ._list_1nxmc_8._compactList_1nxmc_128{border-radius:7px}
    cardRadius: '12px', // 官方卡片 .fsXYAq_card / .iWrAna_instructionsCard{border-radius:12px}
    pillRadius: '999px', // 官方胶囊 .Nqubda_transitionActions button{border-radius:999px}
    roundRadius: '50%', // 官方 .bhn1Oq_iconButton{border-radius:50%}
    listBottomPadding: '12px', // 官方滚动列表容器 .Nqubda_body{padding:0 12px 12px}
  },
  /** 官方变体：官方 primitives `Button` 的 `sm` 档（出处见上面那一节）。 */
  buttonSm: {
    height: '28px', // ._sm_cfgyt_30{height:28px}
    radius: '14px', // ._sm_cfgyt_30{border-radius:14px}
    fontSize: '12px', // ._sm_cfgyt_30{font-size:12px}
    lineHeight: '18px', // ._sm_cfgyt_30{line-height:18px}
    paddingInline: '10px', // ._sm_cfgyt_30{padding:0 10px}
  },
} as const

/**
 * 档位表的分组名（源码层断言与运行期套件都按它遍历，免得各处硬写名字——加一档只改这里）。
 */
export const SCALE_TIER_NAMES = ['compact', 'standard', 'container', 'buttonSm'] as const

/**
 * 档位表管不到的规则（上面注释表里点名的例外）：键是规则选择器里的子串，值是理由。
 * 断言遇到这里列到的规则就跳过；要往里加，先写清为什么。
 *
 * **理由串用英文**：i18n 合入门禁把 `src/**` 新增行里的中文字符串字面量当「漏翻」拦
 * （`scripts/check-i18n.sh` 的兜底检查 5），而这里的串是给断言读的数据、不是界面文案；
 * 中文说明写在每一条上方的注释里。
 */
export const SCALE_EXEMPT: readonly { selector: string; reason: string }[] = [
  // 标签组（#107，#122 改回旧侧栏的竖线规格）：pill 16px 的左缘、22px 的组头高、
  // 16/19/2/2 的竖线几何、组内行 24px 左内边距，都是**这套自定义形态自己**的取值——
  // 它们是「标签组」这一层的布局（竖线要落进行的左内边距里才不压文字），官方没有标签组
  // 这个形态，档位表里也就没有能拿来当出处的量（档位表管的是与官方件同族控件的高度/
  // 圆角/字号/留白）。所以这一族规则整条不进档位表。
  { selector: 'dshOneTree_tag', reason: 'tag groups (#107/#122): pill, rail and row indent are this custom shape own layout; the official side has no tag group to take a tier value from' },
  // a11y 的 1×1 裁剪盒（视觉隐藏但仍在树里），不是几何档位能表达的形态。
  { selector: 'dshOneTree_visuallyHidden', reason: 'a11y 1x1 clip box is not a geometric tier value' },
  // 勾选框里的自绘短横线：官方图标集没有减号类图标，这条横线用样式画（举证见那条规则上方）。
  { selector: 'dshOneTree_checkDash', reason: 'hand-drawn half-check dash: official icons have no minus glyph' },
  // 抽屉把手（#103 自有件）：12px 是可抓区高度、32×3 是自绘把手条——官方没有这个形态。
  { selector: 'dshOneTree_drawerHandle', reason: 'drawer handle (#103): hand-drawn shape, no official counterpart' },
  // 同上：把手条本体（32×3、2px 圆角），与 .dshOneTree_drawerHandle 一起构成抽屉把手。
  { selector: 'dshOneTree_drawerGrip', reason: 'drawer handle grip bar: same hand-drawn shape as above' },
  // 二级菜单项的缩进（#126）：27px 是**紧凑档三个值的和**（项内边距 7px + 图标槽 14px +
  // 项内间隙 6px），也就是「比父项深一层」这个关系量——官方没有哪个件带这种嵌套缩进，
  // 档位表里没有能拿来当出处的量，所以这条规则整条不进档位表。出处与算式写在
  // 那条规则上方、档位表那一节的「二级菜单项」一条里。
  { selector: 'dshOneTree_submenuItem', reason: 'submenu indent (#126): 27px = compact padding-inline 7px + icon slot 14px + item gap 6px, a nesting offset no official component has a tier for' },
  // 回收站入口行的计数胶囊（#137）：字号 10px / 行高 16px / 圆角 8px / 内边距 0 5px 整套取自
  // 旧侧栏那一行（`sessionsView.ts` 的 `.recycle-entry-count`），是「这一行按旧侧栏规格」那一
  // 组取值的一员；档位表管的是与官方件同族的控件档位（官方侧栏里这一类计数只有文字、没有
  // 独立的胶囊件可当出处）。这一行里其余的取值（26 / 16 / 14 / 8 / 2px）都能在档位表里找到
  // 出处，逐条对应写在它那条规则上方。
  { selector: 'dshOneTree_footerCount', reason: 'recycle entry count pill (#137): 10px/16px/8px/0 5px are the old sidebar plugin values for this row, not a tier of any official component' },
  // 会话行选中态勾选框的缩进（#133）：22px 是**标准档图标位 16px + 紧凑档行内间隙 6px 的和**
  // ——也就是工作区行里「框宽 + 行内 gap」那一层，即「缩进一层」这个关系量本身。与上面
  // 二级菜单项同一条理由：官方没有哪个件带这种嵌套缩进，档位表里没有能拿来当出处的量。
  // 算式与出处写在 `SCALE_TIERS` 上方那张注释表的「选中态勾选框的缩进」一条、以及
  // 那条规则上方。
  { selector: 'dshOneTree_checkIndent', reason: 'select-mode check indent (#133): 22px = standard icon slot 16px + compact row gap 6px, i.e. the workspace row own checkbox column, a nesting offset no official component has a tier for' },
]
// 导出给断言用（test/sidebarStyleScale.test.ts 直接拿这段字符串做表驱动扫描：档位表与
// 样式是同一份源码里的两个东西，读实体比扫源码文本稳）。
export const CSS =
  // overflow:hidden 是给分节头的 `margin-right:-4px`（官方原值，让标题栏贴到侧栏
  // 右缘）兜住溢出：shell 把 `--dsh-sidebar-inline-padding` 置 0 之后，那 4px 会伸到
  // 容器外，让侧栏外层（官方 hHd-Xa_regionArea）的 scrollWidth 比 clientWidth 大 4px
  // ——平时看不见，但官方在「单列表」视图里对选中行 scrollIntoView 时会被横滚 4px，
  // 整棵树跟着左移 4px（#85 回归断言实测到的既有缺陷）。列表自己的滚动在 .dshOneTree_list。
  '.dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);overflow:hidden;flex-direction:column;flex:1;display:flex;position:relative}' +
  // 骨架窗口件（顶栏 / 抽屉头 / 搜索框 / 图标按钮）取「紧凑档的行高 26px」当高度、取
  // 紧凑档的容器内边距 2px 当横向档（档位表见文件头）：一列里只有这一种「一个控件的高度」，
  // 比它高的东西会把这一行撑破（这一行是 `overflow:hidden`）。它们的官方原值（36 / 30 / 28px）
  // 留在标准档里当兜底：圆角 50% 取容器档（官方 `.bhn1Oq_iconButton{border-radius:50%}`）、
  // 12px 取容器档的卡片圆角（官方分节头 `.bhn1Oq_sectionHeader{border-radius:12px}` 同值）、
  // 搜索框展开态 10px 取标准档（官方 `.bhn1Oq_searchExpanded{border-radius:10px}`），
  // `margin-top:2px` / `margin-right:-4px` 逐字沿用官方分节头。
  '.dshOneTree_iconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_sectionHeader{box-sizing:border-box;height:var(--dsh-one-density-section-header-height,36px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin-bottom:var(--dsh-one-density-section-header-gap,4px);padding-left:var(--dsh-one-density-section-padding-inline,4px);display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}' +
  // 搜索栏（#132：官方那套 UI 的**两态都在**，默认折叠——平时是一枚 28px 圆放大镜，
  // 点开才展开成输入框 + 清除钮）——search / searchSlot / searchButton / searchInput /
  // clearButton 五个类名与几何逐字对应官方 css-module（含两个 Expanded 变体），
  // 所以两侧的折叠态与展开态都能直接逐项比对（F-04）。
  '.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}' +
  // #125：搜索框的左缘要落在**行内容基准**上（工作区行的文件夹图标左缘 = 列表行的内容左缘）。
  // 顶栏那一行自己的左内缩是骨架基线 `section-padding-inline`（官方分节头
  // `.bhn1Oq_sectionHeader{padding-left:4px}`），而行的内容从 `row-padding-inline` 起
  //（官方 `.YDXeBa_projectRow,.YDXeBa_sessionRow{padding:0 8px}`），两者之差就是这一格
  // 要补的距离；再加回 2px 是因为官方 `searchExpanded` 自己带 `margin-inline:-2px`
  //（`.bhn1Oq_searchExpanded{width:calc(100% + 4px);…;margin-inline:-2px}`，与它的
  // `width:calc(100% + 4px)` 配对，靠它向两侧各外突 2px），它把搜索框的边框盒往左顶了
  // 2px——补回来之后对齐的才是**搜索框的边框左缘**，也就是用户眼睛看到的那条左缘。
  // 两个键都是档位里的量（紧凑档 7px / 官方 8px 与紧凑档 2px / 官方 4px），所以这条例
  // 在两档下都成立、不写死像素。
  '.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:calc(var(--dsh-one-density-row-padding-inline,8px) - var(--dsh-one-density-section-padding-inline,4px) + 2px)}' +
  '.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:none;flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);display:flex}' +
  '.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:var(--dsh-one-density-search-height,28px);color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}' +
  '.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:var(--dsh-one-density-search-expanded-height,30px);color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}' +
  '.dshOneTree_searchButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton{width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-search-expanded-height,30px)}' +
  '.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}' +
  '.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}' +
  '.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}' +
  '.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:var(--dsh-one-density-list-padding-bottom,16px);overflow-y:auto}' +
  '.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_groupSection{position:relative}' +
  '.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  '.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}' +
  '.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}' +
  '.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}' +
  // 空态/加载态是一小块竖排区域（#110）：一行说明 + 可选的第二行 + 可选的入口按钮，
  // 所以里面每一行都是块级元素，按钮跟在最后自成一行。文案与内边距沿用上面那条
  // （零工作区 / 分组无成员 / 加载中三态与「暂无会话」共用同一外形，只是内容不同）。
  '.dshOneTree_emptyLine+.dshOneTree_emptyLine{margin-top:2px}' +
  // 空态入口按钮（「新建会话」这类空态里的按钮）：**不跟行家族**（#134：用户只点了侧栏
  // 的行；它是个按钮，不是列表里的行），仍逐字取紧凑档——高 26px / 圆角 5px / 字号 12px
  // （官方 compact 档 `._item_1nxmc_92` 的三个值）。它不消费密度变量（空态在官方 web 侧
  // 与 VS Code 侧同一形态，没有「宿主给偏好」这回事）。
  '.dshOneTree_emptyAction{cursor:pointer;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:5px;flex:none;align-items:center;margin-top:8px;padding:0 10px;font-family:inherit;font-size:12px;display:inline-flex}' +
  '.dshOneTree_emptyAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  // 溢出按钮（会话列表末尾那条「还有 N 个会话」）：**行家族一员**（它本身就是列表里的一行），
  // #134 起整套取标准档——高 28px / 圆角 8px / 字号 12px / `padding:0 12px 0 28px`，四项都
  // 逐字等于官方 `.bhn1Oq_sessionOverflowButton`（左侧 28px 是让文字对齐上一行的标题）。
  '.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}' +
  // 行（工作区行 / 会话行 / 抽屉会话行共用这两条）：**#134 起整套取标准档**——圆角 8px、
  // 行内边距 8px（官方 `.YDXeBa_projectRow,.YDXeBa_sessionRow{border-radius:8px;gap:6px;
  // padding:0 8px}` 里那三项），行高分别 34px / 32px（下面两条规则）、标题 14px/20px、
  // 图标位 16×20。**#113 定的「与行菜单的项同档」作废**：菜单仍取官方紧凑档，行不跟它。
  // 圆角与行内边距仍经密度变量下发（`--dsh-one-density-row-radius` / `-row-padding-inline`）：
  // 这两个键在 VS Code 档与官方档同值，但 F-04 的对齐口径仍按「把变量对齐回树插件自己声明的
  // 官方兜底值」量，走变量两边对得上（它们也是「行内容基准」，见文件头的档位表）。
  '.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:var(--dsh-one-density-row-radius,8px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  // 行高：工作区行 34px / 会话行 32px，逐字取自官方（`.YDXeBa_projectRow{height:34px}`、
  // `.YDXeBa_sessionRow{height:32px}`）。两个行种不再同高——官方侧栏里它们本来就差 2px。
  '.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}' +
  '.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}' +
  '.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}' +
  '.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}' +
  // #115 行内改名的输入框：占标题那一格（同一份外边距与字号，行几何不动），选区要高亮
  // 所以 user-select 要显式放开（整行是 user-select:none）。高度走标题行高（密度档），
  // 边框与圆角与行内其它小件同语言。
  // 档位归属（#113 的档位表）：高度 / 字号 / 行高都走密度档变量（兜底 = 标准档的 20px /
  // 14px / 20px），圆角 4px = 标准档的行内图标按钮圆角（官方 `.YDXeBa_iconButton
  // {border-radius:4px}`，行内小件同一档），所以这条规则整条能落在档位表里。
  '.dshOneTree_inlineRenameInput{box-sizing:border-box;flex:1;min-width:0;height:var(--dsh-one-density-title-line-height,20px);margin:0 6px 0 4px;padding:0 4px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;outline:none;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);user-select:text}' +
  // 行内图标位取**标准档**的 16×20（官方 `.YDXeBa_slot{width:16px;height:20px}`）：紧凑档的
  // 14×14 是官方 14 档图标的盒子，本插件的行图标是官方 16 档，理由见文件头的档位表。
  '.dshOneTree_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}' +
  '.dshOneTree_folderActive{color:var(--dsw-alias-state-business-primary)}' +
  '.dshOneTree_projectRow .dshOneTree_chevron{display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_chevron{display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_folder{display:none}' +
  '.dshOneTree_arrow{transition:transform .15s var(--ds-ease-in-out)}' +
  '.dshOneTree_arrowOpen{transform:rotate(90deg)}' +
  '.dshOneTree_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}' +
  '.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}' +
  '.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}' +
  '.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}' +
  // 搜索结果行里的那一枚（官方 `_searchScheduleIndicator`）：贴着标题，不再留右外边距。
  '.dshOneTree_searchScheduleIndicator{margin-left:4px;margin-right:0}' +
  '.dshOneTree_dot{flex:none}' +
  '.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  '.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  // 行内图标位同样取标准档 16×16 / 圆角 4px（官方 `.YDXeBa_iconButton{width:16px;height:16px;
  // border-radius:4px}`，与 `.dshOneTree_slot` 同一条理由）。
  '.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}' +
  // 搜索结果行：行家族一员，**#134 起整套取标准档**——最小高 48px、圆角 8px、行内边距 8px、
  // 块内边距 4px、标题 14px/20px、元信息 12px/17px，逐项取自官方 `.YDXeBa_searchResultRow
  // {min-height:48px;border-radius:8px;padding:4px 8px}` 与 `.YDXeBa_searchResultTitle` /
  // `_searchResultSnippet`。块内边距的 8px 走行内边距那一项（行内容基准，与工作区行/会话行
  // 同一条竖线）。
  '.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);flex-direction:column;align-items:stretch;padding:4px var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}' +
  // 两行的字号 / 行高同样取标准档：标题 14px/20px（官方 `.YDXeBa_searchResultTitle`，
  // 与其它行的标题同一档、同一个密度键）、元信息 12px/17px（官方 `.YDXeBa_searchResultSnippet
  // {font-size:12px;line-height:17px}`，17px 是官方给搜索结果元信息自己的行高，与行内时间
  // 那 18px 不是同一个量，所以这里写官方字面量、不吃 meta-line-height 那个键）。
  '.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}' +
  '.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}' +
  '.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}' +
  '.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}' +
  '.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}' +
  '.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}' +
  '.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}' +
  // ---- 弹窗（#127）：七个对话框（分组新建/重命名/删除、管理分组、归档确认、标签组新建/
  // 删除、会话/工作区/标签组重命名、删除工作区）整套取**紧凑档**，与侧栏同一密度。
  //
  // **为什么这一族不吃密度变量**（`var(--dsh-one-density-*)`）：官方 Modal 把内容
  // `createPortal` 到 `document.body`，弹窗不是 frame 容器的后代——密度变量挂在 frame 上
  // （`sidebarFramePlugin.ts` 的 `DENSITY_CSS`），继承不到弹窗里。所以这里写**紧凑档的字面量**
  // （不是 `var(..., 官方原值)`：那样读到的永远只是兜底值，反而看不出真实取值）。两侧
  // （VS Code 侧栏 / 官方 web）因此拿到同一份紧凑档，弹窗本就不属于「宿主容器给的排版偏好」。
  //
  // **为什么走 `headless` 这个官方 prop、而不是覆盖官方 Modal 的内部类名**：
  // - 官方 primitives 的 Modal **没有尺寸变体**——0.1.6-alpha.1 的 css-module（前缀 `w1urq`）
  //   只有 `root/mask/dialog/content/header/title/close/description/body/footer` 十类；同族的
  //   「确认框」`confirmation` 变体反而更宽（`._confirmation_1nu42_1{width:min(440px,100%)}`、
  //   正文 `14px/22px`）。也就是说官方这一件上没有「紧凑档」可取。
  // - 它给的两个官方口子：`className`（挂到 dialog 上）与 `headless`（只渲染 mask + dialog +
  //   children，标题/关闭钮/页脚由调用方给）。走官方 prop 就不必去覆盖官方哈希类名
  //   （`[class*="_header_"]` 那种写法会随官方改名静默失效，而 CSS 类名不在每日上游探针的
  //   覆盖范围内），符合 AGENTS「官方机制优先」的优先序：官方 prop > CSS 手段。
  // - 稳定性：官方哪天摘掉 `headless`，我们自己的头行会与官方 header 同时出现（标题重复、
  //   按钮仍在 children 里照常能点）——是**看得见的退化**，不是静默失效。这一条**每日探针
  //   覆盖不到**（primitives 的代码在官方 web 前端的 chunk 里，不在 combo 的插件段里），所以
  //   它靠上游升级时跑 `verify:lab` 的 F-34 撞出来（那一条会把七个弹窗逐个开出来量）。
  // - 官方那层壳照旧由官方代码提供：mask 点击关闭、Esc 关闭、portal 到 body、`role="dialog"`
  //   + `aria-modal` + `aria-label`（`title` 仍然要传，它进的是 aria-label）。
  //
  // 取值出处（档位表见文件头）：对话框自身 = 紧凑档的行内间隙 6px + 容器档的容器内留白 12px
  // 与卡片圆角 12px；头行 = 紧凑档行高 26px + 容器内边距 2px（控件之间）；关闭钮 = 紧凑档
  // 图标按钮 26px + 行圆角 5px；标题 = 标题档 14px/20px（标准档，与抽屉标题同源）；说明与
  // 错误行 = 紧凑档 12px/18px；底部按钮 = 官方 Button `sm` 档（组件自己给，本件不写几何）。
  '.dshOneTree_modal{box-sizing:border-box;gap:6px;padding:12px;border-radius:12px}' +
  '.dshOneTree_modalHead{flex:none;align-items:center;gap:2px;height:26px;display:flex}' +
  '.dshOneTree_modalTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;font-size:14px;line-height:20px;font-weight:500;overflow:hidden}' +
  '.dshOneTree_modalClose{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:5px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_modalClose:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_modalDesc{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}' +
  '.dshOneTree_modalActions{flex:none;justify-content:flex-end;align-items:center;gap:6px;display:flex}' +
  // 输入框：高 26px = 紧凑档行高、圆角 5px = 紧凑档行圆角、字号 12px / 行高 18px = 紧凑档字号与
  // 文字行高、左右内边距 7px = 紧凑档项内边距；占位字色与顶栏搜索框同一枚 token（原来没设，
  // 走的是浏览器默认灰）。官方侧栏那个 44px / 圆角 22px 的胶囊输入框（`.bhn1Oq_renameInput`，
  // 出处见档位表的 `renameInput*`）是标准档——留在表里当兜底语义。
  '.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:26px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:5px;outline:none;padding:0 7px;font-size:12px;font-weight:400;line-height:18px}' +
  '.dshOneTree_renameInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  // 错误行 / 进行中那行都是紧凑档正文（12px / 18px）。**不再自带 margin-top**：弹窗的内容是
  // dialog 的 flex 项，项与项之间的空隙由 dialog 自己的 `gap`（紧凑档 6px）给，各处再叠一份
  // 外边距会出现两种间距。行高由这一条给死，所以空行的盒高恒等于 18px。
  '.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // ---- #81：分组过滤条 / 活状态计数 / 批量选择 / 回收站抽屉 ----
  // 颜色一律官方 token；尺寸/间距走密度档变量（#104 起把过滤条与抽屉也纳进来，新键的
  // 出处见文件头那段的说明：胶囊尺寸取自官方同形的胶囊触发器、块头取自官方列表分组
  // 块头）。变量名与官方原值两栏一一对应，改动时 shell 侧那张表同步改。
  // #125：左内缩改用 `row-padding-inline`（= 行内容基准）而不是骨架基线
  // `section-padding-inline`——过滤条上面的胶囊要和下面列表行的内容左缘对齐，而这两条
  // 在选中状态下是同时在场的（选择态动作条 `.dshOneTree_selectionBar` 的横向留白本来就是
  // `row-padding-inline`），对齐之后三条（胶囊 / 计数 / 行内容）同一条竖线。
  '.dshOneTree_filterBar{align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin:0 0 var(--dsh-one-density-group-gap,4px);padding-left:var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  // 分组过滤条（#99：单胶囊 + 成员计数 + ▾）。形状沿用官方胶囊语言（官方 token、
  // 999px 圆角 = 容器档，出处：官方 ui-cordis 的 `.Nqubda_transitionActions button`）；
  // 尺寸整套取**紧凑档**——高 26px / 字号 12px 与行菜单的项同高同字，左内边距取紧凑档的
  // 项内边距 7px、右内边距（▾ 那一侧）取紧凑档的容器内边距 2px。官方同形的胶囊触发器
  // （ui-model-selection 的 `_7KE1Ra_trigger`：28px / 13px / 起 8px 止 4px）留在标准档当兜底。
  '.dshOneTree_pill{cursor:pointer;height:var(--dsh-one-density-pill-height,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);max-width:100%;padding:0 var(--dsh-one-density-pill-padding-end,4px) 0 var(--dsh-one-density-pill-padding-start,8px);font-size:var(--dsh-one-density-pill-font-size,13px);display:inline-flex;overflow:hidden}' +
  '.dshOneTree_pill:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_pillActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_pillTag{flex:none;align-items:center;color:var(--dsw-alias-label-tertiary);display:inline-flex}' +
  '.dshOneTree_pillLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}' +
  '.dshOneTree_pillCount{color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_pillChevron{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;display:inline-flex}' +
  // 菜单里「名字 + 右对齐计数」那一行的行内间隙：与菜单项同档 6px（官方 compact 档
  // `._item_1nxmc_92{gap:6px}`；此前 12px 是自造值）。
  '.dshOneTree_menuRow{align-items:center;gap:6px;min-width:0;width:100%;display:flex}' +
  '.dshOneTree_menuRowLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}' +
  '.dshOneTree_menuRowCount{color:var(--dsw-alias-label-tertiary);flex:none}' +
  // 二级菜单（就地展开的子项）的缩进（#126）。官方 Menu 的项是一条「图标槽 + 文字 + 勾」的
  // 流水线，官方没有「子项缩进 / 层级」这个口（前三层都没有：项对象只认 id / label / icon /
  // disabled / danger / type / submenu，渲染时字段逐个取用、不吃 className、style 这类口——
  // 出处是 0.1.6-alpha.1 的 `lib/client.js` 渲染项那一段；官方 `submenu` 是右侧飞出的一层，
  // 窄侧栏里放不下，所以子项由我们就地展开，见 rows.ts 的 submenuChild），因此缩进落在
  // **官方项那个 `<button role="menuitem">`（官方给每个菜单项打的语义属性，同一份源码）的
  // 左内边距**上：用 :has() 从我们自己的标记类去选它的祖先项，不碰任何官方哈希类名。
  // 取值 = 紧凑档的项内边距 7px + 图标槽 14px + 项内间隙 6px = 27px：把整行（图标槽 + 文字）
  // 右移一个缩进位，于是子项文字落在**父项文字左缘右侧 14px + 6px = 20px** 处，而子项自己的
  // 图标与文字仍相邻。子项没有图标时也占住图标槽（rows.ts 的 indentSubmenuItem 补空槽），
  // 所以「子项文字左缘 − 父项文字左缘」对所有子项是**同一个值**。
  '[role="menuitem"]:has(.dshOneTree_submenuItem){padding-left:27px}' +
  // 底部回收站入口行（#99：官方 sidebar.footer.action 座位；#137 整套几何按**旧侧栏规格**
  // 重定）。形态还是主区（🗑 + 文案 + 计数）+ 右侧两枚动作图标，计数 0 整体灰态。
  //
  // #137 的口径：这一行的取值逐条取自旧侧栏插件的正本（`sessionsView.ts` 的 `.recycle-entry*`
  // 与 `sessionsWebview.ts` 的 renderRecycleEntry），**不再随宿主密度变**——用户点名的参照物
  // 就是旧侧栏那一行，所以其它「行家族取某档」的口径在这一行上不适用。逐条对应：
  // - **行盒**：旧规格的 `width:100%` + `flex:none` + `box-sizing:border-box`，右侧 8px。
  //   `width:100%` 是**右对齐的成因**：这一行挂在官方那个 list 槽里，槽容器的宽度按内容收缩，
  //   不自己声明吃满的话，标签的 `flex:1` 没有余量可吃，计数与两枚动作就紧跟文字（用户截图
  //   里那一幕）。
  // - **主区**：纵向 7px、右 4px 用旧规格的 `7px 4px`；**左内边距不取旧规格的 14px**，改用
  //   行内容基准 `row-padding-inline`——旧侧栏的 14px 是相对**它自己的**列表基准算的（那边
  //   工作区行 `padding:0 10px`），这边的基准由 #125 定成「搜索框 / 分组胶囊 / 行内容同一条
  //   竖线」，F-30 量着入口行主区图标也在这条线上；取 14px 会把图标推离基准一格。
  // - **行高不再写死**：旧规格那一行的高度也是撑出来的（`7px + 行高 + 7px`），这边同样——
  //   标题档行高 20px 撑出 34px（与 #134 之后的工作区行同高）。因此密度键 `footer-row-height`（官方档 42px / VS Code 档
  //   26px）**不再被消费**，已从 shell 的密度表与档位表里删除；主区的悬停底色也不再有圆角
  //   （旧规格 `border:0`）。
  // - **计数**是一枚胶囊（旧规格：字号 10px / 圆角 8px / 内边距 0 5px / 有底色），底色取法与
  //   `.dshOneTree_workspaceBadge` 同源（官方 token 里没有「徽标底色」这一类，从文字色兑）；
  //   计数 0 时按旧规格去掉底色与内边距。
  // - **两枚动作按钮** 26×26、内部图标 14（尺寸不再挂密度键 `icon-button-size`，那一位仍被
  //   顶栏图标按钮消费）。按钮形状仍是官方圆形（`border-radius:50%`，出处 `.bhn1Oq_iconButton`）
  //   ——旧侧栏那两枚是 4px 圆角方块，本条只对齐尺寸与图标，不动形状。
  '.dshOneTree_footerRow{box-sizing:border-box;flex:none;width:100%;align-items:center;gap:2px;padding-right:8px;display:flex}' +
  '.dshOneTree_footerRowEmpty{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_footerMain{cursor:pointer;min-width:0;line-height:var(--dsh-one-density-title-line-height,20px);color:inherit;background:0 0;border:0;border-radius:0;flex:1;align-items:center;gap:6px;padding:7px 4px 7px var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);display:inline-flex;overflow:hidden}' +
  '.dshOneTree_footerMain:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_footerIcon{flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_footerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_footerCount{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 20%,transparent);border-radius:8px;flex:none;font-size:10px;line-height:16px;padding:0 5px}' +
  '.dshOneTree_footerRowEmpty .dshOneTree_footerCount{background:0 0;padding:0}' +
  '.dshOneTree_footerIconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_footerIconButton:disabled{cursor:default;opacity:.45}' +
  '.dshOneTree_footerIconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  // 「管理分组…」对话框（#99）：行 = 名字 + 计数 + ✎/🗑。**弹窗里的行不跟行家族**（#134：
  // 用户只点了侧栏的行，弹窗不要顺手改；#127 起这一整套取紧凑档）：行高 26px / 行内间隙 6px
  // / 字号 12px——与侧栏的行同一密度。行**不带左右内边距**：它就在弹窗自己那 12px 的容器
  // 留白里，再叠一份会让名字比上方的标题与输入框更靠右（三者左缘要对齐）。
  '.dshOneTree_manageList{max-height:240px;overflow-y:auto}' +
  '.dshOneTree_manageRow{align-items:center;gap:6px;height:26px;display:flex}' +
  '.dshOneTree_manageName{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;font-size:12px;line-height:18px;overflow:hidden}' +
  '.dshOneTree_manageCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:18px}' +
  '.dshOneTree_manageEmpty{color:var(--dsw-alias-label-tertiary);padding:4px 0;font-size:12px;line-height:18px}' +
  '.dshOneTree_manageCreate{align-items:center;gap:6px;display:flex}' +
  '.dshOneTree_manageCreate .dshOneTree_renameInput{flex:1;min-width:0}' +
  '.dshOneTree_manageCreate button{white-space:nowrap;flex:none}' +
  // 行尾绝对定位层（#109）：当前工作区那枚蓝色胶囊 + 活状态计数。**不进正常流**——
  // 官方这一行没有这两个元素，进流会把标题挤窄，而 F-04 PARITY 逐项比对标题的几何
  // 矩形（同一处置的说明见 ActivityBadge 的注释）。悬停时整层让位给四枚动作按钮。
  '.dshOneTree_rowEnd{pointer-events:none;position:absolute;right:var(--dsh-one-density-row-padding-inline,8px);align-items:center;gap:6px;display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowEnd,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowEnd{display:none}' +
  // 「当前工作区」胶囊（#109 E7）：蓝色药丸 + 容器名（VS Code 侧就是 vscode，官方 web 侧是 web
  // ——名字由能力口给，不写死）。颜色全部由官方 business 蓝 token 混出来（老侧栏那份用的是
  // VS Code 的 chart 蓝，官方 web 侧没有那个变量，本件要保持可移植）；`color-mix` 认不出时
  // 前一行的兜底值生效（中性底色 + 蓝字，观感退化但不破版）。
  // 尺寸取**容器档的小状态胶囊**（官方 ui-cordis 的 `.Nqubda_rowStatus{height:20px;
  // border-radius:10px;padding:0 6px;font-size:11px;line-height:20px}`）——它就是这个形态的
  // 官方原件：一行高的状态小胶囊。此前那组 16px / 10px / line-height:1 是自造值（#113 换掉）。
  '.dshOneTree_workspaceBadge{flex:none;height:20px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);border-radius:10px;align-items:center;padding:0 6px;font-size:11px;line-height:20px;display:inline-flex}' +
  // 二级菜单的零尺寸锚点（空白会话行 / 未分组行没有 ⋯ 按钮可挂；右键那一份用指针坐标）。
  '.dshOneTree_menuAnchor{display:none}' +
  '.dshOneTree_activity{align-items:center;gap:6px;display:inline-flex}' +
  '.dshOneTree_activityItem{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px);align-items:center;gap:4px;display:inline-flex}' +
  '.dshOneTree_check{cursor:pointer;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkBox{box-sizing:border-box;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff)}' +
  // #102：勾选框的灰态（置顶行不可勾选）。0.35 的透明度与旧侧栏的 disabled 复选框同值。
  '.dshOneTree_checkOff{opacity:.35;cursor:default}' +
  // #108：部分选中（组头三态里的 some）——方框与全选同色，里面画一条短横线。
  // 官方 primitives 没有减号类图标（按 0.1.6-alpha.1 的 combo 核实：IconMinus* /
  // IconRemove* / IconSubtract* 零命中），所以这条横线用样式画。
  '.dshOneTree_checkDash{width:8px;height:2px;background:currentColor;border-radius:1px}' +
  '.dshOneTree_groupCheck{flex:none;cursor:pointer}' +
  // #133：会话行选中态勾选框左边那一段缩进（占位元素，22px = 标准档的图标位 16px +
  // 紧凑档的行内间隙 6px，也就是工作区行里「框宽 + 行内 gap」那一层）。它把框推到工作区
  // 行文件夹图标那一列上（7 + 22 = 29 = 7 + 16 + 6），左边那一段就是用户要的「空出一层」。
  // 框自己不再带外边距——它右边的 4px 间隔由标题自己的左外边距给（标题那条规则里的
  // `margin:0 6px 0 4px`），标题因此落在 7 + 22 + 16 + 4 = 49，与工作区名的 51 相差 2
  //（#124 立下的 δ，两态一致）。组内会话行（#122 的 24px 左内边距）同一条规则，缩进相对
  // 组内行的内容基准算，框落 24 + 22 = 46、标题落 66，δ(组内) 同样不变。
  // 这一段**不是死空间**：#124 当时以死空间为由把框放在行首，用户实测后要的就是旧侧栏
  // 那个形态（组头的框在最左、行的框缩进一层），所以它按用户口径留着（详见 rows.ts 里
  // 那段说明）。
  '.dshOneTree_checkIndent{width:22px;flex:none}' +
  // #102：置顶图钉（标题前常驻）与手动未读的加粗标题。颜色走官方 token（次级色，
  // 与行内其它标记同一档）；加粗值取自旧侧栏的 .session-title.unread（600）。
  '.dshOneTree_pin{flex:none;width:14px;height:14px;margin-right:4px;color:var(--dsw-alias-label-tertiary);align-items:center;display:inline-flex}' +
  '.dshOneTree_unread{font-weight:600}' +
  // ---- 选择态动作条（#120）----
  // 用户实测报的是三件事：计数被压成一字一行、窄宽度排不下、与过滤条/列表行分不开。
  //
  // ① **形态**：一条**通栏横带**——上下各一条极细分隔线（`.5px solid
  //    var(--dsw-alias-border-l3)`，就是侧栏里那条发丝线：我们分组胶囊的描边、抽屉顶边用的
  //    都是它）+ 一片极淡的底色（`--dsw-alias-interactive-bg-hover`，官方给列表行悬停用的
  //    同一枚 token），于是这条自己成一块面，按钮不再「浮」在树行上（用户报的第三点）。
  //    **为什么不做成圆角描边框**（另一种常见容器形态）：列表内容区是从侧栏左缘再往外伸
  //    4px 的（列表行按设计出血到边缘，见 `.dshOneTree_listArea` 的 `margin-left:-4px`），
  //    x=-4 处那半像素描边整条落在可视区之外（实验室实测：条的左边框矩形 l=-4，`elementFromPoint`
  //    在 x=1 处命中的已经是条内元素）；要让它可见就得给容器编一个 4px 的内缩，而那个 4px
  //    在档位表里没有出处。通栏横带沿用列表行同一套出血模型，不需要任何自造数值。
  // ② **留白**（按 #119 的口径：纵向取官方节奏、横向取行内容基准）：上下与向内的纵向留白
  //    走 `--dsh-one-density-group-gap`（官方原值 4px，就是分块之间那一档；分组过滤条
  //    的下边距用的是同一个键，两条基线同高），条内横向留白走
  //    `--dsh-one-density-row-padding-inline`（**行内容基准**：条里的计数与按钮和列表行的
  //    文字左缘对齐，#134 起这一档是官方原值 8px，跟着行一起变）。
  // ③ **分组**：计数与按钮两组；计数不收缩（`flex:none` + `white-space:nowrap`，任何宽度
  //    下都是一行），按钮组 `margin-left:auto` 推到右边，放不下时**整组换行**（组内再
  //    放不下就逐枚往下排，永不横向溢出）。**不走「收成图标 + tooltip」那条路**：这三枚里
  //    有「归档」这种不可逆动作（#103 明确要求它与可逆的「移入回收站」在界面上分得开），
  //    图标化会抹掉这层语义；而且这三枚都是常驻动作，图标化等于每次操作都要先悬停读提示。
  //    按钮自身 `flex:none` + `white-space:nowrap`：宁换行，不挤文字。
  '.dshOneTree_selectionBarWrap{flex:none;background:var(--dsw-alias-interactive-bg-hover);border-top:.5px solid var(--dsw-alias-border-l3);border-bottom:.5px solid var(--dsw-alias-border-l3);margin:0 0 var(--dsh-one-density-group-gap,4px);padding:var(--dsh-one-density-section-gap,4px) 0}' +
  '.dshOneTree_selectionBar{box-sizing:border-box;flex-wrap:wrap;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:none;white-space:nowrap;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}' +
  '.dshOneTree_selectionActions{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin-left:auto;display:flex}' +
  '.dshOneTree_selectionActions button{flex:none;white-space:nowrap}' +
  '.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 var(--dsh-one-density-row-padding-inline,8px) var(--dsh-one-density-section-gap,4px)}' +
  // 回收站抽屉（#103）：从底部半高滑出（高度由组件按档位给，默认 50%、上拉到 90%）。
  // 滑入与滑出共用这一条过渡（同一个 `transform`，开态只是把它还原成 none），所以两边
  // 天然对称（#117）。时长与缓动都取官方 token，不写自造数字：官方 ui-theme 的 base.css
  // 里 `--ds-ease-in-out:cubic-bezier(.4, 0, .2, 1)`、`--ds-transition-duration:.2s`
  // （出处：官方包 `packages/client/ui-theme/src/styles/base.css`，本机从网关下发的 combo
  // 里量到同值；官方右侧栏面板 `.P3OORG_panel` 用的就是这一对）。
  '.dshOneTree_drawer{z-index:10;box-sizing:border-box;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l3);position:absolute;left:0;right:0;bottom:0;transform:translateY(100%);transition:transform var(--ds-transition-duration) var(--ds-ease-in-out);flex-direction:column;display:flex;overflow:hidden}' +
  '.dshOneTree_drawerOpen{transform:none}' +
  // 退场期（#117）：抽屉还留在 DOM 里把滑出演完，但开合态已经是「关」——这一趟只为动画，
  // 所以不再接收指针，免得这 200ms 里点到它上面的「还原」还算数。
  '.dshOneTree_drawerLeaving{pointer-events:none}' +
  // 跟随官方的 reduced-motion 写法（官方 ui-sidebar-right 的 `.P3OORG_panel` 同款：整条
  // 过渡关掉）。组件侧的退场期兜底定时器读的是元素上真实的过渡时长，这里关掉之后会读到
  // 0s，于是抽屉立刻消失、不做动画。
  '@media (prefers-reduced-motion:reduce){.dshOneTree_drawer{transition:none}}' +
  '.dshOneTree_drawerHandle{cursor:grab;height:12px;flex:none;justify-content:center;align-items:center;display:flex;touch-action:none}' +
  '.dshOneTree_drawerHandle:active{cursor:grabbing}' +
  '.dshOneTree_drawerGrip{width:32px;height:3px;background:var(--dsw-alias-border-l3);border-radius:2px}' +
  '.dshOneTree_drawerHandle:hover .dshOneTree_drawerGrip{background:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-section-padding-inline,4px) 0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dshOneTree_drawerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  // #125：左内缩归 0，理由同入口行——抽屉会话行自己带 `row-padding-inline`，容器的左内缩
  // 会把整列推右一格（此前进去了 section-padding-inline，于是抽屉行的内容左缘比抽屉头
  // 标题右 2px）；右侧仍吃骨架基线。
  '.dshOneTree_drawerList{min-height:0;padding:0 var(--dsh-one-density-section-padding-inline,4px) var(--dsh-one-density-list-padding-bottom,16px) 0;flex:1;overflow-y:auto}' +
  '.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  // 抽屉里的分块块头**就是那一枚可点折叠的按钮**：几何取**紧凑档的分组标题档**——
  // 盒高 24px = 官方 compact 档 `._label_1nxmc_124{padding:4px 7px}` + `line-height:16px`
  // 的 4+16+4；字号取紧凑档字号 12px。官方列表的分组块头（ui-model-selection 的
  // `_7KE1Ra_groupTitle`：26px 总高、12px 字号）留标准档兜底。**圆角与行内边距吃
  // 行内容基准那两个键**（`row-radius` / `row-padding-inline`，见文件头的档位表）：它们
  // #134 起是官方的 8px / 8px，块头因此与它下面的抽屉会话行左右对齐（块头文字与行文字
  // 同一左缘），高度仍走它自己的 `drawer-block-header-height`。
  '.dshOneTree_drawerGroupLabel{cursor:pointer;width:100%;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);height:var(--dsh-one-density-drawer-block-header-height,26px);align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-meta-font-size,12px);display:flex}' +
  '.dshOneTree_drawerGroupLabel:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerGroupArrow{width:14px;flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_drawerGroupLabelText{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_drawerGroupCount{flex:none}' +
  // 抽屉会话行（行家族一员）：**#134 起取标准档**——高 32px（与主树会话行同高）/
  // 圆角 8px / 行内间隙 6px / 行内边距 8px，逐项是官方 `.YDXeBa_sessionRow` 的值。
  '.dshOneTree_drawerRow{cursor:pointer;height:var(--dsh-one-density-session-row-height,32px);color:var(--dsw-alias-label-primary);border-radius:var(--dsh-one-density-row-radius,8px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerRow:hover,.dshOneTree_drawerRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerRow .dshOneTree_title{flex:1;margin:0}' +
  // 抽屉行的动作**常显**（不像主树那样悬停才出）：抽屉里本来就只有两个动作，藏起来
  // 反而要多一步悬停；行悬停时时间让位给动作。
  '.dshOneTree_drawerActions{flex:none;align-items:center;gap:2px;display:inline-flex}' +
  '.dshOneTree_drawerRow:hover .dshOneTree_time,.dshOneTree_drawerRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  '.dshOneTree_drawerRestore{cursor:pointer;height:20px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;align-items:center;gap:4px;padding:0 4px;font-family:inherit;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}' +
  '.dshOneTree_drawerRestore:hover:not(:disabled){color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_drawerRestore:disabled{cursor:default;opacity:.45}' +
  '.dshOneTree_drawerStatus{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  // 归档确认弹窗的明细（按工作区树形列）：块头 + 行。整套取紧凑档（#127）：块头 12px 字号、
  // 明细行 = 紧凑档的分组标题配方（上下内边距 4px + 文字行高 18px = 26px 一行），缩进 16px
  // 让明细行落在块头文字的下一层（树形结构）。块间距 6px = 紧凑档行内间隙。
  '.dshOneTree_modalBlocks{max-height:240px;overflow-y:auto}' +
  '.dshOneTree_modalBlock+.dshOneTree_modalBlock{margin-top:6px}' +
  '.dshOneTree_modalBlockLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}' +
  '.dshOneTree_modalRow{box-sizing:border-box;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;height:26px;font-size:12px;line-height:18px;padding:4px 0 4px 16px;overflow:hidden}' +
  // 飘提示（移入/还原/归档的回执）：贴树区域底部，几秒后自己消失。
  '.dshOneTree_flash{z-index:20;max-width:90%;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;font-size:var(--dsh-one-density-meta-font-size,12px);position:absolute;bottom:8px;left:50%;transform:translateX(-50%)}' +
  // 入口行两枚动作里的「清空」是危险动作（= 永久归档），按错误色标出来。
  '.dshOneTree_footerIconDanger:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // 会话标签组（#107；#122 把竖线改回旧侧栏的规格）：形态与数值逐字沿用旧侧栏
  // sessionsView.ts 的 `.tag-*` 规则（小 pill、pill 下沿到组尾的 2px 贯穿竖线、
  // 组内行 24px 左缩进、折叠计数角标）。
  // 组色由组件经 `--dshone-tag-color` 下发在**组块**上（色板在 tagGroups.ts，理由见
  // 那个文件头：用户自选的标签色板，官方 token 里没有这一类）——竖线与组内行是 pill 的
  // 兄弟节点，变量挂在组块这一层才继承得到。
  '.dshOneTree_tagBlock{position:relative;border-radius:6px}' +
  // 组头：pill 左缘与竖线同列（16px，旧侧栏 .tag-head 的原值）；右侧留出折叠三角与动作位。
  '.dshOneTree_tagHead{align-items:center;height:22px;padding-left:16px;padding-right:var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_tagPill{cursor:grab;color:var(--dshone-tag-color);background:color-mix(in srgb,var(--dshone-tag-color) 22%,transparent);border:1px solid color-mix(in srgb,var(--dshone-tag-color) 45%,transparent);border-radius:4px;align-items:center;gap:4px;height:16px;padding:0 7px;font-size:10px;font-weight:600;line-height:1;white-space:nowrap;display:inline-flex}' +
  '.dshOneTree_tagPill:active{cursor:grabbing}' +
  '.dshOneTree_tagDot{width:6px;height:6px;background:var(--dshone-tag-color);border-radius:2px;flex:none}' +
  '.dshOneTree_tagName{text-overflow:ellipsis;white-space:nowrap;max-width:120px;overflow:hidden}' +
  // 拖 pill 换组序时的插入位置指示线（上下沿，box-shadow 不占布局）。
  '.dshOneTree_tagPill[data-dshone-tag-drop="before"]{box-shadow:0 -2px 0 0 var(--dshone-tag-color)}' +
  '.dshOneTree_tagPill[data-dshone-tag-drop="after"]{box-shadow:0 2px 0 0 var(--dshone-tag-color)}' +
  // 折叠/展开三角：展开朝下、折叠朝右（与工作区行同款）。
  '.dshOneTree_tagToggle{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;margin-left:2px;padding:0;display:inline-flex}' +
  '.dshOneTree_tagToggle:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_tagArrow{transition:transform .15s ease}' +
  '.dshOneTree_tagArrowOpen{transform:rotate(90deg)}' +
  // 组头右侧的 ⋯（组菜单）：与工作区行/会话行同一处置——悬停组块才出（组块很矮，
  // 常显会一直在组名旁边晃）；菜单开着时也保持可见（不然菜单一开按钮就没了锚点）。
  '.dshOneTree_tagBlock:hover .dshOneTree_rowActions,.dshOneTree_tagBlock.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  // 折叠态才出计数（展开态每行自己带状态点）；靠右对齐到行尾动作列。
  '.dshOneTree_tagCounts{align-items:center;gap:6px;margin-left:auto;padding-right:2px;display:inline-flex}' +
  '.dshOneTree_tagCount{color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}' +
  // 贯穿整组的竖线（#122 回到旧侧栏 .tag-line 的规格）：组块上一个**绝对定位的细线元素**，
  // 起点是 pill 下沿（22px 的组头，pill 16px 居中 → 下沿落在 19px）贴着垂直方向往下，
  // 终点收在组块底部（bottom:2px），横向上落在组内行的左内边距里（16px 起、宽 2px，
  // 不压文字）。颜色就是**组色本身**（实色，不做半透明淡化：用户要的是「与标签同色」）。
  '.dshOneTree_tagLine{pointer-events:none;position:absolute;left:16px;top:19px;bottom:2px;width:2px;border-radius:1px;background:var(--dshone-tag-color)}' +
  // 折叠态（组内行不渲染）不画线。
  '.dshOneTree_tagCollapsed .dshOneTree_tagLine{display:none}' +
  // 组内行：只给会话行加左内边距（旧侧栏 .session-row.tagged 的 24px，竖线落在这一段里），
  // 行**自身**的左边界与普通会话行一致——不再叠外边距，行内元素一概不动。
  '.dshOneTree_tagRows>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_tagRows .dshOneTree_sessionRow{padding-left:24px}' +
  // 拖会话入组时目标组块高亮（组色淡底，不遮行）。
  '.dshOneTree_tagDropActive{background:color-mix(in srgb,var(--dshone-tag-color) 14%,transparent)}' +
  // 组色小色块（选色菜单与新建弹窗的色板共用）。
  '.dshOneTree_tagSwatch{width:10px;height:10px;border-radius:3px;flex:none;display:block}' +
  '.dshOneTree_tagColorPick{gap:6px;display:flex}' +
  '.dshOneTree_tagColorPickItem{cursor:pointer;width:20px;height:20px;color:var(--dsw-alias-label-inverse,#fff);border:.5px solid var(--dsw-alias-border-l4);border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_tagColorPickOn{box-shadow:0 0 0 2px var(--dsw-alias-label-secondary)}'
export const CSS_TAG_ID = '@dsh-one/dsh-workspace-tree/Tree.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-workspace-tree'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.append(tag)
}
