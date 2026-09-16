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
// ## 哪个控件取哪档（新增控件照此判定）
// - **行家族**（会话行 / 工作区行 / 搜索结果行 / 抽屉会话行 / 会话溢出按钮 / 回收站入口行
//   主区 / 空态入口按钮）→ **紧凑档**：它们与菜单项同形（一行里放图标 + 文字），所以
//   高度 / 圆角 / 字号 / 行内间隙 / 行内边距 / 文字行高整套跟菜单项一致。
// - **胶囊**（分组过滤条）→ **紧凑档**的高度与字号（与菜单项同高），圆角走容器档的 999px，
//   左内边距取紧凑档的项内边距 7px、右内边距取紧凑档的容器内边距 2px。
// - **菜单**→ 官方 `Menu` 传 `compact: true`（官方紧凑档），项内图标按官方该档的 14×14
//   图标位给 `{ size: 14 }`。
// - **骨架窗口件**（顶栏 / 抽屉头 / 搜索框 / 图标按钮）→ 高度取**紧凑档的行高 26px**
//   （一列里只有这一种「一个控件的高度」，比它高的东西会把这一行撑破），横向档取紧凑档的
//   容器内边距 2px；它们的官方原值（36 / 30 / 28px）留在标准档里当兜底。
// - **行内图标位**（`.dshOneTree_slot` / `.dshOneTree_scheduleIndicator` /
//   `.dshOneTree_rowIconButton`）→ **标准档的 16×20 / 16×16**，不取紧凑档的 14×14：
//   紧凑档那个 14×14 是官方 **14 档图标**的盒子，而本插件的行图标是官方 **16 档**
//   （`IconXxx16`）——换 14 盒子得把全部行图标同时换成 14 档，属另一件事。
// - **标签组**（`.dshOneTree_tag*`，#107）与**自绘件**（勾选框里的短横线、a11y 用的 1×1
//   裁剪盒、抽屉把手）**不进本表**：标签组逐字沿用旧侧栏的取值（理由写在各自规则上方），
//   自绘件不是几何档位能表达的形态；这些例外逐条列在下面的 `SCALE_EXEMPT` 里，每条都写了理由。
// ---------------------------------------------------------------------------

/**
 * 档位表（代码形态，与上面的注释表一一对应）。值 = 上面那张表的取值，
 * test/sidebarStyleScale.test.ts 拿它做表驱动断言，钉住三件事：
 * ① 侧栏 CSS 里的圆角/高度/字号/图标位取值都能在这里找到出处（新控件拍脑袋的数值会红）；
 * ② 密度表的 vscode 列全部落在紧凑档里；③ official 列全部落在标准档里。
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
    footerRowHeight: '42px', // .Nqubda_badge{height:42px}
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
} as const

/**
 * 档位表管不到的规则（上面注释表里点名的例外）：键是规则选择器里的子串，值是理由。
 * 断言遇到这里列到的规则就跳过；要往里加，先在这里写清为什么。
 */
export const SCALE_EXEMPT: readonly { selector: string; reason: string }[] = [
  {
    selector: 'dshOneTree_tag',
    reason: '标签组（#107）：形态与数值逐字沿用旧侧栏的 .tag-* 规则，不进档位表（要改另立条目）',
  },
  { selector: 'dshOneTree_visuallyHidden', reason: 'a11y 的 1×1 裁剪盒，不是几何档位' },
  {
    selector: 'dshOneTree_checkDash',
    reason: '勾选框里的自绘短横线：官方图标集没有减号类图标，这条横线用样式画（出处见那条规则上方）',
  },
  {
    selector: 'dshOneTree_drawerHandle',
    reason: '抽屉把手（#103 自有件）：12px 是可抓区高度、32×3 是自绘把手条——官方没有这个形态，档位表里没有对应物',
  },
  {
    selector: 'dshOneTree_drawerGrip',
    reason: '同上：把手条本体（32×3、2px 圆角），与 .dshOneTree_drawerHandle 一起构成抽屉把手',
  },
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
  // 搜索栏（#99：官方那套 UI 的**展开态**常驻，折叠态的放大镜胶囊退役）——
  // search / searchSlot / searchButton / searchInput 四个类名与几何逐字对应官方
  // css-module（含 Expanded 变体），所以两侧展开态可以直接逐项比对（F-04）。
  '.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}' +
  '.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:0}' +
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
  '.dshOneTree_flatList>*+*,.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_groupSection{position:relative}' +
  '.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  '.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}' +
  '.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}' +
  '.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}' +
  // 空态/加载态是一小块竖排区域（#110）：一行说明 + 可选的第二行 + 可选的入口按钮，
  // 所以里面每一行都是块级元素，按钮跟在最后自成一行。文案与内边距沿用上面那条
  // （零工作区 / 分组无成员 / 加载中三态与「暂无会话」共用同一外形，只是内容不同）。
  '.dshOneTree_emptyLine+.dshOneTree_emptyLine{margin-top:2px}' +
  // ---- #113：行家族统一取「紧凑档」（高度 / 圆角 / 字号 / 行内间隙 / 行内边距 / 文字
  // 行高整套与行菜单的项同档，档位表见文件头）。圆角走 `--dsh-one-density-row-radius`：
  // 它在两个档之间取值不同（标准档 8px / 紧凑档 5px），而 F-04 要把密度对齐回官方档再逐项
  // 比对圆角，所以必须经变量下发。
  '.dshOneTree_emptyAction{cursor:pointer;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:5px;flex:none;align-items:center;margin-top:8px;padding:0 10px;font-family:inherit;font-size:12px;display:inline-flex}' +
  '.dshOneTree_emptyAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  // 高 = 紧凑档行高 26px、圆角 = 紧凑档行圆角 5px、字号 = 紧凑档字号 12px（官方 compact
  // 档 `._item_1nxmc_92` 三个值）；`padding:0 12px 0 28px` 逐字沿用官方
  // `.bhn1Oq_sessionOverflowButton`（左侧 28px 是让文字对齐上一行的标题）。
  '.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}' +
  // 行：圆角/行内间隙/行内边距 = 紧凑档的 5px / 6px / 7px（官方 compact 档
  // `._item_1nxmc_92{border-radius:5px;gap:6px;padding:3px 7px}`；横向前后两值就是
  // 7px 与容器内边距 2px 两个档，取项内边距 7px）。
  '.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:var(--dsh-one-density-row-radius,8px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  // 行高 = 紧凑档行高 26px（两个行种同高：紧凑档只有「一个控件一行」这一种行高）。
  '.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}' +
  '.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}' +
  '.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}' +
  '.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}' +
  '.dshOneTree_flatRowWithoutStatus .dshOneTree_title{margin-left:0}' +
  // #115 行内改名的输入框：占标题那一格（同一份外边距与字号，行几何不动），选区要高亮
  // 所以 user-select 要显式放开（整行是 user-select:none）。高度走标题行高（密度档），
  // 边框与圆角与行内其它小件同语言。
  // 档位归属（#113 的档位表）：高度 / 字号 / 行高都走密度档变量（兜底 = 标准档的 20px /
  // 14px / 20px），圆角 4px = 标准档的行内图标按钮圆角（官方 `.YDXeBa_iconButton
  // {border-radius:4px}`，行内小件同一档），所以这条规则整条能落在档位表里。
  '.dshOneTree_inlineRenameInput{box-sizing:border-box;flex:1;min-width:0;height:var(--dsh-one-density-title-line-height,20px);margin:0 6px 0 4px;padding:0 4px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;outline:none;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);user-select:text}' +
  '.dshOneTree_flatRowWithoutStatus .dshOneTree_inlineRenameInput{margin-left:0}' +
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
  // 搜索结果行：行家族一员，整套取紧凑档——最小高 26px（= 紧凑档行高；这一行是两行内容块，
  // 实际高度由内容撑出，`min-height` 只是不低于一行）、圆角 5px、项内边距 3px 7px
  //（官方 compact 档 `._item_1nxmc_92{padding:3px 7px}`）。
  '.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);flex-direction:column;align-items:stretch;padding:3px 7px;display:flex}' +
  '.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}' +
  // 两行的字号/行高也取紧凑档（12px / 18px），与行标题、元信息同档——官方那一对是
  // 14px/20px 与 12px/17px（`YDXeBa_searchResult*`），留在标准档当兜底语义。
  '.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:12px;line-height:18px;overflow:hidden}' +
  '.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}' +
  '.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}' +
  '.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}' +
  '.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}' +
  '.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}' +
  '.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}' +
  '.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}' +
  '.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // ---- #81：分组过滤条 / 活状态计数 / 批量选择 / 回收站抽屉 ----
  // 颜色一律官方 token；尺寸/间距走密度档变量（#104 起把过滤条与抽屉也纳进来，新键的
  // 出处见文件头那段的说明：胶囊尺寸取自官方同形的胶囊触发器、块头取自官方列表分组
  // 块头）。变量名与官方原值两栏一一对应，改动时 shell 侧那张表同步改。
  '.dshOneTree_filterBar{align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin:0 0 var(--dsh-one-density-group-gap,4px);padding-left:var(--dsh-one-density-section-padding-inline,4px);display:flex}' +
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
  // 底部回收站入口行（#99：官方 sidebar.footer.action 座位）。形态按旧侧栏那一行：
  // 主区（🗑 + 文案 + 计数）+ 右侧两枚动作图标；计数 0 整体灰态。它是行家族一员，整套取
  // 紧凑档（高 26px / 圆角 5px / 行内间隙 6px / 字号 12px）；官方同座位的条目
  // （ui-cordis 的 CordisPanel.module.css `Nqubda_badge{height:42px}`）留在标准档当兜底。
  '.dshOneTree_footerRow{align-items:center;gap:2px;padding:0 var(--dsh-one-density-section-padding-inline,4px);display:flex}' +
  '.dshOneTree_footerRowEmpty{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_footerMain{cursor:pointer;min-width:0;height:var(--dsh-one-density-footer-row-height,42px);color:inherit;background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);flex:1;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);display:inline-flex;overflow:hidden}' +
  '.dshOneTree_footerMain:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_footerIcon{flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_footerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_footerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_footerIconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_footerIconButton:disabled{cursor:default;opacity:.45}' +
  '.dshOneTree_footerIconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  // 「管理分组…」对话框（#99）：行 = 名字 + 计数 + ✎/🗑。
  '.dshOneTree_manageList{max-height:240px;margin-bottom:12px;overflow-y:auto}' +
  '.dshOneTree_manageRow{align-items:center;gap:8px;height:var(--dsh-one-density-row-height,34px);padding:0 4px;display:flex}' +
  '.dshOneTree_manageName{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}' +
  '.dshOneTree_manageCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_manageEmpty{color:var(--dsw-alias-label-tertiary);padding:8px 4px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_manageCreate{align-items:center;gap:8px;display:flex}' +
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
  // #102：置顶图钉（标题前常驻）与手动未读的加粗标题。颜色走官方 token（次级色，
  // 与行内其它标记同一档）；加粗值取自旧侧栏的 .session-title.unread（600）。
  '.dshOneTree_pin{flex:none;width:14px;height:14px;margin-right:4px;color:var(--dsw-alias-label-tertiary);align-items:center;display:inline-flex}' +
  '.dshOneTree_unread{font-weight:600}' +
  '.dshOneTree_selectionBarWrap{flex:none}' +
  '.dshOneTree_selectionBar{gap:8px;box-sizing:border-box;padding:4px 8px;align-items:center;display:flex}' +
  '.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 8px 4px}' +
  // 回收站抽屉（#103）：从底部半高滑出（高度由组件按档位给，默认 50%、上拉到 90%）。
  '.dshOneTree_drawer{z-index:10;box-sizing:border-box;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l3);position:absolute;left:0;right:0;bottom:0;transform:translateY(100%);transition:transform .2s var(--ds-ease-in-out);flex-direction:column;display:flex;overflow:hidden}' +
  '.dshOneTree_drawerOpen{transform:none}' +
  '.dshOneTree_drawerHandle{cursor:grab;height:12px;flex:none;justify-content:center;align-items:center;display:flex;touch-action:none}' +
  '.dshOneTree_drawerHandle:active{cursor:grabbing}' +
  '.dshOneTree_drawerGrip{width:32px;height:3px;background:var(--dsw-alias-border-l3);border-radius:2px}' +
  '.dshOneTree_drawerHandle:hover .dshOneTree_drawerGrip{background:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-section-padding-inline,4px) 0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dshOneTree_drawerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_drawerList{min-height:0;padding:0 var(--dsh-one-density-section-padding-inline,4px) var(--dsh-one-density-list-padding-bottom,16px);flex:1;overflow-y:auto}' +
  '.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  // 抽屉里的分块块头**就是那一枚可点折叠的按钮**：几何取**紧凑档的分组标题档**——
  // 盒高 24px = 官方 compact 档 `._label_1nxmc_124{padding:4px 7px}` + `line-height:16px`
  // 的 4+16+4；字号取紧凑档字号 12px；圆角/行内边距与行家族同档（5px / 7px）。官方列表的
  // 分组块头（ui-model-selection 的 `_7KE1Ra_groupTitle`：26px 总高、12px 字号）留标准档兜底。
  '.dshOneTree_drawerGroupLabel{cursor:pointer;width:100%;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);height:var(--dsh-one-density-drawer-block-header-height,26px);align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-meta-font-size,12px);display:flex}' +
  '.dshOneTree_drawerGroupLabel:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerGroupArrow{width:14px;flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_drawerGroupLabelText{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_drawerGroupCount{flex:none}' +
  // 抽屉会话行（行家族一员）：高 26px / 圆角 5px / 行内间隙 6px / 行内边距 7px，整套紧凑档。
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
  // 归档确认弹窗的明细（按工作区树形列）：块头 + 行。
  '.dshOneTree_modalBlocks{max-height:240px;margin-top:8px;overflow-y:auto}' +
  '.dshOneTree_modalBlock+.dshOneTree_modalBlock{margin-top:6px}' +
  '.dshOneTree_modalBlockLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 4px}' +
  '.dshOneTree_modalRow{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-one-density-meta-font-size,12px);padding:2px 4px 2px 16px;overflow:hidden}' +
  // 飘提示（移入/还原/归档的回执）：贴树区域底部，几秒后自己消失。
  '.dshOneTree_flash{z-index:20;max-width:90%;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;font-size:var(--dsh-one-density-meta-font-size,12px);position:absolute;bottom:8px;left:50%;transform:translateX(-50%)}' +
  // 入口行两枚动作里的「清空」是危险动作（= 永久归档），按错误色标出来。
  '.dshOneTree_footerIconDanger:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // 会话标签组（#107）：形态与数值逐字沿用旧侧栏 sessionsView.ts 的 `.tag-*` 规则
  //（小 pill、pill 下沿到组尾的 2px 贯穿竖线、组内行 24px 左缩进、折叠计数角标）。
  // 组色由组件经 `--dshone-tag-color` 下发（色板在 tagGroups.ts，理由见那个文件头：
  // 用户自选的标签色板，官方 token 里没有这一类）。
  '.dshOneTree_tagBlock{position:relative;border-radius:6px}' +
  // 组头：pill 左缘与竖线同列；右侧留出折叠三角与动作位。
  '.dshOneTree_tagHead{align-items:center;height:22px;padding-left:var(--dsh-one-density-row-padding-inline,8px);padding-right:var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
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
  // 组内行：贯穿竖线（从 pill 下沿到组尾）+ 仅给会话行加约 12px 左缩进，行内元素不动。
  '.dshOneTree_tagRows{border-left:2px solid color-mix(in srgb,var(--dshone-tag-color) 55%,transparent);margin-left:calc(var(--dsh-one-density-row-padding-inline,8px) + 8px);padding-left:8px}' +
  '.dshOneTree_tagRows>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_tagRows .dshOneTree_sessionRow{padding-left:12px}' +
  // 拖会话入组时目标组块高亮（组色淡底，不遮行）。
  '.dshOneTree_tagDropActive{background:color-mix(in srgb,var(--dshone-tag-color) 14%,transparent)}' +
  // 组色小色块（选色菜单与新建弹窗的色板共用）。
  '.dshOneTree_tagSwatch{width:10px;height:10px;border-radius:3px;flex:none;display:block}' +
  '.dshOneTree_tagColorPick{gap:8px;margin-top:10px;display:flex}' +
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
