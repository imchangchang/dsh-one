/**
 * 客户端契约面探针（#79）——上游 `combo`（网关把全部前端插件拼成的那个大文件）
 * 里我们必须存在的名字：slot 名、root 级 hook 名、我们取用过的字段/方法名。
 *
 * 与 probe.mjs 的关系：probe.mjs 覆盖**伺服面**（启动/认证/unary RPC/WS 帧，
 * #67 的 N1–N3），本文件覆盖**客户端契约面**（装配线直引官方插件代码，官方的
 * 槽位名/hook 名/字段名就是我们的 ABI）。0.1.6 的两次实测漂移正是这一类：
 * `details` → `rightbar`（槽位改名）、`provideRoot` 新增 hooks（#76 的
 * `usePanelInfo is not a function`）、`imageIds` → `attachmentIds`（#78 抓到）。
 * 漂移由本文件断言，每日 upstream-watch 跑，坏了下游先知道。
 *
 * ## 断言依据（为什么不依赖私有实现细节）
 *
 * combo 是官方发给浏览器的**产品产物**，里面带着官方自己的契约目录：每个 slot
 * 声明处都有 `key/kind/scope/source` 元数据（`source` 是官方源码路径），官方
 * settings 的插件清单页就是读它渲染的。本文件按以下三类**官方语义**取名字：
 *
 * 1. slot：契约目录条目 + `ctx.slots.register({name})` + `slots.inject("…")`
 *    + `renderSlot("…")` + `slots.entries/getVersion/subscribe("…")`
 *    + root children 声明（`"name": { kind: … }`）；
 * 2. root hook：`ctx.slots.provideRoot({ hooks: { <name>: … } })` 的**顶层键**
 *    （官方 ui-layout / ui-session / ui-workspace 的下发点），以及框架把 hook
 *    名映射出来的槽位 props（`standardHookPropName` 的产物 `use<Name>`）；
 * 3. 字段/方法名：我们取用过的官方名字按**插件段**限定作用域逐个查（例如
 *    附件字段只认 ui-conversation 里的那次出现），避免「撞上同名」的假绿。
 *
 * 三者都是「名字还在不在」的存在性断言：名字消失 = fail，并把缺失项、期望出处
 * 与插件包名一起写进 detail。不做行为断言（行为由装配实验室 F-01 CONTRACT 与
 * VS Code 验证兜底）。
 *
 * ## 刻意不覆盖的面（写清楚边界，免得当它万能）
 *
 * - 官方服务的**行为**与语义（改名之外的同名换义）：断言名字在场，不代表语义没变；
 * - 真渲染路径（槽位有没有内容、有没有崩）：`npm run verify:lab` 的 F-01 管这个；
 * - 宿主半（网关侧插件）与 wire 协议：probe.mjs 的伺服面项 + `verify:host-half`；
 * - 我们**只声明不渲染**的槽位（`settings.close` / `settings.onboarding`）：官方
 *   改名不会让我们任何一个真渲染的面变空，纳入会变成噪音，故不收。
 *
 * ## 数据表字段怎么读
 *
 * 下面三张表的 `why` 是**维护者文档**（这个依赖是干什么的、漂移了会怎么炸），只在
 * 人读源码时用，不进断言 detail——detail 只放可操作的定位信息（缺哪个名字、期望
 * 官方出处 `expect`、我方使用点 `where`），免得失败信息长到看不完。`names` 里多个
 * 名字是「同一东西的各代命名」，任一在场即通过（我们同时服务 0.1.2 与 0.1.6 两线）。
 *
 * 名单里有几处**不在本文件里手写**，而是 import 产品侧的同一份名字表（
 * `src/pure/*.ts`）——产品改了取用名，这里自动跟着查新名，不会出现「探针还在查旧名
 * 所以天天红」或「产品换了名探针还在查旧名所以天天绿」两种漂法（先例 #37 的
 * `src/pure/dshWire.ts`：运行时与探针 import 同一个函数）。
 */
import { PENDING_SOURCES } from '../../src/pure/sessionPendingSource.ts'

/** 提取前提（combo 结构）——不成立时说明取法失效，人工按新结构改本文件。 */
const MIN_SEGMENTS = 40
const MIN_CATALOG_ENTRIES = 30

/**
 * 必须存在的 slot 名（`names` 是「同一座位的各版本名字」，任一在场即通过：
 * 0.1.2 线的 single `conversation`/`details` 与 0.1.6 线的 keyed `main`/`rightbar`
 * 是同一座位的两代命名，官方两代都算我们的契约）。
 */
export const SLOT_DEPENDENCIES = [
  {
    names: ['main', 'conversation'],
    why: '会话面板座：0.1.2 线是 single `conversation`，0.1.6 线是 keyed `main`（key = `conversation`）',
    where:
      'src/ui/assembly/shell/chatLayoutPlugin.ts（root children + conversationSeat 镜像 + renderSlot）、settingsLayoutPlugin.ts（root children 只声明不渲染——官方 ui-conversation 的子树注册挂在这个名字上，#74）',
    expect: 'packages/client/ui-layout/src/client/index.ts:66 / ui-conversation/src/client/contract/slots.ts',
  },
  {
    names: ['rightbar', 'details'],
    why: '右列座：0.1.2 线是 single `details`，0.1.6 起官方换成 single `rightbar`（#77 右栏接入要声明的也是它）',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:271（details 声明）/ frameShared.ts:107',
    expect: 'packages/client/ui-layout/src/client/index.ts:80 / ui-conversation/src/client/contract/slots.ts:120',
  },
  {
    names: ['sidebar'],
    why: '侧栏位：官方 ui-sidebar 的贡献注册进这个 root 子槽，我们的侧栏 frame 声明并渲染它',
    where: 'src/ui/assembly/shell/sidebarLayoutPlugin.ts:196',
    expect: 'packages/client/ui-layout/src/client/index.ts:61',
  },
  {
    names: ['shell.overlay'],
    why: '全宽悬浮层：右键菜单与 git 卡片渲染在这里（自有 frame 声明 + 两个插件注入）',
    where:
      'src/ui/assembly/shell/chatLayoutPlugin.ts:272、packages/dsh-context-menu/src/contextMenuPlugin.ts:308、packages/dsh-git-card/src/gitCardPlugin.ts:601',
    expect: 'packages/client/ui-layout/src/client/index.ts:91',
  },
  {
    names: ['sidebar.workspaces'],
    why: '工作区/会话树的遮蔽目标（同名单独注册 + 更低优先号顶掉官方 WorkspaceBrowser）',
    where: 'packages/dsh-workspace-tree/src/workspaceTreePlugin.ts:316,319',
    expect: 'packages/client/ui-sidebar/src/client/contract/slots.ts:39',
  },
  {
    names: ['sidebar.workspaces.directoryFlow'],
    why: '官方 WorkspaceBrowser 声明的子槽，自有树要读它的占用态（官方目录选择器接管）',
    where: 'packages/dsh-workspace-tree/src/workspaceTreePlugin.ts:200-202',
    expect: 'packages/client/ui-workspace/src/client/contract/slots.ts:59',
  },
  {
    names: ['sidebar.brand.mark', 'sidebar.brand.name'],
    why: '侧栏品牌位的两个注入点（自有侧栏 frame 提供品牌位内容）',
    where: 'src/ui/assembly/shell/sidebarLayoutPlugin.ts:209-212',
    expect: 'packages/client/ui-sidebar/src/client/contract/slots.ts:22,27',
  },
  {
    names: ['sidebar.settings'],
    why: '侧栏底部设置入口的注入点（设置齿轮插件）',
    where: 'src/ui/assembly/shell/settingsGearPlugin.ts:102',
    expect: 'packages/client/ui-sidebar/src/client/contract/slots.ts:45',
  },
  {
    names: ['settings.section'],
    why: '设置页每节一个 entry：自有设置 frame 的导航行与内容区都按它推导（entries/getVersion/subscribe/renderSlot）',
    where: 'src/ui/assembly/shell/settingsLayoutPlugin.ts:104-180',
    expect: 'packages/client/ui-settings/src/client/contract/slots.ts:54',
  },
  {
    names: ['settings.header'],
    why: '设置页标题区（官方设置项注册在这里，由自有设置 frame 渲染）',
    where: 'src/ui/assembly/shell/settingsLayoutPlugin.ts:159',
    expect: 'packages/client/ui-settings/src/client/contract/slots.ts:30',
  },
  {
    names: ['settings.action'],
    why: '设置页动作区（官方动作注册在这里，由自有设置 frame 渲染 + 自有导出动作注入）',
    where: 'src/ui/assembly/shell/settingsLayoutPlugin.ts:178,287',
    expect: 'packages/client/ui-settings/src/client/contract/slots.ts:36',
  },
  {
    names: ['conversation.input.overlay'],
    why: '输入框上浮层（清空/撤销的提示注入点）',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:386',
    expect: 'packages/client/ui-conversation/src/client/contract/slots.ts:167',
  },
  {
    names: ['conversation.session.header.utilities'],
    why: '会话头动作区（日志导出的注入点）',
    where: 'packages/dsh-session-export/src/sessionExportPlugin.ts:101',
    expect: 'packages/client/ui-conversation/src/client/contract/slots.ts:138',
  },
  {
    names: ['root'],
    why: '渲染器的根槽：自有 frame 同名单独注册（更低优先号）接管整页组合',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:263-272',
    expect: 'packages/client/ui-renderer/src/client/registry.ts:43',
  },
]

/**
 * 必须存在的 root 级 hook（官方 `ctx.slots.provideRoot` 下发、框架按
 * `standardHookPropName` 变成槽位 props；我们组件直接解构 `use<Name>`）。
 * 0.1.6 新增 hooks 那一次让会话树整块消失（#76），这一组就是为它设的哨兵。
 *
 * `names` / `props` 都是「同一东西的各版本名字」的数组，**任一组在场即通过**：官方
 * 在版本之间换过钩子名（`sessionPendingInteraction` → `sessionStatus`，见 #184），
 * 我们两代都服务。`names[i]` 与 `props[i]` 是同一条钩子的两个名字（钩子名与框架
 * 映射出的 props 名），一一对应。
 */
export const ROOT_HOOK_DEPENDENCIES = [
  {
    names: ['panelInfo'],
    props: ['usePanelInfo'],
    field: 'activePanelId',
    why: '当前主面板 id：官方树组件与官方右侧栏都读它，缺了抛 `usePanelInfo is not a function`（#76 现场）',
    where: 'src/ui/assembly/shell/frameShared.ts:175（PANEL_INFO_SOURCE 提供）+ chatLayoutPlugin/sidebarLayoutPlugin/settingsLayoutPlugin 消费',
    expect: 'packages/client/ui-layout/src/client/index.ts（provideRoot 下发点）',
  },
  {
    names: ['sessions'],
    props: ['useSessions'],
    why: '会话列表快照：自有工作区/会话树的全部会话数据来自它',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts（TreeProps）',
    expect: 'packages/client/ui-session（provideRoot 下发点）',
  },
  {
    /**
     * 会话等待态：名字表与产品侧同一份（`src/pure/sessionPendingSource.ts` 的
     * `PENDING_SOURCES`，新→旧），产品侧改了取用名这里自动跟着查——两处不会漂。
     */
    names: PENDING_SOURCES.map((source) => source.hook),
    props: PENDING_SOURCES.map((source) => source.prop),
    why: '会话级等待态（审批/提问中）：自有会话行的状态点按它渲染。0.1.6-alpha.2 起官方把这条钩子从 `sessionPendingInteraction` 换成 `sessionStatus`（值从「等待态表」变成「会话状态表」，等待态在 `status.pendingInteraction` 那一格），我们对两代都取',
    where: 'src/pure/sessionPendingSource.ts（两代取用与投影的单一事实源）+ packages/dsh-workspace-tree/src/workspaceTree/tree.ts（按在场的那条取）',
    expect: 'packages/client/ui-session（provideRoot 下发点）',
  },
  {
    names: ['workspaces'],
    props: ['useWorkspaces'],
    why: '工作区列表快照：自有树的分组树/未分组列表数据来自它',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts（TreeProps）',
    expect: 'packages/client/ui-workspace（provideRoot 下发点）',
  },
]

/**
 * 我们取用过的字段/方法名（从 src 里 grep 得出，逐条附我方使用点）。
 * `names` 是「同一东西的各版本名字」，任一在场即通过；`scope` 是该名字应当出现的
 * 官方插件 id（限定作用域，避免撞名假绿）；缺省 = 全 combo 范围。
 */
export const IDENTIFIER_DEPENDENCIES = [
  {
    names: ['attachmentIds', 'imageIds'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '待发附件字段（0.1.6 由 `imageIds` 改名成 `attachmentIds`——#78 抓到的实测漂移）',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:106（attachmentIdsOf，两代都取）',
  },
  {
    names: ['addAttachments', 'addImages'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '还回待发附件的动作（0.1.6 由 `addImages` 改名成 `addAttachments`）',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:118-122',
  },
  {
    names: ['removeAttachment', 'removeImage'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '移除待发附件的动作（0.1.6 由 `removeImage` 改名成 `removeAttachment`）',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:110-116',
  },
  {
    names: ['setDraft'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '撤销清空时写回正文的输入面动作',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:87',
  },
  {
    names: ['draftRev'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '插入引用 chip 时的 span CAS 版本号（每次现读）',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:137,152',
  },
  {
    names: ['insertReference'],
    scope: ['@deepseek-ai/dsh-client-ui-conversation'],
    why: '撤销清空时把引用 chip 插回去的输入面动作',
    where: 'packages/dsh-composer-clear/src/composerClearPlugin.ts:138,148',
  },
  {
    names: ['activePanelId'],
    why: 'panelInfo hook 的快照字段（我们渲染 keyed `main` 时取它当 entryKey）',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:174,221',
  },
  {
    names: ['entryKey'],
    scope: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout'],
    why: 'keyed slot 的 renderSlot 选项名（keyed `main` 靠它选键）',
    where: 'src/ui/assembly/shell/chatLayoutPlugin.ts:58,221',
  },
  {
    names: ['archivedSessionIds'],
    scope: ['@deepseek-ai/dsh-client-ui-workspace'],
    why: '工作区快照的归档会话 id 列（自有树过滤已归档会话）',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts:9',
  },
  {
    names: ['sessionIds'],
    scope: ['@deepseek-ai/dsh-client-ui-workspace'],
    why: '工作区视图的成员会话 id 列（自有树按它分组）',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts:18',
  },
  {
    names: ['workspaceId'],
    scope: ['@deepseek-ai/dsh-client-ui-workspace'],
    why: '工作区 id 字段（分组行与动作按它寻址）',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts:15',
  },
  {
    names: ['createdAt'],
    scope: ['@deepseek-ai/dsh-client-ui-workspace'],
    why: '工作区创建时间字段（排序与相对时间显示）',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/types.ts:19',
  },
  {
    names: ['byId'],
    scope: ['@deepseek-ai/dsh-api-session-controller'],
    why: 'sessions 服务快照的 id → 会话摘要表（自有行标题/cwd/未读都取自它）',
    where: 'packages/dsh-workspace-tree/src/workspaceTree/tree.ts:257,279、packages/dsh-workspace-tree/src/workspaceTreePlugin.ts:182',
  },
  {
    /**
     * 会话等待态在各代官方产物里的取值名（与 `PENDING_SOURCES` 同一份表，新→旧）：
     * 0.1.6-alpha.1 及以前是 uiSession 服务上的 `pendingInteractions`（等待态表），
     * 0.1.6-alpha.2 起是会话状态对象里那一格 `pendingInteraction`。
     */
    names: PENDING_SOURCES.map((source) => source.field),
    scope: ['@deepseek-ai/dsh-client-ui-session'],
    why: '会话等待态（审批/提问中）的取值名：自有会话行的状态点按它取',
    where: 'src/pure/sessionPendingSource.ts（两代的取值名与投影，`PENDING_SOURCES` 的 `field`）',
  },
]

// ---------------------------------------------------------------------------
// 提取（纯函数，吃 combo 文本）
// ---------------------------------------------------------------------------

/** 跳过字符串字面量，返回闭合引号的下标（模板串按普通字符串处理）。 */
function skipString(text, openIndex) {
  const quote = text[openIndex]
  for (let i = openIndex + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') { i += 1; continue }
    if (ch === quote) return i
  }
  return text.length - 1
}

/** 从 `openIndex` 处的 `{`/`(` 匹配到闭合字符，返回闭合下标；-1 = 未找到。 */
function matchBalanced(text, openIndex) {
  const open = text[openIndex]
  const close = open === '{' ? '}' : ')'
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue }
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i === -1) return -1; continue }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i); if (end === -1) return -1; i = end + 1; continue }
    if (ch === open) depth += 1
    else if (ch === close) { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

/** 对象字面量（含花括号）的顶层键名；支持裸键与引号键。 */
function objectTopLevelKeys(text, openIndex) {
  const end = matchBalanced(text, openIndex)
  if (end === -1) return []
  const keys = []
  let depth = 1
  for (let i = openIndex + 1; i < end; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue }
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i === -1) break; continue }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i); if (e === -1) break; i = e + 1; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue }
    if (depth !== 1) continue
    const rest = text.slice(i, i + 120)
    const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/.exec(rest)
    if (m === null) continue
    keys.push(m[1] ?? m[2] ?? m[3])
    i += m[0].length - 1
  }
  return keys
}

/** 按 `window.__ModuleLoader__.load({` 切插件段（与 src/server/assemblyMirror.ts 同一处边界）。 */
export function splitComboSegments(text) {
  const marks = [...text.matchAll(/window\.__ModuleLoader__\.load\(\{/g)]
  return marks.map((m, i) => ({
    id: /\bid:\s*"([^"]+)"/.exec(text.slice(m.index, m.index + 300))?.[1] ?? null,
    start: m.index,
    end: i + 1 < marks.length ? marks[i + 1].index : text.length,
  }))
}

function pluginAt(segments, index) {
  let found = null
  for (const seg of segments) {
    if (seg.start <= index) found = seg
    else break
  }
  return found?.id ?? null
}

/** 官方契约目录：`key/kind/scope` 三元组 + 官方源码路径 `source`。 */
export function extractSlotCatalog(text) {
  const entries = new Map()
  const re = /\bkey:\s*"([^"]+)",\s*kind:\s*"([^"]+)",\s*scope:\s*"([^"]+)"/g
  const matches = [...text.matchAll(re)]
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i]
    const stop = i + 1 < matches.length ? matches[i + 1].index : Math.min(text.length, m.index + 8000)
    const source = /source:\s*"([^"]+)"/.exec(text.slice(m.index, stop))?.[1] ?? null
    if (!entries.has(m[1])) entries.set(m[1], { kind: m[2], scope: m[3], source })
  }
  return entries
}

/** slot 名的在场证据：契约目录 + 注册/声明/注入/渲染/订阅调用点 + root children 声明。 */
export function extractSlotMentions(text, segments) {
  const mentions = new Map()
  const add = (name, index, kind) => {
    if (typeof name !== 'string' || name === '') return
    const hit = mentions.get(name) ?? { count: 0, kinds: new Set(), plugins: new Set() }
    hit.count += 1
    hit.kinds.add(kind)
    hit.plugins.add(pluginAt(segments, index) ?? '(unknown)')
    mentions.set(name, hit)
  }
  const patterns = [
    [/ctx\.slots\.register\(\{\s*name:\s*"([^"]+)"/g, 'register'],
    [/ctx\.slots\.inject\(\s*"([^"]+)"/g, 'inject'],
    [/\brenderSlot\(\s*"([^"]+)"/g, 'renderSlot'],
    [/ctx\.slots\.(?:entries|getVersion|subscribe)\(\s*"([^"]+)"/g, 'read'],
    [/\bname:\s*"([^"]+)",\s*(?:locale|children|id|order|inject|store)\s*:/g, 'register'],
    [/"([A-Za-z][\w.]*)":\s*\{\s*kind:\s*"(?:single|list|keyed|chain)"/g, 'children'],
  ]
  for (const [re, kind] of patterns) {
    for (const m of text.matchAll(re)) add(m[1], m.index, kind)
  }
  return mentions
}

/**
 * root 级 hook：每个 `ctx.slots.provideRoot({...})` 调用点里 `hooks:` / `keyedHooks:`
 * 对象的顶层键。返回 [{ hook, channel, plugin, index }]。
 */
export function extractRootHooks(text, segments) {
  const out = []
  const re = /(?:ctx\.slots\.)?provideRoot\(/g
  for (const m of text.matchAll(re)) {
    const parenIndex = text.indexOf('(', m.index + m[0].length - 1)
    const argEnd = matchBalanced(text, parenIndex)
    if (argEnd === -1) continue
    const arg = text.slice(parenIndex, argEnd + 1)
    const plugin = pluginAt(segments, m.index)
    for (const channel of ['hooks', 'keyedHooks']) {
      for (const cm of arg.matchAll(new RegExp(`\\b${channel}:\\s*\\{`, 'g'))) {
        const braceIndex = parenIndex + cm.index + cm[0].length - 1
        for (const hook of objectTopLevelKeys(text, braceIndex)) {
          out.push({ hook, channel, plugin, index: braceIndex })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

function fmtSet(set, limit = 4) {
  const arr = [...set]
  return `[${arr.slice(0, limit).join(', ')}${arr.length > limit ? `, +${arr.length - limit}` : ''}]`
}

/** 在场清单只列前几条：issue 表格里失败信息才是重点，全量清单会把单元格撑爆。 */
function summarizeFound(found) {
  if (found.length <= 8) return found.join(', ')
  return `${found.slice(0, 8).join(', ')} …（共 ${found.length} 组全部在场）`
}

/** 名字在 combo 里的出现位置（限定插件作用域时只认作用域内的段）。 */
function locate(text, segments, name, scope) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
  const hits = []
  for (const m of text.matchAll(re)) {
    const plugin = pluginAt(segments, m.index)
    if (scope !== undefined && scope.length > 0 && !scope.includes(plugin)) continue
    hits.push(plugin)
  }
  return hits
}

/** 四行结果的 id 与名字（probe 侧与「combo 取不到」分支共用同一份，避免两处漂移）。 */
const ROW = {
  index: { id: 'client-combo-index', name: 'combo 取法前提：插件段边界 + 官方 slot 契约目录' },
  slots: { id: 'client-slots', name: `slot 名在场（${SLOT_DEPENDENCIES.length} 组：遮蔽/声明/注入/渲染的座位）` },
  hooks: { id: 'client-root-hooks', name: `root 级 hook 在场（provideRoot 下发 + \`use<Name>\` props 映射，${ROOT_HOOK_DEPENDENCIES.length} 条）` },
  identifiers: { id: 'client-identifiers', name: `我们取用过的字段/方法名在场（${IDENTIFIER_DEPENDENCIES.length} 组，按插件作用域查）` },
}

/**
 * 跑客户端契约面四类断言，返回 probe.mjs 的结果行
 * [{ id, name, status: 'pass'|'fail', detail }]。纯函数：不做网络与文件 IO。
 * `comboText` 为空 = combo 没取到（`unavailableReason` 记原因）：四行全 fail——
 * 取不到就不能让这一面显示成「没问题」。
 */
export function checkClientContract({ comboText, version, unavailableReason }) {
  if (typeof comboText !== 'string' || comboText === '') {
    const detail = `combo 取不到（${unavailableReason ?? 'unknown'}）——客户端契约面未核实`
    return Object.values(ROW).map((row) => ({ ...row, status: 'fail', detail }))
  }
  const results = []
  const segments = splitComboSegments(comboText)
  const segmentIds = segments.filter((s) => s.id !== null).map((s) => s.id)
  const catalog = extractSlotCatalog(comboText)
  const mentions = extractSlotMentions(comboText, segments)
  const versionLabel = version ?? 'unknown'

  // 1. 提取前提：combo 结构与官方契约目录都在（不在 = 本类断言取法失效，需人工核对）
  {
    const complete = segments.length > 0 && segmentIds.length === segments.length
    const ok = complete && segments.length >= MIN_SEGMENTS && catalog.size >= MIN_CATALOG_ENTRIES
    results.push({
      ...ROW.index,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `dsh ${versionLabel}：${segments.length} 个插件段（id 全可读）、契约目录 ${catalog.size} 条 slot`
        : `dsh ${versionLabel}：段 ${segments.length}（可读 id ${segmentIds.length}）、契约目录 ${catalog.size} 条（阈值 ${MIN_SEGMENTS}/${MIN_CATALOG_ENTRIES}）——官方改了 combo 结构或契约目录取法失配，按 scripts/dsh-upstream-watch/clientContract.mjs 的提取注释核对`,
    })
  }

  // 2. slot 名
  {
    const missing = []
    const found = []
    for (const dep of SLOT_DEPENDENCIES) {
      const hit = dep.names.find((n) => catalog.has(n) || mentions.has(n))
      if (hit === undefined) missing.push(`${dep.names.join('|')}（期望出处 ${dep.expect}；我方使用点 ${dep.where}）`)
      else {
        const c = catalog.get(hit)
        found.push(c ? `${hit}@${c.scope}` : hit)
      }
    }
    results.push({
      ...ROW.slots,
      status: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length === 0
        ? `dsh ${versionLabel}：${summarizeFound(found)}`
        : `dsh ${versionLabel} 缺 ${missing.length} 组：${missing.join('；')}`,
    })
  }

  // 3. root 级 hook（官方 provideRoot 下发的钩子名 + 框架映射出的 props 名）
  {
    const provideRootHooks = extractRootHooks(comboText, segments)
    const byName = new Map()
    for (const h of provideRootHooks) {
      if (!byName.has(h.hook)) byName.set(h.hook, h)
    }
    const missing = []
    const found = []
    for (const dep of ROOT_HOOK_DEPENDENCIES) {
      // 两代命名任一条在场即通过（`names[i]`/`props[i]` 是同一条钩子的两个名字）。
      const pairs = dep.names.map((name, index) => ({ name, prop: dep.props[index] }))
      const hit = pairs.find((pair) => byName.has(pair.name) && locate(comboText, segments, pair.prop, undefined).length > 0)
      if (hit === undefined) {
        const reasons = pairs
          .map((pair) => [
            byName.has(pair.name) ? null : `provideRoot 未下发 \`${pair.name}\``,
            locate(comboText, segments, pair.prop, undefined).length > 0 ? null : `槽位 props 名 \`${pair.prop}\` 不在 combo 里`,
          ].filter((x) => x !== null).join('；'))
          .filter((text) => text !== '')
        const reason = reasons.length === 0 ? '名字都在场（判定异常，请核对本文件的取法）' : reasons.join(' 且 ')
        missing.push(`${dep.names.join('|')}（${reason}；期望出处 ${dep.expect}；我方使用点 ${dep.where}）`)
      } else {
        found.push(`${hit.name}←${byName.get(hit.name)?.plugin ?? '(unknown)'}`)
      }
    }
    results.push({
      ...ROW.hooks,
      status: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length === 0
        ? `dsh ${versionLabel}：${summarizeFound(found)}`
        : `dsh ${versionLabel} 缺 ${missing.length} 条：${missing.join('；')}`,
    })
  }

  // 4. 我们取用过的字段/方法名
  {
    const missing = []
    const found = []
    for (const dep of IDENTIFIER_DEPENDENCIES) {
      let hit = null
      for (const name of dep.names) {
        const hits = locate(comboText, segments, name, dep.scope)
        if (hits.length > 0) { hit = { name, plugin: hits[0] }; break }
      }
      if (hit === null) {
        const scopeLabel = dep.scope === undefined ? '全 combo' : dep.scope.join('|')
        missing.push(`${dep.names.join('|')}（作用域 ${scopeLabel}；我方使用点 ${dep.where}）`)
      } else {
        found.push(`${hit.name}→${hit.plugin}`)
      }
    }
    results.push({
      ...ROW.identifiers,
      status: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length === 0
        ? `dsh ${versionLabel}：${summarizeFound(found)}`
        : `dsh ${versionLabel} 缺 ${missing.length} 组：${missing.join('；')}（名字消失 = 我们按它取用的代码路径静默失效）`,
    })
  }

  return results
}

/** 导出给单测/调试：整段契约观测（不算断言）。 */
export function observeCombo({ comboText }) {
  const segments = splitComboSegments(comboText)
  const catalog = extractSlotCatalog(comboText)
  const mentions = extractSlotMentions(comboText, segments)
  const hooks = extractRootHooks(comboText, segments)
  return {
    bytes: comboText.length,
    segments: segments.length,
    segmentIds: segments.map((s) => s.id),
    catalogSlots: [...catalog.keys()],
    mentionedSlots: [...mentions.keys()],
    rootHooks: hooks.map((h) => `${h.channel}:${h.hook}@${h.plugin}`),
    sampleMentions: fmtSet(new Set(mentions.keys()), 8),
  }
}
