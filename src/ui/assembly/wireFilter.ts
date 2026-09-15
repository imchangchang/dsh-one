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
export const CHAT_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [
  UI_LAYOUT,
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    // chat 树无侧栏：官方侧栏壳在对话区里无处渲染（#70 起侧栏位装配用
    // sidebar 树，官方侧栏在那里上线）
    reason: 'official sidebar shell has no seat in the chat tree; the sidebar seat is served by the sidebar tree assembly (#70)',
  },
]

/**
 * sidebar 树 block list（#70）：侧栏位装配只下官方外框。官方侧栏插件
 * （品牌位/工作区树/设置入口/底部动作条）与设置四件套原样保留——设置
 * 面板即官方 SettingsRoot modal（spike #69 题3 结论：零替换）。
 */
export const SIDEBAR_BLOCK_LIST: ReadonlyArray<BlockedPlugin> = [UI_LAYOUT]

/** block list → id 列表。 */
export const blockedIdsOf = (list: ReadonlyArray<BlockedPlugin>): string[] => list.map((b) => b.id)

/** chat 树 blocked id（assemblyMirror 默认过滤集；#64 口径不变）。 */
export const CHAT_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(CHAT_BLOCK_LIST)

/** sidebar 树 blocked id。 */
export const SIDEBAR_BLOCKED_IDS: Readonly<string[]> = blockedIdsOf(SIDEBAR_BLOCK_LIST)

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
