/**
 * 装配骨架与官方外框契约的对照测试（#76）：
 * 三棵树的 block list 都下线了官方 `dsh-client-ui-layout`，官方外框原本下发给
 * root 槽位的契约就得由自有骨架提供。0.1.6 漏掉 `panelInfo` 钩子导致侧栏会话
 * 列表整块消失（#76），漏掉 root 子槽 `main` 又让官方对话子树整块注册失败（#74），
 * 所以这里把「接手的契约」写成可执行的清单——源码级核对（与
 * pluginLocales.test.ts 同款做法：这些插件运行时依赖 react / 官方私有包，
 * 单测里 import 不进来，只能扫源码）。
 *
 * 清单来源：官方 `dsh-client-ui-layout` 0.1.6 的 `client.js` apply() 与
 * `lib/types/client/{index,service,stores}.d.ts`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SHELL_DIR = path.join(import.meta.dirname, '..', 'src', 'ui', 'assembly', 'shell')

const read = (file: string): string => fs.readFileSync(path.join(SHELL_DIR, file), 'utf8')

/**
 * 侧栏工作区树的全部源码：#99 把插件本体拆成 `workspaceTreePlugin.ts`（注册与组合）
 * + `workspaceTree/` 下的分件（行、工具栏、分组条、选择态、抽屉、对话框、样式…）；
 * #94 起整棵树的源码住在本包里（`packages/dsh-workspace-tree/src/`）。
 * 本文件的三条树断言按「整棵树」扫源码，所以要拼起来读——拆文件、搬家都不改变断言口径。
 */
const TREE_DIR = path.join(import.meta.dirname, '..', 'packages', 'dsh-workspace-tree', 'src')

const TREE_SOURCE = ((): string => {
  const dir = path.join(TREE_DIR, 'workspaceTree')
  const parts = [fs.readFileSync(path.join(TREE_DIR, 'workspaceTreePlugin.ts'), 'utf8')]
  for (const name of fs.readdirSync(dir).sort()) parts.push(fs.readFileSync(path.join(dir, name), 'utf8'))
  return parts.join('\n')
})()

/** 三棵树的 frame 插件（官方 ui-layout 的角色承担者）。 */
const SHELLS = ['chatLayoutPlugin.ts', 'sidebarLayoutPlugin.ts', 'settingsLayoutPlugin.ts']

test('三棵树的 frame 插件都提供官方 root 槽位钩子 panelInfo（#76 现场缺陷）', () => {
  for (const file of SHELLS) {
    const text = read(file)
    assert.match(text, /provideRoot\(\{\s*hooks:\s*\{\s*panelInfo:|provideRoot\(\{\s*hooks:\s*\{\s*panelInfo\s*\}/, `${file} 必须经 ctx.slots.provideRoot 提供 panelInfo`)
    assert.match(text, /PANEL_INFO_SOURCE/, `${file} 的 panelInfo 源必须取共享件 PANEL_INFO_SOURCE`)
    assert.match(text, /disposePanelInfo\(\)/, `${file} 必须在 effect 清理里撤销 panelInfo 贡献`)
  }
})

test('panelInfo 源：快照形状与官方 PanelInfo 一致、引用稳定、可撤销订阅', () => {
  const text = read('frameShared.ts')
  // 官方 stores.d.ts 的 PanelInfo = { activePanelId: MainPanelId | null }
  assert.match(text, /activePanelId:\s*string \| null/, 'panelInfo 快照必须带 activePanelId 字段')
  // 快照必须是模块级常量：官方把它交给 useSyncExternalStoreWithSelector，
  // 每次 getSnapshot 返回新对象会无限重渲。
  assert.match(text, /const PANEL_INFO_SNAPSHOT:\s*PanelInfoSnapshot\s*=\s*\{\s*activePanelId:\s*null\s*\}/, '快照必须是模块级常量')
  assert.match(text, /getSnapshot:\s*\(\)[^=>]*=>\s*PANEL_INFO_SNAPSHOT/, 'getSnapshot 必须返回同一个引用')
  assert.match(text, /subscribe:[\s\S]{0,120}?=>\s*\(\)\s*=>\s*\{\}/, 'subscribe 必须返回可调用的撤销函数')
})

test('layout 服务面覆盖官方 ILayout 全成员（官方 service.d.ts 清单）', () => {
  // 官方 0.1.6 ILayout：selectPanel / beginNavigation / toggleSidebar /
  // openRightbar / closeRightbar（加官方类的 dispose）。
  const official = ['selectPanel', 'beginNavigation', 'toggleSidebar', 'openRightbar', 'closeRightbar', 'dispose']
  const text = read('frameShared.ts')
  const classBody = /export class LayoutController \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
  for (const member of official) {
    assert.ok(
      new RegExp(`\\b${member}\\s*\\(`).test(classBody),
      `LayoutController 必须实现官方 ILayout 成员 ${member}（）`,
    )
  }
  // 官方语义（#95）：非 null 的目标按 keyed `main` 的实时注册表判合法性——官方
  // ui-layout 的构造点就是 `new LayoutController(instance.actions, (id) =>
  // ctx.slots.entries("main").some((entry) => entry.options.key === id))`，只有
  // 注册表里没有这个 key 才照官方原句抛错（不能一律拒绝非 null）。
  assert.match(classBody, /#hasMainPanel\(panelId\)/, 'selectPanel 的合法性判据必须查 keyed main 注册表')
  assert.match(classBody, /layout\.selectPanel: main panel/, 'selectPanel 的非法目标要照官方文案抛错')
  // beginNavigation 必须作废上一次导航（AbortController 语义）。
  assert.match(classBody, /new AbortController\(\)/, 'beginNavigation 必须给出可作废的 AbortSignal')
})

test('chat 树：会话面板两版槽位都声明（0.1.2 的 single conversation / 0.1.6 的 keyed main）', () => {
  const text = read('chatLayoutPlugin.ts')
  assert.match(text, /conversation:\s*\{\s*kind:\s*'single',\s*scope:\s*'session-maybe'\s*\}/, '0.1.2 线的 single conversation 槽位要保留')
  assert.match(text, /main:\s*\{\s*kind:\s*'keyed',\s*scope:\s*'root'\s*\}/, '0.1.6 线的 keyed main 槽位要声明')
  // 渲染取键方式与官方 AppFrame 的 MainPanel 一致：activePanelId ?? 'conversation'
  assert.match(text, /renderSlot\('main', \{\}, \{ entryKey: activePanelId \?\? 'conversation' \}\)/, 'main 槽位必须按官方取键渲染')
  assert.match(text, /renderSlot\('conversation', \{\}\)/, 'single conversation 槽位要保留渲染分支')
})

// #74 现场缺陷：settings 树漏声明 keyed `main`。官方大件把整棵子树挂在
// `slots.inject('<槽位名>', …)` 上（ui-conversation 挂 `main`，
// dsh-client-ui-conversation/lib/client.js:16917），它声明的子树里才有
// `conversation.hero.agentPreset` 等座位名；声明表缺一项，挂在下面的官方子树
// 整块注册失败（agent-preset 的会话级 scope 抛 `slot … is not declared`，
// fiber 进 FAILED 并泄漏已注册的 sessions 订阅）。设置页不渲染对话区，但必须声明。
// #95：这个座位同时成了设置页自己的座位——设置页是 `main` 上一条 key =
// `dshOne.settings` 的 keyed 条目（此前是自造槽位 `dshOne.settings.page`）。
test('settings 树：设置页 = 官方 keyed main 上 key `dshOne.settings` 的条目（#74 声明 + #95 座位）', () => {
  const text = read('settingsLayoutPlugin.ts')
  assert.match(text, /main:\s*\{\s*kind:\s*'keyed',\s*scope:\s*'root'\s*\}/, 'keyed main 槽位要声明（官方 ui-conversation 的子树注册等它）')
  assert.match(text, /const SETTINGS_MAIN_KEY = 'dshOne\.settings'/, '设置页的面板 key 要显式声明成常量')
  assert.match(
    text,
    /ctx\.slots\.inject\('main',[\s\S]{0,400}?name: 'main',\s*\n\s*key: SETTINGS_MAIN_KEY/,
    "设置页要经官方 slots.inject('main', …) 等座位声明后注册 keyed 条目",
  )
  assert.match(text, /renderSlot\('main', \{\}, \{ entryKey: SETTINGS_MAIN_KEY \}\)/, 'main 槽位要按官方 entryKey 取键渲染')
  assert.match(text, /layout\.selectPanel\(SETTINGS_MAIN_KEY\)/, '注册后要按官方 key 语义选中设置页')
  // #95：自造槽位名撤掉——注册点与渲染点都不许再出现它。
  assert.ok(!/name:\s*'dshOne\.settings\.page'/.test(text), '自造槽位 dshOne.settings.page 不得再注册')
  assert.ok(!/renderSlot\('dshOne\.settings\.page'/.test(text), '自造槽位 dshOne.settings.page 不得再渲染')
})

// #85 A 项（侧栏树密度适配）：shell 给偏好、树插件消费、缺省回落官方档。
// 两边是两份源码，键集与官方原值靠这条测试对齐——shell 加的键没人消费、树消费的
// 键 shell 没设、兜底值抄错（覆盖了官方档）都会在这里挂。
test('密度偏好：shell 设的键集 = 树插件消费的键集，且树兜底逐项等于官方原值', () => {
  const shell = read('sidebarLayoutPlugin.ts')
  const profile = new Map(
    [...shell.matchAll(/'([a-z-]+)':\s*\{\s*official:\s*'([^']+)',\s*vscode:\s*'([^']+)'\s*\}/g)].map((m) => [
      m[1],
      { official: m[2], vscode: m[3] },
    ]),
  )
  assert.ok(profile.size >= 10, `shell 的 DENSITY_PROFILE 至少要有 10 项（实际 ${profile.size}）`)
  const tree = TREE_SOURCE
  const consumed = new Map([...tree.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g)].map((m) => [m[1], m[2]]))
  assert.ok(consumed.size >= 10, `树插件消费的密度变量至少要有 10 项（实际 ${consumed.size}）`)
  assert.deepEqual(
    [...consumed.keys()].sort(),
    [...profile.keys()].sort(),
    'shell 设的键集必须与树插件消费的键集一致',
  )
  for (const [key, fallback] of consumed) {
    assert.equal(fallback, profile.get(key)?.official, `--dsh-one-density-${key} 的兜底必须是官方原值（缺省即官方档）`)
  }
  // VS Code 档必须真的更紧，不是照抄官方值（照抄等于本次适配没生效）。
  const numeric = (v: string): number => Number.parseFloat(v)
  for (const [key, value] of profile) {
    assert.ok(numeric(value.vscode) <= numeric(value.official), `${key} 的 VS Code 档不得大于官方档`)
  }
  assert.ok(
    [...profile.values()].some((value) => numeric(value.vscode) < numeric(value.official)),
    '至少有一项 VS Code 档比官方档紧',
  )
  // 变量挂在 frame 容器上（容器内所有插件经继承拿到），且只带尺寸、不带颜色观感。
  assert.match(shell, /export const DENSITY_CSS =\s*'\.dshOneSidebarShell_frame\{'/, '密度变量必须挂在 frame 容器选择器上')
  for (const [key, value] of profile) {
    assert.ok(!/^#|rgb|var\(/.test(value.vscode), `密度值必须是长度字面量（${key}）`)
  }
})

// #104（密度档从「列表行」扩到骨架其余四区：顶栏 / 分组过滤条 / 回收站入口行 / 抽屉）：
// 上面那条守「键集两边一致 + 兜底 = 官方原值」，这条补两件事——
// ① 新键确实挂在**对应区域**的规则上（写在别处等于没扩散到那一区）；
// ② 每项 VS Code 档**严格**小于官方原值（两边同值 = 这一项其实没紧凑）。
test('密度档扩散（#104）：四区新键各挂各的规则，且每项 VS Code 档严格更紧', () => {
  const tree = TREE_SOURCE
  const shell = read('sidebarLayoutPlugin.ts')
  const profile = new Map(
    [...shell.matchAll(/'([a-z-]+)':\s*\{\s*official:\s*'([^']+)',\s*vscode:\s*'([^']+)'\s*\}/g)].map((m) => [
      m[1],
      { official: m[2] ?? '', vscode: m[3] ?? '' },
    ]),
  )
  // 键 → 它必须出现（消费）在哪些规则里：区域专属键一条，跨区共用的骨架基线列出全部消费点。
  // #137 的两处退场：`footer-row-height` 整条退场（回收站入口行不再走密度档，见下），
  // `section-padding-inline` 的消费点少一处——入口行盒的右侧 8px 是旧侧栏规格的定值。
  const SPREAD: ReadonlyArray<{ key: string; rules: readonly string[] }> = [
    {
      key: 'section-padding-inline',
      // #125 起这项只用在**右内缩**（入口行 / 抽屉头 / 抽屉列表）与顶栏那一行的左内缩上：
      // 过滤条、入口行、抽屉列表的**左**内缩改成「行内容基准」（`row-padding-inline`），因为
      // 那三处的内容是行家族（行自己带行内边距），容器再加一道会把整列推右一格。
      // **#137 起入口行也退出这份名单**：那一行整套按旧侧栏规格取定值（右侧固定 8px），
      // 不再读这一项。
      // **#135 起过滤条又回到这份名单**：它从列表区搬进顶栏那一行（行首那一件），左内缩要
      // 拆成两半——先用 `margin-left` 把自己从那一行的骨架基线拉到容器左缘（-1 × 这一项），
      // 再用 `padding-left` 铺出行内容基准。所以它现在**消费**这一项，只是消费在 `margin` 上
      // （挂在 `.dshOneTree_filterBar` 的规则里，下面按规则名核得到）。左缘对齐的断言在装配
      // 实验室的 F-35 / F-39 里按几何矩形判，不在这一条（这一条只管键挂到了哪些规则上）。
      rules: ['dshOneTree_sectionHeader', 'dshOneTree_drawerHeader', 'dshOneTree_drawerList', 'dshOneTree_filterBar'],
    },
    {
      key: 'section-gap',
      rules: ['dshOneTree_sectionHeader', 'dshOneTree_headerActions', 'dshOneTree_filterBar', 'dshOneTree_pill', 'dshOneTree_drawerHeader'],
    },
    { key: 'pill-height', rules: ['dshOneTree_pill'] },
    { key: 'pill-font-size', rules: ['dshOneTree_pill'] },
    { key: 'pill-padding-start', rules: ['dshOneTree_pill'] },
    { key: 'pill-padding-end', rules: ['dshOneTree_pill'] },
    // #144 的退场：`drawer-block-header-height` 随抽屉块头与侧栏工作区行收敛（块头改吃行族的
    // `row-height`）而整条退场——树侧不再消费它，所以这里也不再登记（登记了会在上面那条
    // 「键集两边一致」里红）。
  ]
  const numeric = (v: string): number => Number.parseFloat(v)
  for (const { key, rules } of SPREAD) {
    const entry = profile.get(key)
    assert.ok(entry !== undefined, `shell 的 DENSITY_PROFILE 要有 #104 新键 ${key}`)
    for (const rule of rules) {
      assert.match(
        tree,
        new RegExp(`\\.${rule}\\{[^}]*var\\(--dsh-one-density-${key},`),
        `${key} 必须挂在 .${rule} 的规则上（树侧的消费点）`,
      )
    }
    assert.ok(
      numeric(entry?.vscode ?? '') < numeric(entry?.official ?? ''),
      `${key} 的 VS Code 档必须严格小于官方原值（同值等于这一区没紧凑）`,
    )
  }
})

// #85 B 项（悬停卡遮挡）：树插件按「容器右侧有没有 244+8px 空处」决定渲不渲染
// 官方悬停卡；shell 不得再用 CSS 把官方卡片钉进容器（上一版的做法，正是用户
// 反馈的「遮挡内容」）。
test('悬停卡：官方卡几何常数取自官方实现，且 shell 不再用 CSS 钉住卡片', () => {
  const tree = TREE_SOURCE
  assert.match(tree, /const HOVER_CARD_WIDTH = 244/, '卡宽取官方 css-module 的固定 244px')
  assert.match(tree, /const HOVER_CARD_GAP = 8/, '定位间隙取官方实现的 anchor.right + 8')
  assert.match(tree, /available >= HOVER_CARD_WIDTH \+ HOVER_CARD_GAP/, '判据 = 容器到视口右缘的余量 ≥ 卡宽 + 间隙')
  // 两个行组件的浮层包裹都要过这道闸（会话行、工作区行）。
  assert.equal(
    [...tree.matchAll(/if \([^)]*!hoverCard[^)]*\) return row/g)].length,
    2,
    '会话行与工作区行都必须按 hoverCard 闸门决定渲不渲染浮层',
  )
  const shell = read('sidebarLayoutPlugin.ts')
  assert.ok(!/_card_/.test(shell), 'shell 不得再用 CSS 钉住官方悬停卡（遮挡的成因）')
})

// #85 追加项（用户验收拍板去掉顶部「新会话」胶囊）：官方把 New Session 画在侧栏壳
// （ui-sidebar 的 SidebarRoot）自己身上——不是槽位贡献（官方 0.1.6-alpha.1 的
// slots.d.ts 里没有它的槽，举证写在 sidebarLayoutPlugin.ts 的 CSS 上方），只能按
// 机制层 4 用 CSS 摘。这条测试守住边界：规则在 shell 且作用域限官方侧栏壳，树插件
// 不掺和——官方 web 形态（无我们的 shell）胶囊照旧，dsh-* 树插件保持可移植。
test('官方「新会话」胶囊：只在 shell 的 CSS 里摘，树插件不掺和（可移植边界）', () => {
  const shell = read('sidebarLayoutPlugin.ts')
  assert.match(
    shell,
    /\.dshOneSidebarShell_side \[data-dshone-official-root\]>\[class\*="newSession"\]\{display:none\}/,
    'shell 必须有摘掉官方新会话胶囊的 CSS 规则，且作用域限在官方侧栏壳（side 下我们标了 data-dshone-official-root 的官方根）',
  )
  assert.match(shell, /dsh-client-ui-sidebar/, '规则上方必须点明举证来源（查过的官方包与文件）')
  assert.match(shell, /哈希前缀/, '注释要写明类名稳定性风险：css-module 后缀稳定、哈希前缀随版本变')
  const tree = TREE_SOURCE
  assert.ok(!/class\*="newSession"/.test(tree), '树插件不得掺和官方胶囊的摘除（同一份插件还要在官方 web 形态里跑）')
})

// #178 C10+C11：设置页里两处「官方件不进我们的页」原先按 CSS 结构伪类认件
// （`>*:has(button[aria-pressed])` 摘外观行、`>*:not(:has([data-dshone-doc-action]))`
// 摘官方那条「打开配置文件」）。当时的判断是「list 槽位同 id 无法遮蔽」，审计实测
// 那是错的——list 槽位同 id 一样可以按 priority 遮蔽。现在这两处走机制层 1：同 id +
// priority −1 注册空件，官方那条让出渲染位、仍在注册表里。
test('设置页两处官方件按槽位遮蔽（#178 C10+C11），不再用 CSS 结构规则', () => {
  const text = read('settingsLayoutPlugin.ts')
  const css = /const CSS =\n?\s*'([^']*)'/.exec(text)?.[1] ?? ''
  assert.ok(!/:has\(/.test(css), '设置页的 CSS 里不得再有 :has() 结构规则')
  assert.ok(!/aria-pressed/.test(css), '设置页不得再按外观行的 aria-pressed 结构认件')
  // 官方 id 逐字：ui-theme 的 'appearance'、ui-settings-general 的 'open-document'
  // （出处写在插件里那段说明里，测试只钉住「同一个 id + 更小优先号」这条形态）。
  assert.match(
    text,
    /ctx\.slots\.register\(\{\s*name:\s*'settings\.general\.item',\s*id:\s*'appearance',\s*priority:\s*-1\s*\}/,
    '外观行要按官方同 id + priority −1 遮蔽',
  )
  assert.match(
    text,
    /ctx\.slots\.register\(\{\s*name:\s*'settings\.action',\s*id:\s*'open-document',\s*priority:\s*-1\s*\}/,
    '官方「打开配置文件」要按官方同 id + priority −1 遮蔽',
  )
  assert.match(text, /dsh-client-ui-theme/, '遮蔽的出处（查过的官方包与条目 id）要写在注释里')
})

// #178 C7+C9：官方根元素不按 DOM 层次取。层次（插槽容器几层、是不是 display:contents）
// 是渲染器的实现细节，不是官方契约——按它写的选择器在官方换包装方式时静默不命中。
// 现在的口径：脚本按类名后缀找到官方根、打上 data-dshone-official-root，CSS 与几何
// 快照都只认这个属性。
test('官方侧栏根元素：按自有属性取，不按 DOM 层次（#178 C7+C9）', () => {
  const shell = read('sidebarLayoutPlugin.ts')
  const css = /const CSS =\n\s*'([^']*)'/.exec(shell)?.[1] ?? ''
  assert.ok(!/>div/.test(css), 'shell 的 CSS 不得再按「side 下的 div 里再一层」这种层次假设选元素')
  assert.ok(
    !/querySelector[^\n]*_side>div/.test(shell),
    '脚本里也不得再有按层次拼出来的官方根选择器（注释里提旧写法不算）',
  )
  assert.match(shell, /const OFFICIAL_ROOT_ATTR = 'data-dshone-official-root'/, '标记属性名要在这一处定义')
  assert.match(shell, /endsWith\('_root'\)/, '官方根的判据是 css-module 类名后缀 root')
  assert.match(shell, /new MutationObserver\(/, '官方根挂载晚、还可能被重挂：要有观察器兜住')
  assert.match(css, /\[data-dshone-official-root\]/, '按官方根走的规则要用标记属性选')
  assert.ok(!/:has\(button\[aria-pressed\]\)/.test(css), 'CSS 里不得再按结构伪类认官方件（#178 C10+C11 改成槽位遮蔽）')
  assert.ok(
    !/aria-label/.test(css),
    '失效的 aria-label 规则（#178 C8：中文词典原文是「收起侧边栏」）不得留在 CSS 里',
  )
})

/**
 * 官方右栏（#79 决策 B）：chat 树声明 rightbar 座位并渲染，文件/终端/文档预览
 * 三个官方插件才有地方注册。三件事都是官方契约，任一处漂移都要在这里先红。
 */
test('chat 树：rightbar 座位声明 + 按官方 props 契约渲染（#79 决策 B）', () => {
  const text = read('chatLayoutPlugin.ts')
  assert.match(text, /rightbar:\s*\{\s*kind:\s*'single',\s*scope:\s*'root'\s*\}/, 'chat 树要声明官方 rightbar 座位（官方 ui-sidebar-right 经 slots.inject 等它）')
  // 官方 AppFrame 的 RightbarColumn 传的三个字段（官方 client.js 的 renderSlot("rightbar", …)）。
  assert.match(text, /renderSlot\(\s*'rightbar',\s*\{[\s\S]{0,200}?width:[\s\S]{0,80}?viewportWidth:[\s\S]{0,80}?canShow:/, 'rightbar 座位要按官方 props 契约传 width / viewportWidth / canShow')
})

test('layout 服务：右栏呈现上报落进布局状态（官方 ILayout.openRightbar/closeRightbar 语义）', () => {
  const controller = /export class LayoutController \{([\s\S]*?)\n\}/.exec(read('frameShared.ts'))?.[1] ?? ''
  // 官方语义：右侧栏占据者上报呈现组成（track / fullscreen），外框据此定轨道宽度；
  // 官方 ui-sidebar-right 的 syncPresentation 调的就是这两个方法。
  assert.match(controller, /openRightbar\([\s\S]{0,200}?this\.#require\(\)\.openRightbar\(/, 'openRightbar 要把上报转交布局状态（不能是空实现）')
  assert.match(controller, /closeRightbar\(\):\s*void\s*\{\s*this\.#require\(\)\.closeRightbar\(\)/, 'closeRightbar 要把隐藏上报转交布局状态')
  const store = read('frameShared.ts')
  for (const action of ['openRightbar', 'closeRightbar', 'setRightbar', 'setViewportWidth']) {
    assert.ok(new RegExp(`\\b${action}:\\s*\\(d`).test(store), `layout store 要有官方同名的 ${action} 动作`)
  }
  // 官方 columns.ts 的数值：右列上限 70% 视口、首开 45%、中列底线 400。
  assert.match(store, /RIGHTBAR_MAX_RATIO = 0\.7/, '右列上限比例要对齐官方 columns.ts')
  assert.match(store, /RIGHTBAR_DEFAULT_RATIO = 0\.45/, '右列首开比例要对齐官方 columns.ts')
  assert.match(store, /CENTER_MIN_WIDTH = 400/, '中列底线要对齐官方 columns.ts')
})

/**
 * #109：未分组会话桶那一行的「＋」真的会建会话。
 *
 * 为什么是源码级断言而不是运行期断言：未分组桶只有在「网关注册表里已经没有、但有会话
 * 还挂在它名下」时才出现，而实验室的网关数据里没有这种会话——造一条就要往**真实网关**
 * 写数据（R-06 明令只读），所以运行期那一条（F-17）只按「有就断言、没有就记事实」写。
 * 这里钉的是那次修复本身：未分组（`workspaceId === undefined`）落到
 * `sessions.create({})`（散会话不进任何工作区），**不再直接 return**——修的就是「点了
 * 没反应」。
 */
test('#109：未分组桶的 ＋ 走 sessions.create({})，不再对 undefined 直接 return', () => {
  const plugin = fs.readFileSync(path.join(TREE_DIR, 'workspaceTreePlugin.ts'), 'utf8')
  const start = plugin.indexOf('startSession: (workspaceId?: string)')
  assert.ok(start >= 0, 'workspaceTreePlugin 里要有 startSession 注入面')
  const block = plugin.slice(start)
  const body = block.slice(0, block.indexOf('\n      },'))
  assert.ok(
    body.includes('sessions.create({})'),
    '未分组（workspaceId 缺省）要落到 sessions.create({})：官方 create 的 workspaceId 可选，省略即散会话',
  )
  assert.ok(
    !/if \(workspaceId === undefined\) return/.test(body),
    '不得再对未分组直接 return（那正是 #109 要修的「＋ 点了没反应」）',
  )
})
