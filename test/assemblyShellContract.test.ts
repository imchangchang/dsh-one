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

/** 三棵树的 frame 插件（官方 ui-layout 的角色承担者）。 */
const SHELLS = ['shellPlugin.ts', 'sidebarFramePlugin.ts', 'settingsFramePlugin.ts']

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
  // 官方语义：未注册的 keyed main 面板要照官方抛同一条错（不是静默吞掉）。
  assert.match(classBody, /layout\.selectPanel: main panel/, 'selectPanel 的非法目标要照官方文案抛错')
  // beginNavigation 必须作废上一次导航（AbortController 语义）。
  assert.match(classBody, /new AbortController\(\)/, 'beginNavigation 必须给出可作废的 AbortSignal')
})

test('chat 树：会话面板两版槽位都声明（0.1.2 的 single conversation / 0.1.6 的 keyed main）', () => {
  const text = read('shellPlugin.ts')
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
test('settings 树：root children 表按官方 ui-layout 补齐对话区座位 main（#74）', () => {
  const text = read('settingsFramePlugin.ts')
  assert.match(text, /main:\s*\{\s*kind:\s*'keyed',\s*scope:\s*'root'\s*\}/, 'keyed main 槽位要声明（官方 ui-conversation 的子树注册等它）')
})

// #85 A 项（侧栏树密度适配）：shell 给偏好、树插件消费、缺省回落官方档。
// 两边是两份源码，键集与官方原值靠这条测试对齐——shell 加的键没人消费、树消费的
// 键 shell 没设、兜底值抄错（覆盖了官方档）都会在这里挂。
test('密度偏好：shell 设的键集 = 树插件消费的键集，且树兜底逐项等于官方原值', () => {
  const shell = read('sidebarFramePlugin.ts')
  const profile = new Map(
    [...shell.matchAll(/'([a-z-]+)':\s*\{\s*official:\s*'([^']+)',\s*vscode:\s*'([^']+)'\s*\}/g)].map((m) => [
      m[1],
      { official: m[2], vscode: m[3] },
    ]),
  )
  assert.ok(profile.size >= 10, `shell 的 DENSITY_PROFILE 至少要有 10 项（实际 ${profile.size}）`)
  const tree = read('workspaceTreePlugin.ts')
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

// #85 B 项（悬停卡遮挡）：树插件按「容器右侧有没有 244+8px 空处」决定渲不渲染
// 官方悬停卡；shell 不得再用 CSS 把官方卡片钉进容器（上一版的做法，正是用户
// 反馈的「遮挡内容」）。
test('悬停卡：官方卡几何常数取自官方实现，且 shell 不再用 CSS 钉住卡片', () => {
  const tree = read('workspaceTreePlugin.ts')
  assert.match(tree, /const HOVER_CARD_WIDTH = 244/, '卡宽取官方 css-module 的固定 244px')
  assert.match(tree, /const HOVER_CARD_GAP = 8/, '定位间隙取官方实现的 anchor.right + 8')
  assert.match(tree, /available >= HOVER_CARD_WIDTH \+ HOVER_CARD_GAP/, '判据 = 容器到视口右缘的余量 ≥ 卡宽 + 间隙')
  // 两个行组件的浮层包裹都要过这道闸（会话行、工作区行）。
  assert.equal(
    [...tree.matchAll(/if \([^)]*!hoverCard[^)]*\) return row/g)].length,
    2,
    '会话行与工作区行都必须按 hoverCard 闸门决定渲不渲染浮层',
  )
  const shell = read('sidebarFramePlugin.ts')
  assert.ok(!/_card_/.test(shell), 'shell 不得再用 CSS 钉住官方悬停卡（遮挡的成因）')
})

// #85 追加项（用户验收拍板去掉顶部「新会话」胶囊）：官方把 New Session 画在侧栏壳
// （ui-sidebar 的 SidebarRoot）自己身上——不是槽位贡献（官方 0.1.6-alpha.1 的
// slots.d.ts 里没有它的槽，举证写在 sidebarFramePlugin.ts 的 CSS 上方），只能按
// 机制层 4 用 CSS 摘。这条测试守住边界：规则在 shell 且作用域限官方侧栏壳，树插件
// 不掺和——官方 web 形态（无我们的 shell）胶囊照旧，dsh-* 树插件保持可移植。
test('官方「新会话」胶囊：只在 shell 的 CSS 里摘，树插件不掺和（可移植边界）', () => {
  const shell = read('sidebarFramePlugin.ts')
  assert.match(
    shell,
    /\.dshOneSidebarShell_side>div>\[class\*="root"\]>\[class\*="newSession"\]\{display:none\}/,
    'shell 必须有摘掉官方新会话胶囊的 CSS 规则，且作用域限在官方侧栏壳（.dshOneSidebarShell_side>div>[class*="root"]）',
  )
  assert.match(shell, /dsh-client-ui-sidebar/, '规则上方必须点明举证来源（查过的官方包与文件）')
  assert.match(shell, /哈希前缀/, '注释要写明类名稳定性风险：css-module 后缀稳定、哈希前缀随版本变')
  const tree = read('workspaceTreePlugin.ts')
  assert.ok(!/class\*="newSession"/.test(tree), '树插件不得掺和官方胶囊的摘除（同一份插件还要在官方 web 形态里跑）')
})

/**
 * 官方右栏（#79 决策 B）：chat 树声明 rightbar 座位并渲染，文件/终端/文档预览
 * 三个官方插件才有地方注册。三件事都是官方契约，任一处漂移都要在这里先红。
 */
test('chat 树：rightbar 座位声明 + 按官方 props 契约渲染（#79 决策 B）', () => {
  const text = read('shellPlugin.ts')
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
