/**
 * @dsh-one/vscode-sidebar-shell——侧栏位 frame 插件（#70）：顶替下线的官方
 * ui-layout，官方侧栏（品牌位/工作区树/设置入口/底部动作条）原样进 VS Code
 * 侧栏 view。spike #69 题1 已验证裸 frame 里侧栏完整、数据正常。
 *
 * - root 槽注册：children 只声明 sidebar + shell.overlay（conversation/details
 *   等 chat 树槽位不声明，对应贡献静默缺席——chat 树有独立 frame）；同时经
 *   `ctx.slots.provideRoot` 提供官方 root 槽位钩子 panelInfo（接手官方外框
 *   契约的清单见 frameShared.ts 文件头）。
 * - 宽度形态（#70 VS Code 验收项 2）：WebviewView 宽度由 VS Code 拖拽决定
 *   （240~560+px 都可能），frame 不做固定 280/56 轨——侧栏列 100% 流体，
 *   ResizeObserver 量出容器实际宽度传给官方 SidebarRoot（官方壳按
 *   renderSlot 的 width 参数定列宽），恒展开；收起钮在此形态下隐藏（折叠
 *   归 VS Code chrome 管），frame CSS 按 aria-label 覆盖（官方便携类名是
 *   哈希的，aria-label 文案随官方词典稳定）。
 * - 设置入口 = **顶栏最右的齿轮**（#99 起由 workspace tree 插件渲染，经宿主能力口
 *   `openSettings` 触发——见 hostCapabilities.ts 的能力表与 settingsGearPlugin 的
 *   说明）；官方底部那一行（`sidebar.settings`，官方 SettingsRoot）由
 *   `@dsh-one/vscode-settings-gear` 影子渲染空件藏掉。设置页仍是独立编辑器页
 *   （@dsh-one/vscode-settings-shell）。
 * - 头部抛光（#70 VS Code 验收「很生硬」返修）：品牌位影子（brand.mark/name
 *   渲染空件 priority -1）+ logoRow 整行隐藏——VS Code 原生视图头已自报
 *   家门，官方 DeepSeek 品牌块重复且占 60px；折叠钮 aria-label 隐藏与
 *   logoRow 隐藏双保险；头部密度只微调（root 顶 padding 6→4px），官方
 *   其余默认不动。品牌块想换 DSH One 鲸鱼 logo 时，把两个
 *   空件换成渲染件即可（槽位贡献点不变）。
 * - 边缘贴齐（#70 验收「左右空条」返修）：官方根水平内边距 12px×2 是
 *   唯一布局级空条（左条 56–70px 实为树层级缩进：顶层行 28px、子代理行
 *   56–68px，是信息不是浪费）——root 选择器必须经插槽 wrapper（display:
 *   contents 的 div）下一级（> 直连选择器上一轮未命中即此因），把
 *   --dsh-sidebar-inline-padding 置 0：内容从左缘铺到右缘，滚动条贴右缘
 *   （Chrome 覆盖式滚动条，正常形态）。折叠钮/收起轨不是槽位贡献（钮是
 *   SidebarRoot 内部按钮、轨是 collapsed 态渲染，我们恒传 collapsed:false
 *   轨从不出现），CSS 隐藏即布局摘除，无列空间残留。
 * - 去掉官方「新会话」胶囊（#85 追加项，用户验收拍板）：官方把 New Session
 *   画在品牌行下面、工作区树上面，是**官方侧栏壳自己的按钮、不是槽位贡献**，
 *   我们只能按机制层 4 用 CSS 摘（官方无槽位/服务/seam 的举证写在 CSS 那条
 *   规则上方）。VS Code 形态下建会话由工作区行 hover 出的「+」与命令面板
 *   `dshOne.session.new` 承担，与 dsh-one 旧侧栏一致。**只在我们的 shell 里
 *   摘**：官方 web 形态（官方外框）胶囊照旧——这条差异是用户拍板的形态差异，
 *   不是对齐缺陷（护栏见 test/assemblyShellContract.test.ts）。
 *
 * 构建与打包约束同 clientEntry.ts（esbuild banner/footer 包自注册 IIFE，
 * externals 种子表满足）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { createLayoutStore, LayoutController, PANEL_INFO_SOURCE, ThemePresenter, type PanelActions, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface SidebarFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>) => unknown
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  inject: (actions: PanelActions) => Record<string, never>
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
    /** 官方 root 槽位钩子/数据发布口（官方 ui-layout 的 panelInfo 同款调用点）。 */
    provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
  }
  theme: { getTheme(): ThemeSnapshot }
}

/** 品牌位空件：single 槽最低优先级（-1 < 官方默认 0）顶掉 ui-brand-official。 */
function Nothing(): null {
  return null
}

// ---------------------------------------------------------------------------
// 密度偏好（#85 A 项）：VS Code 侧栏外框给容器设一组 CSS 变量，树插件
// （@dsh-one/dsh-workspace-tree）按 `var(--dsh-one-density-x, <官方原值>)` 消费。
//
// **为什么是 CSS 变量而不是 cordis 服务**：这是一份「宿主容器对内容的排版
// 偏好」，值本身是 CSS 长度、消费点全在样式里；用变量则零 JS 契约、零注册
// 时序、任何插件（含官方件）都能按需读，未设的项各自回落官方值；改用服务
// 反而要发明一套跨插件 JS 接口和订阅生命周期，收益为负。变量挂在 frame 容器
// 上，靠继承下发给容器内所有内容（树插件只读，不参与写入）。
//
// 数值口径：官方原值逐字取自官方 css-module（ui-workspace 的 Rows.module.css /
// WorkspaceBrowser.module.css；#104 扩出来的几件另取同族组件——分组胶囊取自
// ui-model-selection 的 ModelSelection.module.css），每个键的出处写在它自己那一段上面。
// （#137 起回收站入口行整套按旧侧栏规格取定值，退出这张表。）
// **VS Code 档（#113 起）分两条口径**（#134）：**行家族取官方标准档**（工作区行 / 会话行 /
// 搜索结果行 / 抽屉会话行等，两边同值），**菜单一侧仍取「官方紧凑档」**——官方 primitives
// （项 26px 高 / 5px 圆角 / 6px 间隙 / 7px 行内边距 / 12px 字号 / 18px 行高；列表 2px 容器
// 内边距，出处与举证见 workspaceTree/styles.ts 文件头的官方档位表）。此前那套按「VS Code
// 原生侧栏树观感」手调的数值（24 / 30 / 11px…）是自造的中间值，已全部换掉：现在每一处
// 几何要么是官方标准档（official 列）、要么是官方紧凑档（vscode 列），没有第三来源。
//
// **#134 起的口径（用户拍板，两句话同时成立）：行家族取官方标准档；菜单仍取官方紧凑档。**
// 用户在侧栏里实测后要的是「行参考官方侧栏自己的尺寸」，所以 #113 那条「行家族与菜单同档
// （紧凑档）」作废：工作区行 34px / 会话行 32px / 抽屉会话行 32px / 搜索结果行（最小高
// 48px）/ 列表里的会话溢出按钮 28px，加上行圆角 8px、行内边距 8px、标题 14px/20px、
// 行内图标位 16×20——每一项都是官方侧栏的原值（出处逐条写在各条目上方），这些键的
// **vscode 列 = official 列**。菜单这一侧不动：官方 `Menu` 仍传 `compact`，项还是 26px /
// 12px / 18px / 圆角 5px / 内边距 3px 7px（顶栏 / 分组过滤条 / 弹窗等其余控件也照旧走紧凑档）。
// 两条口径由 test/sidebarStyleScale.test.ts 分别判：行家族逐项「= 标准档里那一项同名量」，
// 菜单一侧仍「落在紧凑档里」。
//
// **#123 的一条（并入上面的行家族口径）**：标题文字（工作区名 / 会话标题 / 行内改名输入框 /
// 抽屉标题 / 回收站入口行文字）取官方标题档 14px/20px（`.YDXeBa_title`）——用户实测 12px
// 过于紧凑，要的是「标题与官方侧栏一致」。行盒 32/34px 装得下 20px 的行字，两件事同时成立。
// 行里的**元信息**（时间 / 计数）仍取紧凑档的 12px / 18px（#123 定的，本次没动）。
//
// **#119 起的一条分工：纵向留白取官方节奏、横向取紧凑档（行内容基准那两项除外）。** 表里
// **消费点全在 margin 上**的三项就是纵向留白（`section-header-gap` 用在顶栏那一行的下边距，
// `group-gap` 用在分组过滤条的下边距与块与块之间的上边距，`row-gap` 用在行与行之间——它
// 本来就是两边同值的 2px），前两项这次从紧凑档的 2px 改回**官方原值 4px**。理由：官方紧凑档
// 里并没有「块与块之间」的纵向刻度——那个 2px 是**菜单项彼此相接**的分隔线外边距
// （`._compactList_1nxmc_128 ._separator_1nxmc_82{margin:2px}`，项自身没有独立底色，相接
// 才对），照搬到有独立底色的行 / 块之间，会把顶栏那一行、分组过滤条、列表首行糊成一坨
// （用户实测反馈）。
// 每个键两边一致由 test/assemblyShellContract 的契约测试守着（表里的 official 必须等于树
// 插件 CSS 的兜底字面量、键集两边相等、VS Code 档不得大于官方档）；「行家族项 = 标准档、
// 纵向留白项 = 官方原值、其余项仍落紧凑档、official 列全在标准档」由
// test/sidebarStyleScale.test.ts 显式表达（行家族那几项按「= 标准档里那一项**同名量**」判，
// 不是「值在标准档里出现过」——同一批里 `row-height` 的 34px 与 `row-radius` 的 8px 都是
// 标准档的量，按集合判会互相蒙混）。
// **观感语言（图标/颜色/字体族/动效）不在这张表里**——那些继续逐字沿用官方；进表的唯一
// 圆角是行圆角 `row-radius`（#113 起；#134 后它两边同值 8px，留着是因为 F-04 的对齐口径
// 按「把变量对齐回树插件自己声明的官方兜底值」量，这一项得跟着走完这条路）。
// ---------------------------------------------------------------------------

/**
 * 密度档：键 = 变量后缀，official = 官方原值（与树插件 CSS 兜底同源），vscode = VS Code 档。
 * vscode 缺省是官方紧凑档；例外逐项写在各自条目上方——#134 的行家族（取官方标准档，两边
 * 同值）、#119 的纵向留白三项（取官方原值）、#123 的元信息（仍紧凑档）。
 */
export const DENSITY_PROFILE: Readonly<Record<string, { official: string; vscode: string }>> = {
  // 工作区行行高：官方 `.YDXeBa_projectRow{height:34px}`。**#134 起 VS Code 档 = 官方原值**
  // （行家族取标准档，不再跟菜单的 26px）。**弹窗里的行不吃这个键**（管理分组对话框的行固定
  // 26px，理由写在 styles.ts 那条规则上方）。
  'row-height': { official: '34px', vscode: '34px' },
  // 会话行行高：官方 `.YDXeBa_sessionRow{height:32px}`（主树会话行与抽屉会话行共用）。
  // **#134 起 VS Code 档 = 官方原值**——两个行种仍是同一个键，但不再是「同高」的理由：
  // 官方侧栏里工作区行 34px、会话行 32px，本来就差 2px。
  'session-row-height': { official: '32px', vscode: '32px' },
  // 行间空隙：**取标准档的 2px**（官方 `.bhn1Oq_flatList>*+*{margin-top:2px}`），不取紧凑档
  // 列表的 `gap:0`——那是菜单项彼此相接的形态（项自身没有独立底色），我们的行是独立可悬停
  // 的条目，官方侧栏给它们留的正是这 2px。
  'row-gap': { official: '2px', vscode: '2px' },
  // 块间纵向空隙（分组过滤条的下边距；工作区分块 / 抽屉分块之间的上边距）：官方
  // `.bhn1Oq_groupSection+.bhn1Oq_groupSection{margin-top:4px}`——官方侧栏里一块与下一块之间
  // 就是这 4px。**VS Code 档同样取 4px（纵向取官方节奏，见文件头 #119）**：这里此前跟横向一起
  // 砍成紧凑档的 2px，用户实测顶栏 / 过滤条 / 首行一带太挤。
  'group-gap': { official: '4px', vscode: '4px' },
  // 行内边距：官方 `.YDXeBa_projectRow,.YDXeBa_sessionRow{padding:0 8px}`。**#134 起 VS Code 档
  // = 官方原值**（行家族取标准档）。它同时是**行内容基准**：骨架区与行形件的左缘都按这一项
  // 对齐（顶栏搜索框 / 分组过滤条 / 选择态动作条 / 抽屉头与块头 / 行尾层），所以这些消费点跟着
  // 行一起从 7px 变到 8px——它们要的就是「和行的文字左缘同一条竖线」。
  'row-padding-inline': { official: '8px', vscode: '8px' },
  // 行高（分节头 / 抽屉头）：紧凑档行高 26px——一列里只有这一种「一个控件的高度」，
  // 搜索框与图标按钮都按它对齐（比它高的东西会把这一行撑破）。
  'section-header-height': { official: '36px', vscode: '26px' },
  // 顶栏那一行（分节头）的下边距：官方 `.bhn1Oq_sectionHeader{…;margin-bottom:4px;…}`——官方
  // 分节头与它下面那一段之间的纵向留白。**VS Code 档同样取 4px（纵向取官方节奏，见文件头 #119）**。
  'section-header-gap': { official: '4px', vscode: '4px' },
  // 标题文字（工作区名 / 会话标题 / 行内改名输入框 / 抽屉标题 / 回收站入口行文字，五处共用一个键）：
  // **两边同值，取官方标题档**——官方 `.YDXeBa_title{font-size:14px;line-height:20px}`。
  // #123 立这一条时它还只是「几何跟菜单同档、文字例外」；**#134 起它是行家族口径的一部分**
  // （行家族整套取官方标准档，标题就在其中），所以「与菜单同档」这句话整体作废、不再有例外之说。
  // 行盒 32/34px 装得下 20px 的行字，两件事同时成立。
  'title-font-size': { official: '14px', vscode: '14px' },
  'title-line-height': { official: '20px', vscode: '20px' },
  // 行字数：元信息（时间 / 计数 / 抽屉计数…）取紧凑档字号 12px / 文字行高 18px
  // （官方 `._item_1nxmc_92{font-size:12px;line-height:18px}`）；官方原值本来就 12px，
  // 这一项两边同值（不再压到 11px）。**#134 没动它**：用户点的是行的尺寸，行内元信息仍按
  // #123 定的紧凑档（搜索结果行里那一段 17px 行高是官方给 `_searchResultSnippet` 自己的量，
  // 写在树插件的 CSS 里，不占这个键）。
  'meta-font-size': { official: '12px', vscode: '12px' },
  'meta-line-height': { official: '20px', vscode: '18px' },
  // 列表底部留白：紧凑档的项内边距 7px（同一档里「内容与容器边之间」的那个留白值）。
  'list-padding-bottom': { official: '16px', vscode: '7px' },
  // 会话溢出按钮行高（列表末尾那条「还有 N 个会话」）：官方
  // `.bhn1Oq_sessionOverflowButton{height:28px}`。它是**行家族一员**（本身就是列表里的一行），
  // #134 起 VS Code 档 = 官方原值 28px。
  'overflow-row-height': { official: '28px', vscode: '28px' },
  // 图标按钮 / 搜索框：高度对齐紧凑档行高 26px——它们住在**骨架区那一行**（顶栏 / 抽屉头）里，
  // 那一行自己就是紧凑档的 26px，控件比它高会把这一行撑破。（#134 只把行家族放到标准档，
  // 骨架区没动；这两个键的官方原值 28px 留在表里当兜底。）
  'icon-button-size': { official: '28px', vscode: '26px' },
  'search-height': { official: '28px', vscode: '26px' },
  'search-expanded-height': { official: '30px', vscode: '26px' },
  // 搜索结果行的最小高：行家族一员，官方 `.YDXeBa_searchResultRow{min-height:48px}`——#134 起
  // VS Code 档 = 官方原值。这一行是两行内容块（标题 20px + 元信息 17px + 上下内边距 4px×2），
  // 平时由内容撑到 45px 上下，48px 是它自己的下限。
  'search-row-min-height': { official: '48px', vscode: '48px' },
  // ---- #104：从「列表行」扩到骨架其余四区（顶栏 / 分组过滤条 / 回收站入口行 / 抽屉）----
  // 每项的官方原值都取自官方**同族组件**的规则，出处逐条写在下面。
  //
  // 顶栏（+ 抽屉头、过滤条共用的两条骨架基线）：官方 ui-workspace 的
  // WorkspaceBrowser.module.css——`bhn1Oq_sectionHeader{padding-left:4px}` 是分节头
  // 的左侧基线（我们顶栏那一行就照官方分节头做的），`bhn1Oq_sectionHeader{gap:4px}`
  // 与 `bhn1Oq_headerActions{gap:4px}` 是同一条行内间隙（官方模型选择菜单的胶囊触发
  // 器 `_7KE1Ra_trigger{gap:4px}` 也是这个值）。两项的 VS Code 档取**紧凑档的容器内边距
  // 2px**：紧凑档里横向只有两个值——项内边距 7px（控件内部）与容器内边距 2px（控件之间 /
  // 控件与容器边），控件的间隔取后者。
  'section-padding-inline': { official: '4px', vscode: '2px' },
  'section-gap': { official: '4px', vscode: '2px' },
  // 分组过滤条的胶囊：官方同一形态的胶囊触发器在 ui-model-selection 的
  // ModelSelection.module.css——`_7KE1Ra_trigger{height:28px;gap:4px;padding:0 4px 0
  // 8px;font-size:13px}`（官方那个「模型名 + ▾」的圆角胶囊，与我们分组胶囊同形）。
  // VS Code 档整套取紧凑档（高 26px / 字号 12px 与菜单项同高同字；左内边距取项内边距 7px，
  // 右内边距（▾ 那一侧）取容器内边距 2px）。
  'pill-height': { official: '28px', vscode: '26px' },
  'pill-font-size': { official: '13px', vscode: '12px' },
  'pill-padding-start': { official: '8px', vscode: '7px' },
  'pill-padding-end': { official: '4px', vscode: '2px' },
  // 回收站入口行的行高**不再走这张表**（#137）：那一行整套按旧侧栏规格取定值，高度由
  // 「7px 纵向内边距 + 标题行高 20px + 7px」撑出 34px，不随宿主密度变。这里原本有一条
  // `footer-row-height`（官方同座位条目 `Nqubda_badge{height:42px}` / VS Code 档 26px），
  // 随之一并退场——树侧不再消费它，留着会让「键集两边一致」这条契约断掉。
  // 抽屉里「按工作区分块」的块头高度：官方列表里的分组块头是 ui-model-selection 的
  // `_7KE1Ra_groupTitle{padding:5px 8px 3px;font-size:12px;line-height:18px}`，总高
  // 5+18+3=26px（上下内边距 + 行高）；我们那行是定高一行的，取它的总高。VS Code 档取
  // **紧凑档的分组标题盒 24px**（官方 compact 档 `._label_1nxmc_124{padding:4px 7px}` +
  // `line-height:16px` = 4+16+4）。
  'drawer-block-header-height': { official: '26px', vscode: '24px' },
  // 行圆角（#113 新增，唯一进这张表的圆角）：官方侧栏行是 8px
  // （`YDXeBa_projectRow,YDXeBa_sessionRow{border-radius:8px}`）。**#134 起 VS Code 档 =
  // 官方原值**（行家族取标准档，紧凑档那个 5px 不再用于行）。这个键留着而不是写死 8px：
  // F-04 的对齐口径是「把密度变量对齐回树插件自己声明的官方兜底值再逐项比」，行圆角在那条路
  // 上要跟得动；它同时还是**行形件共用的圆角**（溢出按钮 / 搜索行 / 入口行主区 / 抽屉块头），
  // 一处改、这一族一起走。
  'row-radius': { official: '8px', vscode: '8px' },
}

/** 密度档 → 一条 CSS 规则（挂在 frame 上，容器内所有插件经继承拿到）。 */
export const DENSITY_CSS =
  '.dshOneSidebarShell_frame{' +
  Object.entries(DENSITY_PROFILE)
    .map(([key, value]) => `--dsh-one-density-${key}:${value.vscode}`)
    .join(';') +
  '}'

// ---------------------------------------------------------------------------
// 样式：侧栏列 100% 流体（右边线保留，与官方 sidebarCol 视觉一致）；收起钮/
// 收起轨隐藏——VS Code WebviewView 形态无「内页收起」概念，折叠由 VS Code
// chrome 负责。aria-label 选择器覆盖官方便携类（哈希类名不可依赖）。
// ---------------------------------------------------------------------------

// logoRow 隐藏用 [class*="logoRow"]（css-module 名后缀稳定、哈希前缀随版本变）；
// 折叠钮 aria-label 规则保留作双保险（zh/en 双词典，CSS 转义写中文）。
//
// 官方「新会话」胶囊的摘除（#85 追加项）为什么走机制层 4（CSS），逐层举证：
// - **层 1（官方槽位机制）没有这个槽**：读官方 `@deepseek-ai/dsh-client-ui-sidebar`
//   0.1.6-alpha.1 的 `lib/types/client/contract/slots.d.ts`——SlotMap 只声明六个
//   空位（sidebar.brand.mark / sidebar.brand.name / sidebar.panellist /
//   sidebar.workspaces / sidebar.settings / sidebar.footer.action），没有 New
//   Session；该文件原文也写明「The shell owns column geometry, the brand row,
//   New Session, and global panel rows」，即它归侧栏壳自己。同一包的
//   `lib/client.js` 里该按钮是 SidebarRoot 的无条件 JSX（紧跟 logoRow、className
//   取自 css-module 的 `newSession`），没有任何 prop 开关。
//   层 1 的「同名槽位遮蔽」在这里等于顶替官方侧栏壳的角色——品牌位、全局面板行、
//   工作区与设置两个座位、底部动作条、收起轨都得我们自己渲染，与 AGENTS.md 铁律
//   「优先与官方插件共存，不顶替其角色」相抵；为摘一个按钮不值得。
// - **层 2/3 没有对应服务 API 与 seam**：官方没有「隐藏 New Session」这类入口。
// - 于是只剩层 4：按 css-module 名后缀定位、display:none。稳定性风险与 logoRow
//   那条同源——哈希前缀（hHd-Xa_）随官方构建变，后缀 `newSession` 是源码里的
//   名字，上游改名时这条规则会静默失效（届时官方胶囊会重新出现），随官方版本
//   核对；规则只摘呈现，不碰官方组件与它注入的 startSession。
const CSS =
  '.dshOneSidebarShell_frame,.dshOneSidebarShell_side,.dshOneSidebarShell_side>div{padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important}.dshOneSidebarShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;overflow:hidden;position:relative}.dshOneSidebarShell_side{flex:1;min-width:0;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);overflow:hidden}.dshOneSidebarShell_side [class*="logoRow"]{display:none}.dshOneSidebarShell_side>div>[class*="root"]>[class*="newSession"]{display:none}.dshOneSidebarShell_side button[aria-label="Collapse sidebar"],.dshOneSidebarShell_side button[aria-label="\\6536\\8d77\\4fa7\\680f"]{display:none}.dshOneSidebarShell_side>div>[class*="root"]{--dsh-sidebar-inline-padding:0px;padding-top:4px;max-width:none!important;margin-left:0!important;margin-right:0!important}.dshOneSidebarShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}' +
  DENSITY_CSS
const CSS_TAG_ID = '@dsh-one/vscode-sidebar-shell/SidebarFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-sidebar-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// 骨架链几何快照（#70 自诊断构建）：实验室与真实 webview 出现「同文档不同
// 结果」（用户侧左侧 ~15-20px 空条 + 细竖线，实验室任何宽度 padL/R=0 贴缘）——
// 停止猜测，把 body→frame→side→wrapper→官方根 每层的 left/right/padding/
// margin/border 打出来：浏览器直接 console.log，webview 经诊断探针
// __DSH_ONE_PROBE__ 转给宿主输出面板（[assembly] 前缀频道）。只打一次，
// 首拍等不到骨架（官方根挂载晚）就再试两拍。
// ---------------------------------------------------------------------------

const GEOMETRY_LAYERS = [
  { label: 'body', selector: 'body' },
  { label: 'frame', selector: '.dshOneSidebarShell_frame' },
  { label: 'side', selector: '.dshOneSidebarShell_side' },
  { label: 'wrapper', selector: '.dshOneSidebarShell_side>div' },
  { label: 'official-root', selector: '.dshOneSidebarShell_side>div>[class*="root"]' },
] as const

function reportGeometry(): void {
  const emit = (line: string): void => {
    console.log(line)
    const probe = (globalThis as { __DSH_ONE_PROBE__?: { log(level: string, text: string): void } }).__DSH_ONE_PROBE__
    if (probe) probe.log('info', line)
  }
  const vw = document.documentElement.clientWidth
  emit(`[assembly] geometry viewport width=${vw}`)
  for (const layer of GEOMETRY_LAYERS) {
    const el = document.querySelector(layer.selector)
    if (el === null) {
      emit(`[assembly] geometry ${layer.label} MISSING (selector ${layer.selector})`)
      continue
    }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    emit(
      `[assembly] geometry ${layer.selector} l=${Math.round(r.left)} r=${Math.round(r.right)} w=${Math.round(r.width)}` +
        ` padL=${cs.paddingLeft} padR=${cs.paddingRight} mL=${cs.marginLeft} mR=${cs.marginRight}` +
        ` bL=${cs.borderLeftWidth} bR=${cs.borderRightWidth} disp=${cs.display}`,
    )
  }
}

function scheduleGeometrySnapshot(): void {
  let tries = 0
  const attempt = (): void => {
    tries += 1
    if (document.querySelector('.dshOneSidebarShell_side>div>[class*="root"]') !== null || tries >= 3) {
      reportGeometry()
      return
    }
    setTimeout(attempt, 900)
  }
  setTimeout(attempt, 1800)
}

/**
 * 侧栏位 frame：整列渲染官方侧栏槽。宽度 = 容器实测宽（ResizeObserver），
 * 恒展开传 collapsed:false——官方 SidebarRoot 按 width 参数定列宽，240px
 * 窄宽也完整（内容区自适应，不闪现收起轨）。
 */
function SidebarFrame({ renderSlot }: SidebarFrameProps) {
  const sideRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    const el = sideRef.current
    if (el === null) return
    const measure = (): void => {
      const next = el.clientWidth
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return h(
    'div',
    { className: 'dshOneSidebarShell_frame', 'data-shell': 'dsh-one-sidebar' },
    h('div', { className: 'dshOneSidebarShell_side', ref: sideRef }, renderSlot('sidebar', { collapsed: false, width })),
    h('div', { className: 'dshOneSidebarShell_overlay', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：inject ['slots','theme']；apply = layout 服务 + root 注册
// + ThemePresenter（结构与 label 照官方 ui-layout 两段）
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme']

export function apply(ctx: ShellContext): void {
  scheduleGeometrySnapshot()
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制）。0.1.6 的官方
    // 会话树（ui-workspace 的 SessionTree/FlatList/SearchResults）以
    // `usePanelInfo((info) => info.activePanelId !== null)` 判定当前会话行是否
    // 高亮；官方框架插件 ui-layout 被下线后无人提供这份钩子，槽位挂载即抛
    // `usePanelInfo is not a function`，会话列表整块消失（#76 现场实锤）。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        children: {
          sidebar: { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      SidebarFrame,
    )
    // 品牌位影子：藏掉官方 DeepSeek 品牌块（VS Code 原生视图头已自报家门，
    // 双重品牌头「很生硬」#70 验收返修）。想换自有品牌时把 Nothing 换成渲染件。
    const disposeBrandMark = ctx.slots.inject('sidebar.brand.mark', () =>
      ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, Nothing),
    )
    const disposeBrandName = ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, Nothing),
    )
    return () => {
      disposeBrandMark()
      disposeBrandName()
      disposeRegistration()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one sidebar shell: layout service + panel-info hook + root registration + brand shadow')
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => {
      presenter.apply(snapshot)
    })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'dsh-one sidebar shell: theme presenter')
}
