/**
 * blocklist 模式的运行时装配清单（#64，#70 起按树参数化）：面板打开时扩展宿主
 * （node 侧，无 CORS）用 serverAuth 的 cookie GET 网关 `/`，从注入 HTML 提取官方
 * __DSH_BOOT__ wire 与前端资产名，按该树的 block list 过滤后内联进装配页——
 * 插件集 = 网关启动的全量插件 − block list + 自有 shell 插件。
 * （替代原静态 allowlist：18 包 pin + 构建期 manifest.json 已删除。)
 *
 * 关键事实（探针结论，见 #64 汇报)：
 * - 网关 **拒绝任意重拼的 combo**（rev 是内容校验，重拼即 404)，单包 URL
 *   也只认各自的精确 rev——所以过滤不是改 URL 指向网关，而是：
 *   application 批 URL 改指 mirror 的 /plugins-local（mirror 拉官方原 combo
 *   按 __ModuleLoader__.load 边界剥掉 blocked 段后伺服，见 assemblyMirror)。
 * - bootstrap 批只有 client-modules，永不过滤。
 *
 * 两棵树两份 block list（#70）：
 * - chat 树（装配对话区）：官方外框 + 官方侧栏都下线（#64 行为不变）
 * - sidebar 树（侧栏位装配）：只下官方外框，官方侧栏（品牌位/工作区树/
 *   设置入口/底部动作）原样进侧栏位，设置面板 = 官方 SettingsRoot modal
 */

/** 前端资产清单（从网关 / 注入 HTML 解析，哈希文件名不硬编码)。 */
export interface GatewayAssets {
  moduleJs: string
  preloadJs: string[]
  css: string[]
}

export interface BootWireEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  external?: string[]
  immediately?: boolean
}

export interface BootWireBatch {
  phase: 'bootstrap' | 'application' | string
  url: string
  rev: string
  entries: string[]
}

export interface BootWire {
  rev: string
  entries: BootWireEntry[]
  batches: BootWireBatch[]
}

/** 被下线官方插件条目：id + 理由（新增须注释理由）。 */
export interface BlockedPlugin {
  id: string
  reason: string
}

/** 官方外框条目（三棵树共用）：与 VS Code 外壳形态冲突，由自有 frame 插件接管根组合。 */
const UI_LAYOUT: BlockedPlugin = {
  id: '@deepseek-ai/dsh-client-ui-layout',
  // 官方应用外框（三列网格 + 拖拽把手 + 最小 56px 侧栏轨），与 VS Code 的
  // 容器形态冲突；由 @dsh-one/vscode-shell（chat 树）/ @dsh-one/vscode-sidebar-shell
  // （sidebar 树）/ @dsh-one/vscode-settings-shell（settings 树）接管根组合。
  // #77 实测过铁律的首选路径（加载官方件 + 只遮蔽它的 root slot），三条硬约束
  // 使其不可行：root 子槽声明排他、renderSlot 授权按条目、同域二次 provide 抛错
  // 且整页 boot 失败——证据与结论见 shell/frameShared.ts 文件头。
  reason: 'official app frame conflicts with the VS Code shell; the @dsh-one frame plugin takes over root composition and provides the layout service',
}

/**
 * chat 树 block list（#64）：装配对话区下官方外框 + 官方侧栏（侧栏由
 * dsh-one 侧栏位承担）。filterWire 的默认参数 = 本清单，#64 行为不变。
 */


/**
 * 对话流卡片组（#71 瘦身）：chat 树无关区（会话页卡片/工具/工作流/设置
 * 子页等）。一条一理由；inject 闭包硬约束——保留 ui-input-trigger（ui-cordis
 * 的 inputTriggers 服务依赖，已核实其 inject 列表）。
 */
const CHAT_FLOW: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-tool', reason: 'tool-call cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-workflow-run', reason: 'workflow-run cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-deliverables', reason: 'deliverables cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-trajectory', reason: 'trajectory panel (390KB); no conversation area in the sidebar/settings trees' },
  // ui-approval 曾在这条清单里（「approval cards; no conversation area」）。2026-09-17
  // 摘除：它与 ui-user-questions 是官方安装里唯二**真的会发布**会话等待态的插件
  // （第三个调用点 ui-session 只注册那条口子、自己不发布，见下面那一段），而等待态
  // 正是侧栏会话行黄点的数据源（#140）——把发布者挡掉，侧栏页的等待态表恒空，
  // 等提问 / 等审批的会话就显示成绿点。它们的卡片只往 `conversation.composer` 座位
  // 渲染，而这个座位在侧栏 / 设置两棵树里没人声明，官方那两件用的是 `slots.inject`
  //（等目标槽名被声明后再注册的正规挂法）——注册条件永不满足，所以放行不会多渲染
  // 任何东西，也不会 loud throw。侧栏树保持原样的前提由 F-42 常驻把关。
  { id: '@deepseek-ai/dsh-client-ui-attachment', reason: 'message attachment gallery; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-subagent', reason: 'subagent cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-jobs', reason: 'background-jobs cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-goal', reason: 'goal cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-plan', reason: 'plan cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-message-feedback', reason: 'message feedback; no conversation area in the sidebar/settings trees' },
  // ui-model-selection 曾在这条清单里（composer 里的模型选择面）。2026-09-16 摘除，
  // 当时的理由写的是「0.1.6-alpha.1 的 wire 里已经没有这个条目」——**那条观察是错的**
  //（#164 更正）：它看到的 wire 来自日常 profile，而那台机器装了另一仓的
  // `@dsh-one/dsh-llm-provider`，它的 bundle patch 里 `disabled: true` 把
  // `ui-model-selection` 与 `ui-settings-models` 两行禁掉了；全新 `DSH_HOME` 上
  // 这两条一直在官方 wire 里（0.1.6-alpha.1 实测，见 F-55）。
  // 教训：**「官方有没有这个插件」只能看全新 `DSH_HOME` 的 wire**，被自己的补丁
  // 改过的 profile 拿来做这个判断一定得出反的结论。
  // 摘除这个动作本身是对的（清单一长就与 wire 对不上），保持现状：它只在
  // `conversation.input.model` 座位渲染，而侧栏 / 设置两棵树不声明对话区座位，
  // 所以放着不渲染任何东西。
  { id: '@deepseek-ai/dsh-client-ui-skill', reason: 'skill cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-reference', reason: 'reference cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-session-log-export', reason: 'session-log export (routed through the host save-dialog action, #71)' },
  // ui-user-questions 曾在这条清单里（「user-question cards; no conversation area」）。
  // 2026-09-17 摘除，理由与上一条 ui-approval 同：#140 的等待态数据源。官方安装里
  // 只有三处调用 `uiSession.registerPendingInteraction`——本件（question 与
  // plan-review 两档）、ui-approval（approval 档）、ui-session 自己；前两件之前被
  // 挡掉之后，侧栏页一条等待态都发布不出来。`plan-review` 这一档就是本件发的
  //（`pending.kind === "plan-review" ? 2 : 1` 的优先号），所以 ui-plan 不必放行
  // ——它的 plan 卡片仍然只在对话区有用。
  { id: '@deepseek-ai/dsh-client-ui-directory-picker-native', reason: 'native directory picker (VS Code host provides its own picker)' },
]

/** 设置子页组（#71 瘦身）：设置独立成页后 chat/sidebar 树不再载设置子页。 */
const SETTINGS_PAGES: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-settings-general', reason: 'General section (owns SettingsRoot/modal); only the settings tree needs it after settings became a page' },
  // ui-settings-models 曾在这条清单里（Models 设置节）。2026-09-16 摘除，当时的理由
  // 与 CHAT_FLOW 里 ui-model-selection 那一段同一份错误观察（日常 profile 被另一仓的
  // `@dsh-one/dsh-llm-provider` 补丁改过），更正与教训见那一段。
  // 它留在清单外是对的：本树不声明设置区座位，放着不渲染任何东西。
  { id: '@deepseek-ai/dsh-client-ui-settings-plugins', reason: 'Plugins section; only the settings tree needs it after settings became a page' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', reason: 'plugin-inventory section; only the settings tree needs it after settings became a page' },
]

/**
 * sidebar 树 block list（#70，#71 瘦身）：官方外框 + 对话流卡片组 + 设置
 * 子页组。保留闭包：ui-settings（settingsScope 服务提供方，theme 依赖）、
 * ui-input-trigger（ui-cordis 的 inputTriggers 依赖）、ui-cordis（底部动作条）、
 * ui-commands（commandUi 服务，#164）。
 */
// 侧栏树专属追加：真正的对话区组件（卡片宿主 ui-conversation、卡片组 ui-chat、
// 会话级 seat agent-preset）——侧栏这棵树没有对话区。
//
// ui-commands 与 ui-permission-presets 曾在这条清单里（#164 更正）。当时挡
// ui-commands 的理由是「slash-command 面板只有对话区用得上」，但官方
// ui-model-selection（模型选择面）**按服务名依赖它**：boot 门报
// `@deepseek-ai/dsh-client-ui-model-selection: pending (waiting for service:
// commandUi)`，而 boot 的规矩是**一个条目没激活就整页抛错**——于是侧栏树整个
// 挂不上（页面上连 `.dshOneTree_root` 都不出现）。ui-model-selection 留在清单外
// （它只在 conversation.input.model 座位渲染，本树不声明那个座位），就必须把
// ui-commands 一起放回来；ui-permission-presets 当初被挡的直接理由就是「依赖
// ui-commands 的 commandUi」，commandUi 回来之后它没有别的冲突点（它的座位
// `conversation.input.permission` 本树同样不声明，放着不渲染任何东西），一并放回。
//
// 为什么日常实例上看不出来：这台机器的日常 profile 装了 `@dsh-one/dsh-llm-provider`，
// 它的 bundle patch 关掉了官方模型管理那几件，ui-model-selection 压根不在 wire 里，
// 也就没人去等 commandUi。#164 立的门禁（F-55，在**自起的全新 `DSH_HOME`** 上跑）
// 就是为了让这一类「只有干净 profile 才暴露」的缺口在实验室先红。
const SIDEBAR_ONLY: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'chat flow cards (large segment); the settings tree needs its Conversation-display settings row; the sidebar tree does not' },
  { id: '@deepseek-ai/dsh-client-ui-conversation', reason: 'conversation card host; the settings tree needs its composer settings rows (Conversation display / Enter behavior); the sidebar tree does not' },
  { id: '@deepseek-ai/dsh-client-ui-agent-preset', reason: 'session-scoped seat mounted in the conversation hero; nowhere to render in the sidebar tree' },
]

export const SIDEBAR_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [UI_LAYOUT, ...CHAT_FLOW, ...SETTINGS_PAGES, ...SIDEBAR_ONLY]

/**
 * chat 树 block list（#64 行为 + #71 瘦身）：官方外框、官方侧栏、设置子页组。
 * 对话流卡片全保留（本树渲染它们）；composer hero 的 agent preset 与权限
 * 选择保留（新会话功能）；官方右栏系（ui-sidebar-right + 文件/终端/文档预览）
 * 不在此列——自有 frame 的 root 条目声明 `rightbar` 座位并渲染它（#79 决策 B），
 * 这几件在这棵树上真生效。
 */
export const CHAT_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [
  UI_LAYOUT,
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    reason: 'no sidebar seat in the chat tree; the sidebar seat is served by the sidebar tree (#70)',
  },
  ...SETTINGS_PAGES,
]

/**
 * settings 树 block list（#70 设置独立成页 + #71 瘦身）：官方外框、官方
 * 侧栏、对话流卡片组。设置四件套/主题/权限/预设全保留（设置页内容）。
 */
export const SETTINGS_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [
  UI_LAYOUT,
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    // 设置页 frame 只声明侧栏壳子槽、不渲染 sidebar——ui-sidebar 的槽注册
    // 在无人声明 'sidebar' 时 loud throw（spike #69 题3 实锤），必须下线
    reason: 'settings tree declares the sidebar shell children but not the sidebar slot; ui-sidebar registration loud-throws when undeclared (#69)',
  },
  ...CHAT_FLOW,
]

/** block list → id 列表。 */
export const blockedIdsOf = (list: ReadonlyArray<BlockedPlugin>): string[] => list.map((b) => b.id)



/** sidebar 树 blocked id。 */
export const SIDEBAR_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(SIDEBAR_BLOCK_LIST)

/** chat 树 blocked id。 */
export const CHAT_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(CHAT_BLOCK_LIST)

/** settings 树 blocked id。 */
export const SETTINGS_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(SETTINGS_BLOCK_LIST)

/** chat 树自有 shell 插件 id（root 外框/layout 桩/ThemePresenter，经 mirror /plugins-local 伺服)。 */
export const SHELL_PLUGIN_ID = '@dsh-one/vscode-shell'

/** sidebar 树自有 frame 插件 id（root 只声明 sidebar + shell.overlay 子槽）。 */
export const SIDEBAR_SHELL_PLUGIN_ID = '@dsh-one/vscode-sidebar-shell'

/**
 * settings 树自有 frame 插件 id（#70 设置独立成页：block list 同 chat 树 =
 * layout + sidebar，官方 SettingsRoot 不进页，设置座位由整页宿主直渲）。
 */
export const SETTINGS_SHELL_PLUGIN_ID = '@dsh-one/vscode-settings-shell'

/**
 * 主题跟随小插件 id（三棵树共用，#70 VS Code 验收）：收到宿主
 * dshOne.setTheme 消息后走官方 theme 服务的注册+setTheme 口覆写方案
 * （非内建 id 不写网关 settings，双前端边界不破）。
 */
export const THEME_FOLLOW_PLUGIN_ID = '@dsh-one/vscode-theme-follow'

/**
 * 侧栏树设置入口影子插件 id（#70 设置独立成页）：single 槽
 * sidebar.settings 以 priority -1 顶掉官方 SettingsRoot，齿轮点击
 * postMessage 宿主开设置面板。
 */
export const SETTINGS_GEAR_PLUGIN_ID = '@dsh-one/vscode-settings-gear'

/**
 * 侧栏树会话桥插件 id（#71）：订阅官方 sessions 服务选中变化，postMessage
 * dshOne.sessionSelected 给宿主（机制层 2 官方服务 API，spike #69 题2 实证）。
 */
export const SESSION_BRIDGE_PLUGIN_ID = '@dsh-one/vscode-session-bridge'

/**
 * chat 树会话启动注入插件 id（#71）：读 __DSH_ONE_BOOT__.sessionId →
 * sessions.open(id)（spike #69 题4 机制实证）+ 活跃/标题上报。
 */
export const SESSION_BOOT_PLUGIN_ID = '@dsh-one/vscode-session-boot'

/**
 * chat 树 git 卡片插件 id（#65 批 1；#83 迁移到宿主能力口与可移植挂载点）。
 *
 * 命名是 `dsh-*` 而非 `vscode-*`（#83）：数据走宿主能力口（`capabilities.gitShow`）、
 * 外链走 `capabilities.openExternal`、扫描与委托挂在**官方对话区容器**
 * （`[data-conversation-scroll]`）上——插件不认任何自有 frame 标记，因此官方 web
 * 侧也能直接用（见 gitCardPlugin.ts 的机制分层）。
 */
export const GIT_CARD_PLUGIN_ID = '@dsh-one/dsh-git-card'

/**
 * chat 树右键菜单插件 id（#65 批 1）：行内码「复制这段」（官方 Menu 原语 +
 * 官方 writeClipboard）。
 *
 * 命名是 `dsh-*` 而非 `vscode-*`（#83）：委托挂在官方对话区容器上（原先挂自有
 * frame 根，官方 web 里那条根不存在、插件整个不工作），本件没有别的宿主耦合。
 */
export const CONTEXT_MENU_PLUGIN_ID = '@dsh-one/dsh-context-menu'

/**
 * chat 树清空件插件 id（#65 批 1）：Esc / Ctrl+C 两次清空 + Ctrl+Z 反悔（写入与
 * 还原全部走官方 composer 的 InputActions 与 conversation 服务，见
 * composerClearPlugin.ts 的机制分层）。
 *
 * 命名是 `dsh-*` 而非 `vscode-*`（#83）：键位监听挂在官方对话区容器上（composer
 * 座位就在这棵子树里），只依赖官方座位属性。
 */
export const COMPOSER_CLEAR_PLUGIN_ID = '@dsh-one/dsh-composer-clear'

/**
 * chat 树会话日志导出自有行动 id（#71 验收返修；#84 迁移到宿主能力口）。
 *
 * 命名是 `dsh-*` 而非 `vscode-*`：#84 把「下载这份导出」交给宿主能力口
 * （VS Code 侧 = 扩展宿主弹保存框写盘；官方 web 侧 = 浏览器原生下载），
 * 插件本身不再碰 VS Code 通道，因此官方 web 侧也能直接用（见
 * sessionExportPlugin.ts 的机制分层）。
 */
export const SESSION_EXPORT_PLUGIN_ID = '@dsh-one/dsh-session-export'

/**
 * 侧栏树工作区/会话树 shadow 插件 id（#65 批 2）：single 槽 sidebar.workspaces
 * 以 priority -1 顶掉官方 ui-workspace 的 WorkspaceBrowser，自有树整块接管
 * 浏览区（分节头 + 分组折叠树 + 会话行），数据全部经官方 sessions/workspaces
 * 服务（见 workspaceTreePlugin.ts 的机制分层）。
 *
 * 命名是 `dsh-*` 而非 `vscode-*`（#83）：本件零宿主耦合——不调 hostCall、
 * 不碰 acquireVsCodeApi，数据全取官方 hooks、动作全走官方服务、样式全用官方
 * token，因此官方 web 侧也能直接用（拆包/挂载点挪出我们 frame 的收尾工作见 #83）。
 */
export const WORKSPACE_TREE_PLUGIN_ID = '@dsh-one/dsh-workspace-tree'

/** 从网关 `/` 注入 HTML 提取 __DSH_BOOT__ JSON（官方把 `<` 转义成 \u003c，JSON.parse 直接还原)。 */
export function extractBootWire(html: string): BootWire {
  const m = /globalThis\["__DSH_BOOT__"\] = (\{[\s\S]*?\})<\/script>/.exec(html)
  if (m === null) throw new Error('assembly wire: gateway HTML has no __DSH_BOOT__ injection')
  try {
    return JSON.parse(m[1]) as BootWire
  } catch (err) {
    throw new Error(`assembly wire: __DSH_BOOT__ JSON parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 从网关 `/` 注入 HTML 解析前端资产名（module js / modulepreload / css，全部相对路径)。 */
export function extractFrontendAssets(html: string): GatewayAssets {
  const moduleJs = /type="module"[^>]*src="\.\/(assets\/[^"]+)"/.exec(html)?.[1]
  if (moduleJs === undefined) throw new Error('assembly wire: gateway HTML has no module script asset')
  const preloadJs = [...html.matchAll(/modulepreload"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const css = [...html.matchAll(/stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  if (preloadJs.length === 0 || css.length === 0) {
    throw new Error('assembly wire: gateway HTML has no modulepreload/stylesheet assets')
  }
  return { moduleJs, preloadJs, css }
}

/**
 * 过滤 wire：按 blockList 剔除条目（默认 chat 树）；application 批 combo URL
 * 改指 mirror 的 /plugins-local（mirror 伺服剥掉 blocked 段的官方原 combo)；
 * 追加自有 shell entry 与共用插件（默认追加主题跟随插件，三棵树都装），并入
 * application 批；bootstrap 批原样不动。
 *
 * combo URL 的 rev 是我们拼的缓存键：官方那半（网关算出来的 `appBatches[0].rev`）
 * 加本地那半（`localRev`，见 comboRev 的推导）。官方下发的 application 批可能不止
 * 一个（combo URL 有长度上限，官方按图里的顺序切段，见 filterWire 内的注释）：
 * 这里跨全部批过滤，再把它们合回一个批。
 */
export function filterWire(
  wire: BootWire,
  blockList: ReadonlyArray<BlockedPlugin> = CHAT_BLOCK_LIST,
  shellPluginId: string = SHELL_PLUGIN_ID,
  extraPluginIds: readonly string[] = [THEME_FOLLOW_PLUGIN_ID],
  /**
   * 本地那份插件产物（`dist/assembly/plugins`）的内容版本，由宿主现算
   * （`server/localBundleRev.ts`）。进 combo URL 的缓存键，是 #173 的修复点：
   * 少了它，重建自己的 bundle 不改 URL、webview 就吃满 24h immutable 缓存。
   */
  localRev: string,
  /** 诊断回调（block list 与实际清单对不上时报告，不阻断）——宿主传 logger。 */
  onWarn?: (line: string) => void,
): BootWire {
  const blockedIds = blockedIdsOf(blockList)
  const blocked = new Set(blockedIds)
  const entries = wire.entries.filter((e) => !blocked.has(e.id))
  const bootstrap = wire.batches.find((b) => b.phase === 'bootstrap')
  // 官方把 application 阶段按 combo URL 的长度上限（client-modules 的
  // partitionComboRecords，3KB）切成若干批——批与批之间没有语义差别，都是同一份
  // 依赖图里的连续一段。所以「有哪些要过滤」必须跨**全部** application 批求并集：
  // 只看第一批时，插件多一个就把排在最后的 id 挤进第二批，自检会把「落在第二批」
  // 误判成「清单对不上」而抛错（#165 干净 profile 上整页打不开的根因）。
  const appBatches = wire.batches.filter((b) => b.phase === 'application')
  if (appBatches.length === 0 || bootstrap === undefined) {
    throw new Error('assembly wire: missing bootstrap/application batch')
  }
  const appEntries = appBatches.flatMap((b) => b.entries)
  const keptIds = appEntries.filter((id) => !blocked.has(id))
  // block list 与实际清单的一致性（#165 重写）：判据是**集合关系**，不是首批的条数。
  // 一个被 block 的 id 落在哪一批都行（只要落在某一批里，mirror 剥段就够得着它）；
  // 剩下两种对不上仍然硬抛，判据没有放宽——
  //   ① 在 wire.entries 里、却不在任何 application 批里：过滤管道够不着它（官方
  //      把它挪进 bootstrap 批或换了装载阶段时是这种），它会被原样下发；
  //   ② 在某一批 application 里、却不在 wire.entries 里：清单与批次自相矛盾。
  // 而「网关清单里根本没有这个 id」（官方把插件合并/下线，正常演进）不算不一致，
  // 也不该阻断装配——抛错会让面板整个打不开，所以那一类只报告（warn）。「不阻断」
  // 不等于「没人管」：清单与现实漂移（官方改名 → 我们的过滤静默失效 → 官方件混进
  // 树里）由浏览器验证的 **F-11 WIRE-LIVENESS** 套件硬断言把关——它拿当天网关的
  // wire 逐棵树核 block list 的每一项，红了就报「哪棵树 + 哪个 id + 可能被改名/
  // 换装载方式」（#91）。这两条报错与那条 warn 的文案各自点名情形，日志里一眼可分。
  const blockedInWire = new Set(blockedIds.filter((id) => wire.entries.some((e) => e.id === id)))
  const blockedInApp = new Set(appEntries.filter((id) => blocked.has(id)))
  const unfilterable = [...blockedInWire].filter((id) => !blockedInApp.has(id))
  if (unfilterable.length > 0) {
    throw new Error(
      `assembly wire: blocklist entries are in the gateway wire but in no application batch, so the filter cannot strip them: ${unfilterable.join(', ')}`,
    )
  }
  const phantom = [...blockedInApp].filter((id) => !blockedInWire.has(id))
  if (phantom.length > 0) {
    throw new Error(
      `assembly wire: blocklist entries are in an application batch but absent from the gateway wire entries: ${phantom.join(', ')}`,
    )
  }
  const absent = blockedIds.filter((id) => !blockedInWire.has(id))
  if (absent.length > 0) {
    onWarn?.(
      `assembly wire: blocklist entries absent from the gateway wire (not filtered, harmless unless renamed upstream): ${absent.join(', ')}`,
    )
  }
  // 自有插件本就在网关清单里（用户按 docs/plugin-packages.md 把包装进了 profile）时
  // 不再叠加本地那份：同一个 id 两条 entry 会让客户端当场抛 duplicate graph entry，
  // 而两边的 bundle 同源（build.mjs 把包产物拷进 dist/assembly/plugins），取哪一份
  // 都不改行为（#165 干净 profile 上 chat / sidebar 树打不开的第二个原因）。
  const localIds = [shellPluginId, ...extraPluginIds].filter((id) => !entries.some((e) => e.id === id))
  const appRev = appBatches[0].rev
  // combo URL 的 rev 就是 webview 的缓存键（镜像按 URL 原样回 24h `immutable`），
  // 它必须同时代表这份整包的两半内容：
  //   - 官方那半 = appRev（网关按内容校验算出的版本，官方自己就把它挂在原 combo URL 上）；
  //   - 本地那半 = localRev（dist/assembly/plugins 的内容哈希，宿主每次装配现算）。
  // 只带 appRev 时，我们重建自己的 bundle 不改 URL、也不改镜像的 ETag，webview 吃满
  // 24h immutable 缓存（连条件请求都不发）→ 改了样式 reload 也看不到，扩展升级后用户
  // 也可能停在旧界面（#173）。两半都在里面之后：本地 bundle 一变缓存键就变（浏览器按
  // 新 URL 重取），两边都没变时 URL 一字不变、长缓存照旧（#71 的初衷：跨 tab 命中
  // HTTP 缓存、整包网络字节≈0）。官方那半也照旧：官方没发新版、本地没变 → URL 不变。
  // 本地一件都不进 URL 时（用户把自有包装进了 profile，id 全由网关整包提供）不加这一
  // 半——那份内容本来就是官方的，本地 dist 变不该让用户重下整个整包。
  const comboRev = localIds.length > 0 ? `${appRev}-${localRev}` : appRev
  for (const id of localIds) {
    entries.push({ id, url: `/plugins-local/??${id}/client.js&rev=${comboRev}`, rev: comboRev })
  }
  const comboIds = [...keptIds, ...localIds]
  return {
    rev: wire.rev,
    entries,
    batches: [
      bootstrap,
      {
        phase: 'application',
        // 官方有几个 application 批，这里就合回一个（客户端只按批取它要的那个 bundle，
        // 合批不改变装载顺序与时机；官方分批的唯一理由是 combo URL 的长度上限）。
        // mirror 的 /plugins-local：combo 含 kept + 本地插件；mirror 拉官方原
        // combo 剥 blocked 段、拼上本地 bundle 后伺服；rev 是上面那份双半缓存键。
        url: `/plugins-local/??${comboIds.map((id) => `${id}/client.js`).join(',')}&rev=${comboRev}`,
        rev: comboRev,
        entries: comboIds,
      },
    ],
  }
}
