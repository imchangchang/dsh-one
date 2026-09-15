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

/** 官方外框条目（两棵树共用）：与 VS Code 外壳冲突，由自有 frame 插件接管根组合。 */
const UI_LAYOUT: BlockedPlugin = {
  id: '@deepseek-ai/dsh-client-ui-layout',
  // 官方应用外框，与 VS Code 外壳冲突；由 @dsh-one/vscode-shell（chat 树）/
  // @dsh-one/vscode-sidebar-shell（sidebar 树）接管根组合并提供 layout 服务
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
  { id: '@deepseek-ai/dsh-client-ui-approval', reason: 'approval cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-attachment', reason: 'message attachment gallery; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-subagent', reason: 'subagent cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-jobs', reason: 'background-jobs cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-goal', reason: 'goal cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-plan', reason: 'plan cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-message-feedback', reason: 'message feedback; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-model-selection', reason: 'model-selection surface (inside composer); no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-skill', reason: 'skill cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-reference', reason: 'reference cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-session-log-export', reason: 'session-log export (routed through the host save-dialog action, #71)' },
  { id: '@deepseek-ai/dsh-client-ui-user-questions', reason: 'user-question cards; no conversation area in the sidebar/settings trees' },
  { id: '@deepseek-ai/dsh-client-ui-directory-picker-native', reason: 'native directory picker (VS Code host provides its own picker)' },
]

/** 设置子页组（#71 瘦身）：设置独立成页后 chat/sidebar 树不再载设置子页。 */
const SETTINGS_PAGES: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-settings-general', reason: 'General section (owns SettingsRoot/modal); only the settings tree needs it after settings became a page' },
  { id: '@deepseek-ai/dsh-client-ui-settings-models', reason: 'Models section; only the settings tree needs it after settings became a page' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugins', reason: 'Plugins section; only the settings tree needs it after settings became a page' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', reason: 'plugin-inventory section; only the settings tree needs it after settings became a page' },
]

/**
 * sidebar 树 block list（#70，#71 瘦身）：官方外框 + 对话流卡片组 + 设置
 * 子页组。保留闭包：ui-settings（settingsScope 服务提供方，theme 依赖）、
 * ui-input-trigger（ui-cordis 的 inputTriggers 依赖）、ui-cordis（底部动作条）。
 */
// 侧栏树专属追加：permission-presets 依赖 ui-commands 的 commandUi 服务
//（boot 门「pending (waiting for service: commandUi)」实锤），agent-preset
// 的会话级 seat 挂在对话区——两棵对话树才需要。
const SIDEBAR_ONLY: ReadonlyArray<BlockedPlugin> = [
  { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'chat flow cards (large segment); the settings tree needs its Conversation-display settings row; the sidebar tree does not' },
  { id: '@deepseek-ai/dsh-client-ui-conversation', reason: 'conversation card host; the settings tree needs its composer settings rows (Conversation display / Enter behavior); the sidebar tree does not' },
  { id: '@deepseek-ai/dsh-client-ui-commands', reason: 'slash-command panel; the settings tree needs its commandUi service (permission-presets depends on it); the sidebar tree does not' },
  { id: '@deepseek-ai/dsh-client-ui-permission-presets', reason: 'depends on commandUi (ui-commands service); no conversation area in the sidebar tree; the composer permission picker stays with the chat tree' },
  { id: '@deepseek-ai/dsh-client-ui-agent-preset', reason: 'session-scoped seat mounted in the conversation hero; nowhere to render in the sidebar tree' },
]

export const SIDEBAR_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [UI_LAYOUT, ...CHAT_FLOW, ...SETTINGS_PAGES, ...SIDEBAR_ONLY]

/**
 * chat 树 block list（#64 行为 + #71 瘦身）：官方外框、官方侧栏、设置子页组。
 * 对话流卡片全保留（本树渲染它们）；composer hero 的 agent preset 与权限
 * 选择保留（新会话功能）。
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
 * chat 树会话日志导出自有行动 id（#71 验收返修）：官方导出走裸 fetch +
 * a[download]，在 VS Code webview 双杀（非 http 源 fetch 失败 + 禁下载）——
 * 自有贡献点击 postMessage，宿主 showSaveDialog + 经 mirror 拉 ZIP 写盘。
 */
export const SESSION_EXPORT_PLUGIN_ID = '@dsh-one/vscode-session-export'

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
 * 改指 mirror 的 /plugins-local（mirror 伺服剥掉 blocked 段的官方原 combo，
 * rev 沿用原值)；追加自有 shell entry 与共用插件（默认追加主题跟随插件，
 * 三棵树都装），并入 application 批；bootstrap 批原样不动。
 */
export function filterWire(
  wire: BootWire,
  blockList: ReadonlyArray<BlockedPlugin> = CHAT_BLOCK_LIST,
  shellPluginId: string = SHELL_PLUGIN_ID,
  extraPluginIds: readonly string[] = [THEME_FOLLOW_PLUGIN_ID],
): BootWire {
  const blockedIds = blockedIdsOf(blockList)
  const blocked = new Set(blockedIds)
  const entries = wire.entries.filter((e) => !blocked.has(e.id))
  const dropped = wire.entries.filter((e) => blocked.has(e.id))
  if (dropped.length !== blockedIds.length) {
    const missing = blockedIds.filter((id) => !dropped.some((e) => e.id === id))
    throw new Error(`assembly wire: gateway wire is missing expected blocklist entries: ${missing.join(', ')}`)
  }
  const app = wire.batches.find((b) => b.phase === 'application')
  const bootstrap = wire.batches.find((b) => b.phase === 'bootstrap')
  if (app === undefined || bootstrap === undefined) {
    throw new Error('assembly wire: missing bootstrap/application batch')
  }
  const keptIds = app.entries.filter((id) => !blocked.has(id))
  if (keptIds.length !== app.entries.length - blockedIds.length) {
    throw new Error('assembly wire: application batch blocklist entries inconsistent with wire entries')
  }
  const localIds = [shellPluginId, ...extraPluginIds]
  for (const id of localIds) {
    entries.push({ id, url: `/plugins-local/??${id}/client.js&rev=${app.rev}`, rev: app.rev })
  }
  const comboIds = [...keptIds, ...localIds]
  return {
    rev: wire.rev,
    entries,
    batches: [
      bootstrap,
      {
        phase: 'application',
        // mirror 的 /plugins-local：combo 含 kept + 本地插件；mirror 拉官方原
        // combo 剥 blocked 段、拼上本地 bundle 后伺服；rev 沿用网关原值（缓存键)。
        url: `/plugins-local/??${comboIds.map((id) => `${id}/client.js`).join(',')}&rev=${app.rev}`,
        rev: app.rev,
        entries: comboIds,
      },
    ],
  }
}
