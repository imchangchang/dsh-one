/**
 * blocklist 模式的运行时装配清单（#64，#70 起按树参数化）：面板打开时扩展宿主
 * （node 侧，无 CORS）用 serverAuth 的 cookie GET 网关 `/`，从注入 HTML 提取官方
 * __DSH_BOOT__ wire 与前端资产名，按该树的 block list 过滤后内联进装配页——
 * 插件集 = 网关启动的全量插件 − block list + 自有外框插件。
 * （替代原静态 allowlist：18 包 pin + 构建期 manifest.json 已删除。)
 *
 * 关键事实（探针结论，见 #64 汇报)：
 * - 网关 **拒绝任意重拼的 combo**（rev 是内容校验，重拼即 404)，单包 URL
 *   也只认各自的精确 rev——所以过滤不是改 URL 指向网关，而是：
 *   application 批 URL 改指 mirror 的 /plugins-local（mirror 拉官方原 combo
 *   按 __ModuleLoader__.load 边界剥掉 blocked 段后伺服，见 assemblyMirror)。
 * - bootstrap 批只有 client-modules，永不过滤。
 *
 * 三棵树三份 block list（#70 立、#71 瘦身、#180 逐条复核、#202 / #204 续）：
 * - chat 树（装配对话区）：官方外框 + 官方侧栏都下线（#64 行为不变）；
 *   对话区本身在这棵树上，对话流卡片全保留。
 * - sidebar 树（侧栏位装配）：官方外框 + 对话区那几件下线，官方侧栏（品牌位/
 *   工作区树/设置入口/底部动作）原样进侧栏位。
 * - settings 树（设置独立成页）：官方外框 + 官方侧栏 + 对话区那几件下线，
 *   设置子页组保留（那正是这一页的内容）。
 *
 * 每一条为什么在**这一棵**树上还要下线，理由写在各自的清单里（#180：22 个 id
 * 逐条复核过一遍，判据是「这棵树有没有声明它注册的槽位」——没声明的整件停车，
 * 放回来不会多渲染任何东西，就不该继续挂在依赖名单上）。
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
  // 容器形态冲突；由 @dsh-one/vscode-chat-ui-layout（chat 树）/ @dsh-one/vscode-sidebar-ui-layout
  // （sidebar 树）/ @dsh-one/vscode-settings-ui-layout（settings 树）接管根组合。
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
 * 对话流卡片组，**只在 settings 树里下线**（#71 瘦身，2026-09-18 #180 逐条复核后
 * 从这里摘掉了 sidebar 树；2026-09-22 #225 又把 `ui-plan` 从这份清单里挪进了
 * `FLOW_BOTH_TREES`——理由从形态变成了服务，见那里的注释）。
 *
 * 为什么 sidebar 树不必再下线它们：这 6 件注册的槽位全在对话区（`conversation.*` /
 * `tool.call.*`），而 sidebar 树**一个都没声明**——它的 frame 只声明 `sidebar` 与
 * `shell.overlay`，官方 ui-conversation（那些槽位的声明方）也在这棵树上被下线，
 * 整棵对话子树因此不存在（#180 在真树上读过槽位声明表：sidebar 树共 10 个名字，
 * 一个 `conversation.*` 都没有）。槽位没声明 = 官方 `slots.inject` 的回调永不跑 =
 * 整件停车、不渲染任何东西、不抛错，所以在那棵树上挂着它只是白背一个 id 依赖。
 *
 * 为什么 settings 树继续下线：设置页声明了 keyed `main`（#74：官方 ui-conversation
 * 的整棵对话子树挂在这个名字上，不声明它，官方 ui-agent-preset 的会话级 scope 会抛
 * `slot "conversation.hero.agentPreset" is not declared`），于是这些槽位在设置页里
 * **是声明了的**，放回会真的注册进那棵子树。今天渲染不出来只因为设置页只渲染自己
 * 那条 keyed 条目（`renderSlot('main', {}, { entryKey: dshOne.settings })`）——把设置页
 * 的形态押在「我们恰好只渲染一条 keyed 条目」这条实现事实上不划算，所以这棵树继续
 * 下线。判据是「这棵树有没有声明它注册的槽位」，不是「放回去今天看起来会不会变」。
 *
 * 放回 sidebar 树那一步的 inject 闭包核过（7 件的 inject 服务在那棵树里都有提供方）：
 * `slots` / `sessions` / `locale` / `remote.*` 与树无关；`commandUi` 由 ui-commands
 * 提供（#164 起三棵树都不下线它）、`sidebarRight` 由 ui-sidebar-right 提供，两件都没
 * 被下过线。缺服务是硬约束——boot 的规矩是一个条目没激活就整页抛错（#164 现场）。
 */
const FLOW_SETTINGS_TREE: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-tool', reason: 'tool-call cards; the settings tree declares the conversation seats (via keyed `main`) but is not a conversation page' },
  { id: '@deepseek-ai/dsh-client-ui-attachment', reason: 'message attachment gallery; the settings tree declares the conversation seats (via keyed `main`) but is not a conversation page' },
  { id: '@deepseek-ai/dsh-client-ui-subagent', reason: 'subagent cards; the settings tree declares the conversation seats (via keyed `main`) but is not a conversation page' },
  { id: '@deepseek-ai/dsh-client-ui-jobs', reason: 'background-jobs cards; the settings tree declares the conversation seats (via keyed `main`) but is not a conversation page' },
  { id: '@deepseek-ai/dsh-client-ui-message-feedback', reason: 'message feedback; the settings tree declares the conversation seats (via keyed `main`) but is not a conversation page' },
  { id: '@deepseek-ai/dsh-session-log-export', reason: 'session-log export (routed through the host save-dialog action, #71); its seat is declared in the settings tree but nothing renders there' },
]

/**
 * 对话区那几件里**两棵树都要下线**的（sidebar + settings）：多一个硬理由，不只是形态。
 *
 * - 前五件（workflow-run / deliverables / trajectory / goal / plan）的 inject 里都有
 *   官方 `uiConversation` 服务，而这个服务由 ui-conversation 提供——sidebar 树下线了
 *   ui-conversation，服务不存在，放回它们会停在「未激活」，boot 一个条目没激活就整页
 *   抛错（#164 现场：`@deepseek-ai/dsh-client-ui-model-selection: pending (waiting for
 *   service: commandUi)`，整页连自有根节点都不出现）。这是**服务级**硬约束，不是形态
 *   判断。settings 树里这个服务在（ui-conversation 只被 sidebar 树下线），所以那棵树
 *   的理由仍是上一条清单的形态理由。
 *
 *   ui-plan 是 2026-09-22（#225）从 `FLOW_SETTINGS_TREE` 挪过来的：它在
 *   **0.1.6-alpha.2** 里开始等 `uiConversation`（官方 `dsh-client-ui-plan/lib/client.js`
 *   的导出 `inject` 表里多出这个名字，alpha.1 没有），于是同一件事在 sidebar 树上重演——
 *   面板出现官方启动审计失败 `web boot: 1 entry did not activate` /
 *   `@deepseek-ai/dsh-client-ui-plan: pending (waiting for service: uiConversation)`，
 *   页面被那张失败卡挡住（F-01 复现 35/43，红的 8 条全在侧栏两棵树）。挪完之后
 *   `FLOW_SETTINGS_TREE` 里不再留它的重复定义；那棵树照旧下线它，只是走本清单这条。
 * - directory-picker-native 注册的两处槽位里，`sidebar.workspaces.directoryFlow`
 *   在 **sidebar 树真被声明**（官方 ui-workspace 的 WorkspaceBrowser 声明它，自有树
 *   还要读它的占用态做「官方目录选择器接管」，见 dsh-workspace-tree）：放回它就会往
 *   我们自己的树里注册官方原生目录选择器，形态与 #176 那条添加工作区流程都会变。
 *   它在 settings 树里的两处槽位同样都被声明（`conversation.hero.workspace.directoryFlow`
 *   随 ui-conversation 的子树成立、`sidebar.workspaces.directoryFlow` 由 ui-workspace
 *   声明），所以两棵树都继续下线。
 */
const FLOW_BOTH_TREES: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-workflow-run', reason: 'injects the official `uiConversation` service, which the sidebar tree does not provide (ui-conversation is blocked there); boot fails when an entry never activates' },
  { id: '@deepseek-ai/dsh-client-ui-deliverables', reason: 'injects the official `uiConversation` service, which the sidebar tree does not provide (ui-conversation is blocked there); boot fails when an entry never activates' },
  { id: '@deepseek-ai/dsh-client-ui-trajectory', reason: 'injects the official `uiConversation` service, which the sidebar tree does not provide (ui-conversation is blocked there); boot fails when an entry never activates' },
  { id: '@deepseek-ai/dsh-client-ui-goal', reason: 'injects the official `uiConversation` service, which the sidebar tree does not provide (ui-conversation is blocked there); boot fails when an entry never activates' },
  { id: '@deepseek-ai/dsh-client-ui-plan', reason: 'injects the official `uiConversation` service since 0.1.6-alpha.2 (#225), which the sidebar tree does not provide (ui-conversation is blocked there); boot fails when an entry never activates' },
  { id: '@deepseek-ai/dsh-client-ui-directory-picker-native', reason: 'native directory picker; its `sidebar.workspaces.directoryFlow` seat is declared in the sidebar tree by the official WorkspaceBrowser, and the settings tree declares both of its seats' },
]

/**
 * #180 从这份名单里摘除的（留档，别再挂回去）：
 *
 * - **ui-reference**：**没有任何槽位贡献**（12.5KB 的 client.js 里一次
 *   `slots.register` / `slots.inject` 都没有，只注册 `@` 触发源与自己的词典，
 *   见官方 `dsh-client-ui-reference/lib/client.js` 的 `apply`）。它在对话区里也
 *   只是给 composer 的 `@` 菜单贡献候选，自己什么也不画——原来那条
 *   「reference cards; no conversation area」的理由是错的。两棵树里放回都
 *   零渲染。
 * - **ui-skill**：唯一注册的槽位是 `tool.call.toolview`，而这个槽位由 ui-tool
 *   声明、ui-tool 在两棵树里都下线 ⇒ 两棵树都没声明它 ⇒ 整件停车（另有一处
 *   `/` 触发源注册，只在 composer 渲染时才有去处）。两棵树里放回都零渲染。
 *
 * - ui-approval / ui-user-questions 更早（2026-09-17）就已摘除：它们是官方安装里
 *   唯二**真的会发布**会话等待态的插件（第三个调用点 ui-session 只注册那条口子、
 *   自己不发布），而等待态正是侧栏会话行黄点的数据源（#140）——把发布者挡掉，
 *   侧栏页的等待态表恒空，等提问 / 等审批的会话就显示成绿点。它们的卡片只往
 *   `conversation.composer` 槽位渲染，官方那两件用的是 `slots.inject`（等目标槽名
 *   被声明后再注册的正规挂法），sidebar 树没声明那个槽位、注册条件永不满足，所以
 *   在那棵树上放行既不多渲染东西也不抛错。（**更正**：#180 在真树上读声明表时发现
 *   「侧栏 / 设置两棵树里没人声明这个槽位」这句原注释只对 sidebar 树成立——设置页
 *   声明了 keyed `main`，`conversation.composer` 在那棵树里是声明了的。）
 * - ui-model-selection 也曾在这条清单里。2026-09-16 摘除，当时的理由写的是
 *   「0.1.6-alpha.1 的 wire 里已经没有这个条目」——**那条观察是错的**（#164 更正）：
 *   它看到的 wire 来自日常 profile，而那台机器装了另一仓的 `@dsh-one/dsh-llm-provider`，
 *   它的 bundle patch 里 `disabled: true` 把 `ui-model-selection` 与
 *   `ui-settings-models` 两行禁掉了；全新 `DSH_HOME` 上这两条一直在官方 wire 里
 *   （0.1.6-alpha.1 实测，见 F-55）。教训：**「官方有没有这个插件」只能看全新
 *   `DSH_HOME` 的 wire**，被自己的补丁改过的 profile 拿来做这个判断一定得出反的结论。
 *   它今天三棵树都不下线：只在 `conversation.input.model` 槽位渲染，sidebar 树没声明
 *   那个槽位（停车），settings 树声明了但不渲染对话区。
 */

/** 设置子页组（#71 瘦身）：设置独立成页后 **sidebar 树**不再载设置子页。 */
const SETTINGS_PAGES: ReadonlyArray<BlockedPlugin> = [
  // ui-settings-models 曾在这条清单里（Models 设置节）。2026-09-16 摘除，当时的理由
  // 与上面那一段摘除留档里 ui-model-selection 同一份错误观察（日常 profile 被另一仓的
  // `@dsh-one/dsh-llm-provider` 补丁改过），更正与教训见那一段。
  // 它留在清单外是对的：chat / sidebar 两棵树不声明设置区槽位，放着不渲染任何东西。
  //
  // 下面这两件从 chat 树摘除（#204）、**留在 sidebar 树**（理由与实测读数见
  // CHAT_BLOCK_LIST 的注释）。两棵树里它们都停车，差别只在处置口径：chat 树那一份摘了
  // （本 issue 的整改对象），sidebar 树那一份沿用 #180 对同类「纯流量代价」项的做法——
  // 挂着它不花用户一分流量，摘掉只是少一个 id 依赖。
  { id: '@deepseek-ai/dsh-client-ui-settings-plugins', reason: 'Plugins section; parked in the sidebar tree because ui-settings-general (the declarer of its seats via SettingsRoot) is blocked there, and only the settings tree needs it' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', reason: 'plugin-inventory section; parked in the sidebar tree because ui-settings-general (the declarer of its seats via SettingsRoot) is blocked there, and only the settings tree needs it' },
]

/**
 * `@deepseek-ai/dsh-client-ui-settings-general`（General 设置节 + 设置弹窗壳
 * `SettingsRoot` + 连接状态那枚提示）**只在 sidebar 树继续下线**（#202 逐条复核）。
 *
 * 判据照 #180 那条「这棵树有没有声明它注册的槽位」。它注册的槽位
 * （`settings.trigger` / `settings.header` / `settings.action` / `settings.close` /
 * `settings.section` / `settings.onboarding`）全是 `sidebar.settings` 的**子槽**
 * （官方 `dsh-client-ui-settings-general/lib/client.js` 的 `apply`：`ctx.slots.inject
 * ("sidebar.settings", …)` 里那份 children 表），而 `sidebar.settings` 只有官方
 * **侧栏壳**声明（`dsh-client-ui-sidebar/lib/client.js` 的 `sidebar` 注册 children 表）：
 *
 * - **sidebar 树继续下线**：这棵树的官方侧栏壳在，`sidebar.settings` 声明得了 ⇒ 它的
 *   `SettingsRoot` 会真的注册进来。我们那行设置入口（`@dsh-one/vscode-settings-gear`）
 *   按 priority −1 遮蔽它，所以照旧下线、不靠遮蔽兜底。
 * - **chat 树摘除（#202）**：这棵树没有官方侧栏壳，`sidebar.settings` 一个槽位都没声明，
 *   它那几处贡献的回调永不跑、整件停车、零渲染——挂着它只是白背一个官方 id 依赖。
 *
 * 摘除前在实验室实测过（#202）：chat 树放行前后页面的**元素集合**（`tag + data-slot +
 * class` 排序）逐项一致、设置槽位锚点仍是零枚 ⇒ 放行**不会**把设置页面的东西带进
 * 对话区。代价是官方那枚断线提示也**拿不回来**：它渲染在 `SettingsRoot` 的 triggerRow
 * 里，而那行要 `sidebar.settings` 槽位。所以对话区那行提示由自有 frame 插件自己出
 * （`@dsh-one/vscode-chat-ui-layout`，见 chatLayoutPlugin.ts 的 `connectionHint` 段）。
 */
const SETTINGS_GENERAL: BlockedPlugin = {
  id: '@deepseek-ai/dsh-client-ui-settings-general',
  reason: 'General section (owns SettingsRoot/modal): the sidebar tree declares its seats through the official sidebar shell, so its SettingsRoot does register there; the settings tree needs it to render, the chat tree declares none of its seats',
}

/**
 * sidebar 树 block list（#70，#71 瘦身；#180 起不再背对话流卡片的 id）：官方外框 +
 * 对话区里两棵树都得下线的那几件（`FLOW_BOTH_TREES`，含 #225 起加进来的 ui-plan）
 * + 设置子页组 + 侧栏树专属（真正的对话区组件）。
 * 保留闭包：ui-settings（settingsScope 服务提供方，theme 依赖）、ui-input-trigger
 * （ui-cordis 的 inputTriggers 依赖）、ui-cordis（底部动作条）、ui-commands
 * （commandUi 服务，#164）。
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
// （它只在 conversation.input.model 槽位渲染，本树不声明那个槽位），就必须把
// ui-commands 一起放回来；ui-permission-presets 当初被挡的直接理由就是「依赖
// ui-commands 的 commandUi」，commandUi 回来之后它没有别的冲突点（它的槽位
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

export const SIDEBAR_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [UI_LAYOUT, ...FLOW_BOTH_TREES, SETTINGS_GENERAL, ...SETTINGS_PAGES, ...SIDEBAR_ONLY]

/**
 * chat 树 block list（#64 行为 + #71 瘦身 + #202 + #204）：官方外框 + 官方侧栏。
 * 对话流卡片全保留（本树渲染它们）；composer hero 的 agent preset 与权限
 * 选择保留（新会话功能）；官方右栏系（ui-sidebar-right + 文件/终端/文档预览）
 * 不在此列——自有 frame 的 root 条目声明 `rightbar` 槽位并渲染它（#79 决策 B），
 * 这几件在这棵树上真生效。
 *
 * 摘到这里只剩两条（`ui-layout` + `ui-sidebar`，都是「与 VS Code 容器冲突」的形态
 * 理由，不是 id 依赖）：
 *
 * - #202 起不含 `ui-settings-general`（理由见 SETTINGS_GENERAL 的注释）。
 * - #204 起不含 `ui-settings-plugins` 与 `ui-settings-plugin-inventory`：这两件与
 *   上一条同形——它们等待声明的槽位（`settings.section` / `settings.plugins.tab` /
 *   `settings.plugin.item`）全在 `sidebar.settings` 之下，而那是个设置子槽，本树
 *   **一处都没声明**（#204 在同一轮里真读了本树的槽位声明表：46 个名字，
 *   `sidebar` / `sidebar.settings` / `settings.*` 一个都没有）⇒ 这几处贡献的回调
 *   永不跑、整件停车、零渲染，挂着只是白背两个官方 id 依赖。
 *
 *   **摘除前的实测**（各一台自起的全新 `DSH_HOME` 隔离实例，只换这份清单里那两个
 *   id）：本页 combo 58 → 60 条（两件真的进来了）、12 枚槽位锚点逐枚同值
 *   （`settings.section` / `settings.plugins.tab` / `settings.plugin.item` 三处两边
 *   都是 0）、整页截图 md5 相同（`128cc584…`）、元素集合逐项相同**只多出它们自己
 *   注入的 5 张 `<style>`**（那 5 张的 125 条规则拿去 `querySelectorAll` 命中页面上
 *   0 个元素）、零崩溃 / 零未激活 / 零 pageerror、正文逐字相同。
 */
export const CHAT_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [
  UI_LAYOUT,
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    reason: 'no sidebar seat in the chat tree; the sidebar seat is served by the sidebar tree (#70)',
  },
]

/**
 * settings 树 block list（#70 设置独立成页 + #71 瘦身）：官方外框、官方侧栏、
 * 对话流卡片组（两棵树都下线的那 6 件 + 只在设置树下线的 6 件）。设置四件套/
 * 主题/权限/预设全保留（设置页内容）。
 */
export const SETTINGS_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [
  UI_LAYOUT,
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    // 设置页 frame 只声明侧栏壳的四个子槽（品牌位/工作区树/底部动作），不声明
    // `sidebar` 槽位本身、也不渲染它——所以官方 ui-sidebar 的注册**不会被触发**
    // （它的 register 在 `ctx.slots.inject("sidebar", …)` 里，
    // dsh-client-ui-sidebar/lib/client.js:375：槽位没声明就整件停车）。
    // spike #69 当年写的理由（「无人声明 'sidebar' 时 loud throw」）在
    // 0.1.6-alpha.1 的官方产物里**不成立**，#180 逐条复核时按源码更正；
    // 下线它的理由改成形态本身：设置页不是侧栏位页，侧栏壳不该进来。
    reason: 'settings tree declares only the sidebar shell children, not the sidebar seat: the settings page is not a sidebar page',
  },
  ...FLOW_BOTH_TREES,
  ...FLOW_SETTINGS_TREE,
]

/** block list → id 列表。 */
export const blockedIdsOf = (list: ReadonlyArray<BlockedPlugin>): string[] => list.map((b) => b.id)

/**
 * 网关**官方那半**整包的内容版本：把所有 application 批的 `rev` 并起来（`#237` 那一轮审的
 * 「第一批 = 全部」同族假设之一）。
 *
 * 为什么不是一个批的 rev：过滤后的整包**覆盖每一批的保留段**（#165 起逐批拉），所以这份键
 * 该代表每一批。
 *
 * **实测口径**（0.1.6-alpha.2，同一个 profile 起两次实例）：批的 rev 不是内容哈希，而是
 * **每进程一份的会话值**——两次启动里两批的 rev 各不相同（`26e588296384`/`2f3068e25a00` 与
 * `76f10095f02e`/`3c4be8c0cad1`）。也就是说内容一变必然重启，重启后每一批的 rev 都跟着变，
 * 所以**今天两种写法在「内容变了没有」这件事上等价**：这不是在修一个已经踩到的洞，而是让
 * 这个键真的代表它所覆盖的内容，不再依赖「所有批的 rev 总是一起变」这条**没人验过**的上游
 * 性质（网关哪天真按内容分批算 rev，第一批不变而第二批变时，只取第一批就会漏）。
 *
 * 批与批之间用一个不可能出现在 rev 里的分隔符 `,` 并起来——所以每一段都先过
 * `encodeURIComponent`（`~` 这类字符不会被它转义，`,` 会被转成 `%2C`）：单批时结果与
 * 从前逐字相同（[0-9a-f-] 那类 rev 编码后不变），多批时分段互不含糊。
 */
export function applicationComboRev(wire: BootWire): string {
  const batches = wire.batches.filter((batch) => batch.phase === 'application')
  return batches.map((batch) => encodeURIComponent(batch.rev)).join(',')
}



/** sidebar 树 blocked id。 */
export const SIDEBAR_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(SIDEBAR_BLOCK_LIST)

/** chat 树 blocked id。 */
export const CHAT_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(CHAT_BLOCK_LIST)

/** settings 树 blocked id。 */
export const SETTINGS_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(SETTINGS_BLOCK_LIST)

/** chat 树自有外框插件（frame 插件）id（root 外框/layout 桩/ThemePresenter，经 mirror /plugins-local 伺服)。 */
export const CHAT_FRAME_PLUGIN_ID = '@dsh-one/vscode-chat-ui-layout'

/** sidebar 树自有 frame 插件 id（root 只声明 sidebar + shell.overlay 子槽）。 */
export const SIDEBAR_FRAME_PLUGIN_ID = '@dsh-one/vscode-sidebar-ui-layout'

/**
 * settings 树自有 frame 插件 id（#70 设置独立成页：block list 同 chat 树 =
 * layout + sidebar，官方 SettingsRoot 不进页，设置槽位由整页宿主直渲）。
 */
export const SETTINGS_FRAME_PLUGIN_ID = '@dsh-one/vscode-settings-ui-layout'

/**
 * 主题跟随小插件 id（三棵树共用，#70 VS Code 验收）：收到宿主
 * dshOne.setTheme 消息后走官方 theme 服务的注册+setTheme 口覆写方案
 * （非内建 id 不写网关 settings，双前端边界不破）。
 */
export const THEME_FOLLOW_PLUGIN_ID = '@dsh-one/vscode-theme-follow'

/**
 * 侧栏树设置入口遮蔽插件 id（#70 设置独立成页）：single 槽
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
 * uiWorkspace.openSession(id)（spike #69 题4 机制实证；0.1.6-alpha.2 前那条
 * `sessions.open` 已被官方删掉，见 shell/sessionBootPlugin.ts）+ 活跃/标题上报。
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
 * 槽位就在这棵子树里），只依赖官方槽位属性。
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

/**
 * 装配页的阻塞 script 要的就是 bootstrap 批的 URL。按 `phase === 'bootstrap'` 找，
 * **不假定它在 `batches[0]`**（#178 A9）——批次的排列顺序是官方下发的形状，不是契约。
 * 找不到就抛：装配页少了这一段，官方 WebBoot 运行时根本不会启动。
 */
export function bootstrapUrlOf(wire: BootWire): string {
  const bootstrap = wire.batches.find((b) => b.phase === 'bootstrap')
  if (bootstrap === undefined) throw new Error('UI manifest: no bootstrap batch')
  return bootstrap.url
}

/**
 * 事件流（SSE）帧的投影：宿主经 `/plugins/events` 下发的那条流里，`type: "graph"`
 * 的帧带的是**最新一份完整 roster**（host 侧 `dsh-client-hmr` 每次连接都会先推一帧，
 * 之后插件增删再推）。0.1.6-alpha.2 起客户端的条目协调器会**采纳**它——把页面上的
 * 插件条目对齐到这份 roster（`dsh-client-hmr` 的 client 半把 graph 帧交给
 * `ctx.modules.entries.sync`，后者按 roster 建/删条目）。
 *
 * 问题在于这份 roster 是**未过滤**的官方清单：直接采纳会把我们 block 掉的官方插件
 * 装回来、并把我们自己的 frame 插件条目卸掉（条目一没，root 槽的注册就被撤销，
 * 页面报 `renderSlot('root') before any 'root' registration` 整片白——#191）。
 * 所以事件流这一路也要过 blocklist，且必须与页面拿到的 `__DSH_BOOT__` 走**同一个
 * 算法**（`filterWire`，调用方以 `project` 传进来），否则同一条 roster 会有两份规则。
 *
 * 本函数只负责「帧 → 帧」的搬运：SSE 帧由 `data:` 行 + 空行组成（官方单行 JSON），
 * 只有 graph 帧会被 `project` 换掉，其余（注释行、`rebuilt` 帧、空行）一字不动。
 * 0.1.6-alpha.1 上这些帧会被客户端直接忽略（那一版没有条目协调器），所以同一条投影
 * 在 alpha.1 上是空转、在 alpha.2 上是必需——**不需要按版本分叉**。
 *
 * @param frame - 一帧 SSE 文本（含结尾空行）。
 * @param project - 把一份完整 roster 投影成本页该装的那一份；抛错表示这一帧投影不了。
 * @returns 该发给页面的一帧（与入参同形）。`project` 抛的错原样上抛给调用方处置。
 */
export function projectGraphFrame(frame: string, project: (graph: BootWire) => BootWire): string {
  const dataLines = frame.split('\n').filter((line) => line.startsWith('data:'))
  if (dataLines.length === 0) return frame
  let parsed: unknown
  try {
    parsed = JSON.parse(dataLines.map((line) => line.slice('data:'.length).trimStart()).join('\n'))
  } catch {
    // 不是 JSON 的 data 帧（官方形状之外）：不归我们管，原样放行。
    return frame
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: unknown }).type !== 'graph') return frame
  const graph = (parsed as { graph?: unknown }).graph
  if (typeof graph !== 'object' || graph === null) return frame
  const projected = JSON.stringify({ type: 'graph', graph: project(graph as BootWire) })
  const first = frame.indexOf('data:')
  // 投影后的帧只留一行 data：官方客户端只做 JSON.parse(event.data)，多行数据合起来
  // 反而要多写一份 SSE 拼行规则。
  return `${frame.slice(0, first)}data: ${projected}\n\n`
}

/**
 * 事件流请求里带**这一页 boot 基线**的查询参数名（#230）：值是本页清单的 `[id, rev]` 对，
 * 编成 JSON 数组再整体百分号转义（`?ids=…&revs=%5B%5B%22<id>%22%2C%22<rev>%22%5D…%5D`）。
 * 编码端在 `pageHtml.ts` 的 `transportJs`（页面把自己的 `__DSH_BOOT__` 编进去），解码端是
 * 下面的 {@link parseRosterRevs}。
 *
 * 为什么两端不共用一份实现：编码端只能活在页面内联脚本里（它读的 `globalThis.__DSH_BOOT__`
 * 在宿主的 node 侧不存在），所以共享的是**格式**（就这一行），实现各写一份。这条「各写一份」
 * 的风险有两条常驻判据盯着：`test/assemblyEventStream.test.ts` 把页面那份编码端真跑一遍、
 * 再拿这里的解码端解回来逐条比对（#243——格式是从 `id:rev` 逗号分隔改过来的，改的就是
 * 「值里出现分隔符怎么办」），`verify:lab` 的 F-72 在真页面上比对「传上去的基线 = 本页
 * boot 那份清单」。
 */
export const ROSTER_REVS_PARAM = 'revs'

/**
 * 解析 {@link ROSTER_REVS_PARAM}（形状不对时返回空表 = 退化成「不对齐」）。
 *
 * 值是一段 JSON（`[[id, rev], …]`），由页面侧编好之后整体百分号转义，这里拿到的已经是
 * URL 层解好的字符串（`URL.searchParams.get` 自己会解一层）。
 *
 * 为什么是 JSON 而不是 `id:rev` 逗号分隔（#243）：那个格式**假定分隔符不出现在值里**，
 * 而这条假定在 0.1.7 上不成立——自有条目的 `rev` 是整包缓存键 `appRev-localRev`，`appRev`
 * 把每一个 application 批的 rev 用 `,` 并起来（见 {@link applicationComboRev}），0.1.7 起
 * 官方把 application 切成两批，于是这个值里真的带着一个 `,`。被当成「下一对开始了」之后，
 * 这一条的 rev 截成前一半：镜像据此对齐，等于告诉客户端「这几条变了」——客户端先拆后建，
 * 拆掉自有 frame 插件那条时 `root` 槽的注册随之撤销，页面报
 * `renderSlot('root') before any 'root' registration (boot order)` 整块白（#243 现场）。
 * 只加一层「每半各自百分号转义」修不了它：读端是 `searchParams.get`，URL 层已经把 `%2C`
 * 解回 `,` 了，分隔符照样有歧义；JSON 的括号与引号是自己带出来的结构，值里出现什么都不影响。
 *
 * 宽容的理由：这个参数的唯一用途是「对齐」，解析不出来时退化成不对齐（= 改前的行为），
 * 而不是让页面连事件流都开不出来。长度上限只是护栏（node 自己的请求头上限是 64KB 量级，
 * 正常一份清单 ≈ 4KB）。JSON 之前那一版页面编出来的 `id:rev` 逗号分隔串照旧认（见
 * {@link parseLegacyRosterRevs}）：扩展升级时还开着的旧 webview 会拿旧格式来问这条流。
 */
export function parseRosterRevs(raw: string): Map<string, string> {
  if (raw === '' || raw.length > MAX_ROSTER_REVS_CHARS) return new Map()
  return parseRosterRevsJson(raw) ?? parseLegacyRosterRevs(raw)
}

/** JSON 那一档（{@link parseRosterRevs} 的现行格式）；形状不对返回 undefined，交给旧格式那一档。 */
function parseRosterRevsJson(raw: string): Map<string, string> | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  const revs = new Map<string, string>()
  for (const pair of value) {
    if (!Array.isArray(pair)) continue
    const [id, rev] = pair as [unknown, unknown]
    if (typeof id !== 'string' || typeof rev !== 'string' || id === '' || rev === '') continue
    revs.set(id, rev)
  }
  return revs
}

/**
 * JSON 之前那一版（`<id>:<rev>` 逗号分隔、不做任何转义）——只给「扩展升级时还开着的旧
 * webview」用。逐段解、形状不对的段跳过；值里带 `,` 的那些在那边本来就编不明白（那正是
 * #243 的现场），这里不假装能修好，能对上的对上、对不上的就当它没带基线。
 */
function parseLegacyRosterRevs(raw: string): Map<string, string> {
  const revs = new Map<string, string>()
  for (const pair of raw.split(',')) {
    const split = pair.indexOf(':')
    if (split <= 0) continue
    const id = pair.slice(0, split)
    const rev = pair.slice(split + 1)
    if (id === '' || rev === '') continue
    revs.set(id, rev)
  }
  return revs
}

/** `revs` 参数的长度上限（见 {@link parseRosterRevs}）。 */
const MAX_ROSTER_REVS_CHARS = 64 * 1024

/**
 * 名册版本对齐（#230）：把投影出来的 roster 里**每条的 `rev`** 换成这一页 boot 时那份
 * 清单里的值——**名册没变，就不该告诉页面「条目变了」**。
 *
 * 为什么必须对齐：条目的 `rev` 是**每进程随机**的（0.1.6-alpha.2 里 `dsh-client-modules/lib/index.js`
 * 的 `randomBytes(8)` 与 `allocateInitialRevision()`；0.1.7-alpha.2 起换成文件元数据哈希，
 * 同一棵树重启不再变，但这条对齐仍然是必需的——我们自己的条目那份 rev 是整包缓存键，
 * 它会随我们自己的产物变），所以网关一重启，官方经事件流推来的
 * 那份 roster 里**每一条**的 rev 都是新值。0.1.6-alpha.2 起客户端采纳这份 roster
 * （`ctx.modules.entries.sync` → `reconcile`：`revisions.get(id) !== row.rev` 就
 * `replace()`，先拆后建），于是每一条官方插件都被拆掉重建——`dsh-client-ui-session` 的
 * `installScope("session", …)` 随之被撤销，官方渲染器抛
 * `scope 'session-maybe' rendered without an installed adapter`（`SlotAssemblyError`），
 * 而官方 `SlotErrorBoundary` **故意不兜**装配错 → React root 卸载 → 整页白。
 *
 * 这个 rev 在 0.1.6-alpha.2 上不携带内容信息（同一进程内复启动一次就换一批值），在
 * 0.1.7-alpha.2 上是文件元数据哈希——两种口径下「对齐到这一页 boot 那份」都不丢用户能
 * 看到的东西：内容真的变了（网关增删了插件）时 **id 集合**会跟着变，那时本函数原样放行、
 * 不插手；同一批 id 的代码真被重建时走的是另一条路（官方 HMR 的 `rebuilt` 帧）。
 *
 * 只对齐 `rev`：客户端判「这一条变了没有」只读这个字段（`revisions.get(row.id) !== row.rev`，
 * 以及 `entryTargets()` 里的 `[id, rev, inject, external]`）。`url`、批表与顶层 `rev` 保持
 * 投影后的原样——`url` 只是取字节的模板（`atRevision()` 会用条目自己的 rev 重写它的 rev
 * 查询段），留着当前那份才是重启后唯一还能取到字节的地址。
 *
 * @param projected - 已按该树 block list 过滤过的 roster（`filterWire` 的产物）。
 * @param baseline - 这一页 boot 那刻的 `id → rev`（见 {@link parseRosterRevs}）。
 * @returns id 集合相同 = 对齐后的 roster；集合不同 = 原样返回 `projected`。
 */
export function alignRosterRevs(projected: BootWire, baseline: ReadonlyMap<string, string>): BootWire {
  if (baseline.size === 0 || projected.entries.length !== baseline.size) return projected
  const entries: BootWireEntry[] = []
  for (const entry of projected.entries) {
    const rev = baseline.get(entry.id)
    // 集合不同（网关真的增删了插件）：页面该听到这个变化，一个字都不改。
    if (rev === undefined) return projected
    entries.push({ ...entry, rev })
  }
  return { ...projected, entries }
}

/** 从网关 `/` 注入 HTML 提取 __DSH_BOOT__ JSON（官方把 `<` 转义成 \u003c，JSON.parse 直接还原)。 */
export function extractBootWire(html: string): BootWire {
  const m = /globalThis\["__DSH_BOOT__"\] = (\{[\s\S]*?\})<\/script>/.exec(html)
  if (m === null) throw new Error('UI manifest: gateway HTML has no __DSH_BOOT__ injection')
  try {
    return JSON.parse(m[1]) as BootWire
  } catch (err) {
    throw new Error(`UI manifest: __DSH_BOOT__ JSON parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 从网关 `/` 注入 HTML 解析前端资产名（module js / modulepreload / css，全部相对路径)。 */
export function extractFrontendAssets(html: string): GatewayAssets {
  const moduleJs = /type="module"[^>]*src="\.\/(assets\/[^"]+)"/.exec(html)?.[1]
  if (moduleJs === undefined) throw new Error('UI manifest: gateway HTML has no module script asset')
  const preloadJs = [...html.matchAll(/modulepreload"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const css = [...html.matchAll(/stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  if (preloadJs.length === 0 || css.length === 0) {
    throw new Error('UI manifest: gateway HTML has no modulepreload/stylesheet assets')
  }
  return { moduleJs, preloadJs, css }
}

/**
 * 过滤 wire：按 blockList 剔除条目（默认 chat 树）；application 批 combo URL
 * 改指 mirror 的 /plugins-local（mirror 伺服剥掉 blocked 段的官方原 combo)；
 * 追加自有外框插件 entry 与共用插件（默认追加主题跟随插件，三棵树都装），并入
 * application 批；bootstrap 批原样不动。
 *
 * combo URL 的 rev 是我们拼的缓存键：官方那半（网关那几批 application 的 `rev` 并起来，
 * 见 `applicationComboRev`）加本地那半（`localRev`，见 comboRev 的推导）。官方下发的
 * application 批可能不止一个（combo URL 有长度上限，官方按图里的顺序切段，见 filterWire
 * 内的注释）：这里跨全部批过滤，再把它们合回一个批。
 */
export function filterWire(
  wire: BootWire,
  blockList: ReadonlyArray<BlockedPlugin> = CHAT_BLOCK_LIST,
  framePluginId: string = CHAT_FRAME_PLUGIN_ID,
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
    throw new Error('UI manifest: missing bootstrap/application batch')
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
      `UI manifest: blocklist entries are in the gateway wire but in no application batch, so the filter cannot strip them: ${unfilterable.join(', ')}`,
    )
  }
  const phantom = [...blockedInApp].filter((id) => !blockedInWire.has(id))
  if (phantom.length > 0) {
    throw new Error(
      `UI manifest: blocklist entries are in an application batch but absent from the gateway wire entries: ${phantom.join(', ')}`,
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
  const localIds = [framePluginId, ...extraPluginIds].filter((id) => !entries.some((e) => e.id === id))
  const appRev = applicationComboRev(wire)
  // combo URL 的 rev 就是 webview 的缓存键（镜像按 URL 原样回 24h `immutable`），
  // 它必须同时代表这份整包的两半内容：
  //   - 官方那半 = appRev（每一批各有一份 rev，全部并进键里；这份 rev 是**每进程一份的
  //     会话值**而不是内容哈希，见 applicationComboRev 的实测记录——并起来是为了让键真的
  //     代表正文覆盖到的每一批，而不是只代表第一批）；
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
