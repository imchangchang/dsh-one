import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerManager } from '../server/manager.ts'
import { sanitize, type Logger } from '../log.ts'
import { startAssemblyMirror, type AssemblyMirror } from '../server/assemblyMirror.ts'
import { cookieHeader, dshVersion } from '../server/serverAuth.ts'
import { parse as parseSemver, compare as compareSemver } from '../pure/semver.ts'
import { assemblyPageHtml } from './assembly/pageHtml.ts'
import { subscribeHostCalls } from './assembly/hostBridge.ts'
import {
  CHAT_BLOCK_LIST,
  SETTINGS_BLOCK_LIST,
  SIDEBAR_BLOCK_LIST,
  SETTINGS_GEAR_PLUGIN_ID,
  SETTINGS_SHELL_PLUGIN_ID,
  SHELL_PLUGIN_ID,
  SIDEBAR_SHELL_PLUGIN_ID,
  SESSION_BOOT_PLUGIN_ID,
  SESSION_BRIDGE_PLUGIN_ID,
  SESSION_EXPORT_PLUGIN_ID,
  THEME_FOLLOW_PLUGIN_ID,
  extractBootWire,
  extractFrontendAssets,
  filterWire,
  type BlockedPlugin,
  type BootWire,
  type GatewayAssets,
} from './assembly/wireFilter.ts'

/**
 * cordis 装配视图（#64 对话区面板，#70 起泛化为两棵树）：
 * - chat 树：命令 dshOne.assembledChat → ensureStarted 后起 assemblyMirror
 *   （loopback 反代），WebviewPanel 装装配页。生命周期照官方嵌入面板模式
 *   （#60）：单例、后开替换先开、关面板即 dispose mirror。
 * - sidebar 树：dshOne.chat 侧栏 view 的 WebviewViewProvider——同一套
 *   loopback 代理/清单管线/CSP/探针，block list 与自有 frame 插件按树切换
 *   （wireFilter.ts 两棵树两份清单），官方侧栏原样进侧栏位（#70）。
 *
 * blocklist 模式：视图打开时（扩展宿主侧，node 无 CORS）用 cookie GET 网关
 * `/` 的注入 HTML，提取官方 __DSH_BOOT__ wire + 前端资产名，按该树 block list
 * 过滤（application 批重指 mirror /plugins-local，mirror 拉官方原 combo 剥
 * blocked 段后伺服），追加该树自有 frame 插件，内联进装配页。
 *
 * 版本门：网关 dsh 版本不在 [0.1.2-rc.1, 0.2.0) 时页面顶部加信息条，不阻断。
 */

export const ASSEMBLED_CHAT_VIEW_TYPE = 'dshOne.assembledChat'

/** 侧栏 view 的 contribute id（package.json views，#70 起内容 = 官方侧栏装配）。 */
export const ASSEMBLED_SIDEBAR_VIEW_ID = 'dshOne.chat'

/** 当前打开的面板（单例：后开替换先开，与官方嵌入面板一致）。 */
let active: { panel: vscode.WebviewPanel; mirror: AssemblyMirror } | undefined

/** 面板是否被用户手动关过：「后开替换先开」的内部 dispose 不算（见 replacing）。 */
let closedByUser = false

/** 「后开替换先开」dispose 旧面板期间置 true，屏蔽其 dispose 产生的用户关闭信号。 */
let replacing = false

/** 已开则聚焦并返回 true：侧栏点开会话/新建/fork/默认打开复用，避免整页重复装配。 */
export function revealAssembledChat(): boolean {
  if (!active) return false
  active.panel.reveal()
  return true
}

/** 装配面板当前是否打开（默认打开成功后落 workspaceState 标记前判定用）。 */
export function hasAssembledChatPanel(): boolean {
  return active !== undefined
}

/** 用户是否手动关过装配面板：默认打开尊重这个选择，关过不再强开。 */
export function wasAssembledChatClosedByUser(): boolean {
  return closedByUser
}

/** 装配页数据源：网关 / 注入 HTML 的运行时提取 + blocklist 过滤结果。 */
interface GatewayAssembly {
  wire: BootWire
  assets: GatewayAssets
}

/** 一棵树 = 一份 block list + 一个自有 frame 插件 id + 追加的共用插件（见 wireFilter.ts）。 */
interface AssemblyTree {
  blockList: ReadonlyArray<BlockedPlugin>
  shellPluginId: string
  extraPluginIds: readonly string[]
}

/**
 * 三棵树（#64 chat / #70 sidebar + settings）：
 * - chat 树：装配对话区
 * - sidebar 树：侧栏位（追加设置齿轮影子）
 * - settings 树：设置独立成页（block list = 外框 + 对话流卡片组）
 */
const CHAT_TREE: AssemblyTree = {
  blockList: CHAT_BLOCK_LIST,
  shellPluginId: SHELL_PLUGIN_ID,
  extraPluginIds: [THEME_FOLLOW_PLUGIN_ID, SESSION_BOOT_PLUGIN_ID, SESSION_EXPORT_PLUGIN_ID],
}
const SIDEBAR_TREE: AssemblyTree = {
  blockList: SIDEBAR_BLOCK_LIST,
  shellPluginId: SIDEBAR_SHELL_PLUGIN_ID,
  extraPluginIds: [THEME_FOLLOW_PLUGIN_ID, SETTINGS_GEAR_PLUGIN_ID, SESSION_BRIDGE_PLUGIN_ID],
}
const SETTINGS_TREE: AssemblyTree = {
  blockList: SETTINGS_BLOCK_LIST,
  shellPluginId: SETTINGS_SHELL_PLUGIN_ID,
  extraPluginIds: [THEME_FOLLOW_PLUGIN_ID],
}

/** 版本门区间（低于下限缺 browser-session 认证/装载协议，高于上限行为无保证）。 */
const PREREQ_MIN = '0.1.2-rc.1'
const PREREQ_MAX = '0.2.0'

/** 用 serverAuth 的 cookie GET 网关 /，提取 wire 并按该树 block list 过滤。 */
async function loadGatewayAssembly(gateway: string, tree: AssemblyTree): Promise<GatewayAssembly> {
  const cookie = cookieHeader(gateway)
  const res = await fetch(`${gateway}/`, {
    headers: cookie !== undefined ? { cookie } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
  const html = await res.text()
  return {
    wire: filterWire(extractBootWire(html), tree.blockList, tree.shellPluginId, tree.extraPluginIds),
    assets: extractFrontendAssets(html),
  }
}

/** 版本门：区间内/无法取得版本来源时返回信息条文本（undefined = 放行不显示）。 */
function versionBanner(version: string | undefined): string | undefined {
  const inRange = (v: string): boolean => {
    const parsed = parseSemver(v)
    return parsed !== null && compareSemver(v, PREREQ_MIN) >= 0 && compareSemver(v, PREREQ_MAX) < 0
  }
  if (version !== undefined && inRange(version)) return undefined
  const range = `${PREREQ_MIN} ≤ version < ${PREREQ_MAX}`
  return version === undefined
    ? vscode.l10n.t('The dsh version is unknown; this chat assembly expects {0}.', range)
    : vscode.l10n.t('The connected dsh is {0}, which may not match this chat assembly (expects {1}).', version, range)
}

/** 跟随 VS Code 当前主题（装配页起来后由官方 ThemePresenter 接管）。 */
function currentTheme(): 'dark' | 'light' {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark'
}

/**
 * 主题跟随广播（#70 VS Code 验收项 1）：所有装配 webview（chat 面板/侧栏
 * view/设置面板）登记在册，VS Code 颜色主题变化时广播 {type:'dshOne.setTheme'}
 * ——树内 @dsh-one/vscode-theme-follow 插件走官方 theme 服务的注册+setTheme
 * 口覆写（不写网关 settings，双前端边界不破，见 themeFollowPlugin.ts）。
 * 首帧主题由装配页 theme 参数烘焙（pageHtml.ts），广播只管后续切换。
 */
const assemblyWebviews = new Set<vscode.Webview>()
let themeBroadcastSub: vscode.Disposable | undefined

/** 登记一个装配 webview 进主题广播（面板/view 的 onDidDispose 里对应 delete）。 */
function trackAssemblyWebview(context: vscode.ExtensionContext, webview: vscode.Webview): void {
  assemblyWebviews.add(webview)
  themeBroadcastSub ??= vscode.window.onDidChangeActiveColorTheme(() => {
    const theme = currentTheme()
    for (const target of assemblyWebviews) void target.postMessage({ type: 'dshOne.setTheme', theme })
  })
  // 同一订阅重复 push 无害（dispose 幂等）。
  context.subscriptions.push(themeBroadcastSub)
}

/** 停收一个装配 webview 的主题广播。 */
function untrackAssemblyWebview(webview: vscode.Webview): void {
  assemblyWebviews.delete(webview)
}

/**
 * 装配页诊断探针（仅 webview 激活，见 assembly/probe.ts）回传日志：[assembly]
 * 前缀写入输出面板「DSH One」频道；只认 assembly:log，其余消息类型忽略。文本
 * 过 sanitize 脱敏（URL 掩码）。返回 Disposable，视图处置时停收。
 */
function subscribeAssemblyProbe(webview: vscode.Webview, logger: Logger): vscode.Disposable {
  return webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { type?: unknown; level?: unknown; text?: unknown }
    if (m.type !== 'assembly:log') return
    const line = `[assembly] ${sanitize(typeof m.text === 'string' ? m.text : String(m.text ?? ''))}`
    if (m.level === 'error') logger.error(line)
    else if (m.level === 'warn') logger.warn(line)
    else logger.info(line)
  })
}

/**
 * #71 chat 面板 = 单例（用户拍板：与官方一致单 tab、点侧栏就地切换；
 * tab-per-session 多开降级 #72）。sessionTabs/panelSessionId 映射保留为
 * #72 复活形态（标题跟随仍在用 panelSessionId），路由不再按 sessionId
 * 开新 tab：有单例则聚焦 + 转发就地切换消息，无则创建（冷启动注入）。
 */
const sessionTabs = new Map<string, vscode.WebviewPanel>()
const panelSessionId = new WeakMap<vscode.WebviewPanel, string>()
let chatSingleton: { panel: vscode.WebviewPanel } | undefined
let chatDeps: { context: vscode.ExtensionContext; manager: ServerManager; logger: Logger } | undefined

/** 会话 tab 的装配（命令路径的复用体）：opts.sessionId 有值 = 会话 tab（注入启动）。 */
async function openChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { sessionId?: string } = {},
): Promise<void> {
  const status = await manager.ensureStarted()
  if (status.state !== 'running' || !status.url) {
    void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
    return
  }
  const sessionId = options.sessionId
  let assembly: GatewayAssembly
  try {
    assembly = await loadGatewayAssembly(status.url, CHAT_TREE)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to load the assembly wire from the dsh gateway: {0}', err instanceof Error ? err.message : String(err)),
    )
    return
  }
  let mirror: AssemblyMirror
  try {
    mirror = await acquireSharedMirror(context, manager, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to start the assembly mirror: {0}', err instanceof Error ? err.message : String(err)),
    )
    return
  }
  // 单例语义（#71 终态）：任何创建都顶替旧单例（replace 期间的 dispose
  // 是我们自己触发的，不算用户手动关闭）。
  replacing = true
  try {
    active?.panel.dispose()
  } finally {
    replacing = false
  }
  const panel = vscode.window.createWebviewPanel(
    ASSEMBLED_CHAT_VIEW_TYPE,
    sessionId === undefined ? vscode.l10n.t('dsh Chat (assembled)') : `dsh: ${sessionId.slice(0, 13)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  active = { panel, mirror }
  if (sessionId !== undefined) {
    sessionTabs.set(sessionId, panel)
    panelSessionId.set(panel, sessionId)
  }
  chatSingleton = { panel }
  logger.info(`assembled chat: ${mirror.origin}${sessionId === undefined ? '' : ` session=${sessionId.slice(0, 13)}`}`)
  const probeSub = subscribeAssemblyProbe(panel.webview, logger)
  // 会话日志导出（session-export 插件，#71）：官方导出走裸 fetch + a[download]
  // 在 webview 双杀（非 http 源 + 禁下载）——点击 postMessage 过来，宿主经
  // mirror 拉 ZIP（读操作）→ showSaveDialog → 写盘。
  const exportSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { type?: unknown; sessionId?: unknown }
    if (m.type !== 'dshOne.exportSessionLog' || typeof m.sessionId !== 'string' || m.sessionId === '') return
    void exportSessionLog(mirror, m.sessionId)
  })
  // 活跃/标题上报（session-boot 插件）：维护映射 + 面板标题跟随会话标题。
  const metaSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { type?: unknown; sessionId?: unknown; title?: unknown }
    if (m.type !== 'dshOne.sessionMeta' || typeof m.sessionId !== 'string') return
    const old = panelSessionId.get(panel)
    if (old !== undefined && old !== m.sessionId) sessionTabs.delete(old)
    sessionTabs.set(m.sessionId, panel)
    panelSessionId.set(panel, m.sessionId)
    if (typeof m.title === 'string' && m.title !== '') panel.title = `dsh: ${m.title}`
  })
  // 宿主能力桥（#65 批 1）：页面插件（git 卡片/右键菜单等）经它取 git 数据与
  // VS Code 动作；白名单 + 参数校核在 hostBridge 内收口。
  const hostSub = subscribeHostCalls(panel.webview, logger)
  trackAssemblyWebview(context, panel.webview)
  panel.onDidDispose(() => {
    probeSub.dispose()
    exportSub.dispose()
    metaSub.dispose()
    hostSub.dispose()
    untrackAssemblyWebview(panel.webview)
    const mapped = panelSessionId.get(panel)
    if (mapped !== undefined && sessionTabs.get(mapped) === panel) sessionTabs.delete(mapped)
    if (active?.panel === panel) active = undefined
    if (chatSingleton?.panel === panel) chatSingleton = undefined
    if (!replacing) closedByUser = true
    releaseSharedMirror(mirror)
  })
  panel.webview.html = assemblyPageHtml({
    mirrorOrigin: mirror.origin,
    cspNonce: crypto.randomBytes(16).toString('base64'),
    assets: assembly.assets,
    bootWire: assembly.wire,
    bootstrapUrl: assembly.wire.batches[0].url,
    theme: currentTheme(),
    banner: versionBanner(dshVersion(status.url) ?? status.version),
    bootSessionId: sessionId,
  })
}

/** 会话日志导出落盘：经 mirror 拉 ZIP（读）→ VS Code 保存对话框 → 写盘。 */
async function exportSessionLog(mirror: AssemblyMirror, sessionId: string): Promise<void> {
  const url = `${mirror.origin}/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`
  const head = await fetch(url, { method: 'HEAD' })
  if (!head.ok) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Session export failed: HTTP {0}', head.status))
    return
  }
  const filename = `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', filename)),
    saveLabel: vscode.l10n.t('Export session log'),
  })
  if (target === undefined) return
  try {
    const res = await fetch(url)
    if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(target.fsPath, buffer)
    void vscode.window.showInformationMessage(vscode.l10n.t('Session log exported to {0}', target.fsPath))
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Session export failed: {0}', err instanceof Error ? err.message : String(err)),
    )
  }
}

/**
 * 侧栏桥消息落点（单例路由）：有单例 → 揭示 + 转发就地切换消息（不 reload、
 * 不遮罩——运行时切换走官方 sessions.open，加载态官方自带）；无单例 → 创建
 * （冷启动注入 bootSessionId，防闪帧遮罩此刻生效一次）。
 */
async function openSessionChat(sessionId: string): Promise<void> {
  const singleton = chatSingleton ?? active
  if (singleton !== undefined) {
    singleton.panel.reveal()
    void singleton.panel.webview.postMessage({ type: 'dshOne.switchSession', sessionId })
    return
  }
  const deps = chatDeps
  if (deps === undefined) return
  await openChatPanel(deps.context, deps.manager, deps.logger, { sessionId })
}

/**
 * #71 性能——共享 loopback mirror 池：同一窗口同一网关地址一个 mirror 实例
 * （稳定端口 = webview 源稳定 → 跨 tab HTTP 缓存生效，44 插件整包不再每 tab
 * 全量重下）。引用计数：每个面板 acquire，关 dispose 随最后一个回收。
 * 多树伺服：单 mirror 按树（shellPluginId 键）各缓存一份过滤版整包。
 */
const sharedMirrors = new Map<string, { mirror: AssemblyMirror; refs: number; key: string }>()

async function acquireSharedMirror(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<AssemblyMirror> {
  const gateway = manager.getStatus().url ?? 'pending'
  const existing = sharedMirrors.get(gateway)
  if (existing !== undefined) {
    existing.refs += 1
    return existing.mirror
  }
  const mirror = await startAssemblyMirror(
    () => manager.getStatus().url,
    logger,
    {
      pluginsDir: path.join(context.extensionUri.fsPath, 'dist', 'assembly', 'plugins'),
      treeCombos: [
        { shellPluginId: SHELL_PLUGIN_ID, blockList: CHAT_TREE.blockList },
        { shellPluginId: SIDEBAR_SHELL_PLUGIN_ID, blockList: SIDEBAR_TREE.blockList },
        { shellPluginId: SETTINGS_SHELL_PLUGIN_ID, blockList: SETTINGS_TREE.blockList },
      ],
    },
  )
  sharedMirrors.set(gateway, { mirror, refs: 1, key: gateway })
  return mirror
}

/** 面板关闭即释放；最后一个引用回收 mirror（关 loopback 端口）。 */
function releaseSharedMirror(mirror: AssemblyMirror): void {
  for (const [key, entry] of sharedMirrors) {
    if (entry.mirror === mirror) {
      entry.refs -= 1
      if (entry.refs <= 0) {
        sharedMirrors.delete(key)
        mirror.dispose()
      }
      return
    }
  }
}

/**
 * #71 预热：扩展激活且网关 running 即后台暖共享代理 + 三树过滤整包缓存
 * （mirror 起 loopback + 每树 filtered combo 预取——省首个面板的网关往返
 * 与装配初始化）。静默：失败只落日志，绝不挡激活、不弹窗。webview 磁盘
 * 缓存与宿主不同分区，无法也不需从宿主预热（共享 mirror 已让整包 URL
 * 稳定，首个 webview 自己会缓存）。
 */
export async function preheatAssembly(context: vscode.ExtensionContext, manager: ServerManager, logger: Logger): Promise<void> {
  try {
    if (manager.getStatus().state !== 'running') return
    const mirror = await acquireSharedMirror(context, manager, logger)
    // 每树预取一次 combo：请求里带一个保留段官方 id（触发该树过滤整包的
    // 拉取与伺服缓存）+ 该树 shell id（缓存路由键）。rev 任意值即可（缓存键）。
    for (const shellId of [SHELL_PLUGIN_ID, SIDEBAR_SHELL_PLUGIN_ID, SETTINGS_SHELL_PLUGIN_ID]) {
      await fetch(`${mirror.origin}/plugins-local/??@deepseek-ai/dsh-client-ui-theme/client.js,${shellId}/client.js&rev=preheat`)
    }
    releaseSharedMirror(mirror)
    logger.info('assembly preheat: shared mirror + tree combos warmed')
  } catch (err) {
    logger.warn(`assembly preheat skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 注册「装配对话区」命令：默认 tab（无会话注入，官方恢复行为）。 */
export function registerAssembledChat(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): vscode.Disposable {
  chatDeps = { context, manager, logger }
  return vscode.commands.registerCommand('dshOne.assembledChat', () => openChatPanel(context, manager, logger))
}

/**
 * 侧栏位装配失败时的占位页：说明原因 + Retry 按钮（post assembly:retry 重试
 * 装配）。服务没起/清单拉取失败都落这里——侧栏 view 没有命令层的弹窗可依赖。
 */
function sidebarFallbackHtml(reason: string): string {
  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = [
    "default-src 'none'",
    "script-src 'nonce-" + nonce + "'",
    "style-src 'unsafe-inline'",
  ].join('; ')
  const button = vscode.l10n.t('Retry')
  const hint = vscode.l10n.t('DSH sidebar failed to load: {0}', reason)
  const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>DSH One sidebar</title>
    <script nonce="${nonce}">
      const vscode = globalThis.__DSH_ONE_VSCODE__ || acquireVsCodeApi()
      document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'dsh-retry') vscode.postMessage({ type: 'assembly:retry' })
      })
    </script>
  </head>
  <body style="font-family:var(--vscode-font-family,system-ui,sans-serif);padding:12px;font-size:13px;color:var(--vscode-descriptionForeground,#888)">
    <div>${escapeHtml(hint)}</div>
    <button id="dsh-retry" style="margin-top:8px;padding:4px 12px;cursor:pointer">${escapeHtml(button)}</button>
  </body>
</html>
`
}

/**
 * 侧栏位装配 provider（#70）：dshOne.chat view 的内容从自研 vanilla 换成
 * 官方侧栏装配（第二棵 cordis 树）。生命周期：首次 resolve 装配一次，mirror
 * 随 view dispose 回收（retainContextWhenHidden 下折叠不触发 dispose）；
 * 失败落占位页，Retry 重新装配。
 */
class AssembledSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private mirror: AssemblyMirror | undefined
  private running: Promise<void> | undefined

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    /** 视图可见性钩子：每次变得可见时回调（装配对话区默认打开逻辑挂这里，#68）。 */
    private readonly onDidBecomeVisible?: () => void,
    /** 齿轮点击（dshOne.openSettings）：宿主开/聚焦设置面板。 */
    private readonly onOpenSettings?: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true }
    const probeSub = subscribeAssemblyProbe(view.webview, this.logger)
    const hostSub = subscribeHostCalls(view.webview, this.logger)
    trackAssemblyWebview(this.context, view.webview)
    const retrySub = view.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return
      const type = (msg as { type?: unknown }).type
      if (type === 'assembly:retry') void this.assemble(view)
      else if (type === 'dshOne.openSettings') this.onOpenSettings?.()
      else if (type === 'dshOne.sessionSelected') {
        const sessionId = (msg as { sessionId?: unknown }).sessionId
        if (typeof sessionId === 'string' && sessionId !== '') void openSessionChat(sessionId)
      }
    })
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) this.onDidBecomeVisible?.()
    })
    view.onDidDispose(() => {
      probeSub.dispose()
      hostSub.dispose()
      retrySub.dispose()
      visibilitySub.dispose()
      untrackAssemblyWebview(view.webview)
      if (this.mirror !== undefined) releaseSharedMirror(this.mirror)
      this.mirror = undefined
    })
    void this.assemble(view)
    this.onDidBecomeVisible?.()
  }

  /** 装配一次：ensureStarted → 清单 → mirror → 装配页；失败落占位页。 */
  private assemble(view: vscode.WebviewView): void {
    this.running ??= (async () => {
      try {
        const status = await this.manager.ensureStarted()
        if (status.state !== 'running' || !status.url) throw new Error(vscode.l10n.t('DSH service is not running'))
        const assembly = await loadGatewayAssembly(status.url, SIDEBAR_TREE)
        // 重试路径：先释放旧 mirror（插件集可能已变）。
        if (this.mirror !== undefined) releaseSharedMirror(this.mirror)
        this.mirror = await acquireSharedMirror(this.context, this.manager, this.logger)
        this.logger.info(`assembled sidebar: ${this.mirror.origin}`)
        view.webview.html = assemblyPageHtml({
          mirrorOrigin: this.mirror.origin,
          cspNonce: crypto.randomBytes(16).toString('base64'),
          assets: assembly.assets,
          bootWire: assembly.wire,
          bootstrapUrl: assembly.wire.batches[0].url,
          theme: currentTheme(),
          banner: versionBanner(dshVersion(status.url) ?? status.version),
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.logger.warn(`assembled sidebar failed: ${reason}`)
        this.mirror?.dispose()
        this.mirror = undefined
        view.webview.html = sidebarFallbackHtml(reason)
      } finally {
        this.running = undefined
      }
    })()
  }

  dispose(): void {
    if (this.mirror !== undefined) releaseSharedMirror(this.mirror)
    this.mirror = undefined
  }
}

/** 注册侧栏位装配 provider（#70）：webview view dshOne.chat = 官方侧栏装配。 */
export function registerAssembledSidebar(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { onDidBecomeVisible?: () => void; onOpenSettings?: () => void } = {},
): vscode.Disposable {
  const provider = new AssembledSidebarProvider(context, manager, logger, options.onDidBecomeVisible, options.onOpenSettings)
  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(ASSEMBLED_SIDEBAR_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
  )
}

/** 当前打开的设置面板（单例：后开替换先开，与 chat 面板一致）。 */
let activeSettings: { panel: vscode.WebviewPanel; mirror: AssemblyMirror } | undefined

/** 已开则聚焦并返回 true：侧栏齿轮点击复用，避免重复装配。 */
export function revealAssembledSettings(): boolean {
  if (!activeSettings) return false
  activeSettings.panel.reveal()
  return true
}

/** 用 VS Code 编辑器打开 dsh 设置文档（~/.dsh/settings.yaml）。 */
async function openSettingsDocumentInEditor(): Promise<void> {
  const doc = vscode.Uri.file(path.join(os.homedir(), '.dsh', 'settings.yaml'))
  try {
    const textDoc = await vscode.workspace.openTextDocument(doc)
    await vscode.window.showTextDocument(textDoc, { preview: false })
  } catch {
    void vscode.window.showErrorMessage(vscode.l10n.t('The dsh settings file was not found at ~/.dsh/settings.yaml'))
  }
}

/** 注册设置面板命令（#70 设置独立成页）：dshOne.assembledSettings。 */
export function registerAssembledSettings(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): vscode.Disposable {
  return vscode.commands.registerCommand('dshOne.assembledSettings', async () => {
    const status = await manager.ensureStarted()
    if (status.state !== 'running' || !status.url) {
      void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
      return
    }
    let assembly: GatewayAssembly
    try {
      assembly = await loadGatewayAssembly(status.url, SETTINGS_TREE)
    } catch (err) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to load the assembly wire from the dsh gateway: {0}', err instanceof Error ? err.message : String(err)),
      )
      return
    }
    let mirror: AssemblyMirror
    try {
      mirror = await acquireSharedMirror(context, manager, logger)
    } catch (err) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to start the assembly mirror: {0}', err instanceof Error ? err.message : String(err)),
      )
      return
    }
    replacing = true
    try {
      activeSettings?.panel.dispose()
    } finally {
      replacing = false
    }
    const panel = vscode.window.createWebviewPanel(
      'dshOne.assembledSettings',
      vscode.l10n.t('dsh Settings (assembled)'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    activeSettings = { panel, mirror }
    logger.info(`assembled settings: ${mirror.origin}`)
    const probeSub = subscribeAssemblyProbe(panel.webview, logger)
    // 「打开配置文件」行动（自有 settings.action 贡献 postMessage）：用 VS Code
    // 编辑器打开 dsh 设置文档（官方实现是网关宿主侧打开，无客户端改道钩子；
    // 路径 = DSH home 的 settings.yaml，与 ~/.dsh 布局一致，见 ownedRecord）。
    const docSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== 'object' || msg === null || (msg as { type?: unknown }).type !== 'dshOne.openSettingsDocument') return
      void openSettingsDocumentInEditor()
    })
    const hostSub = subscribeHostCalls(panel.webview, logger)
    trackAssemblyWebview(context, panel.webview)
    panel.onDidDispose(() => {
      probeSub.dispose()
      docSub.dispose()
      hostSub.dispose()
      untrackAssemblyWebview(panel.webview)
      if (activeSettings?.panel === panel) activeSettings = undefined
      releaseSharedMirror(mirror)
    })
    panel.webview.html = assemblyPageHtml({
      mirrorOrigin: mirror.origin,
      cspNonce: crypto.randomBytes(16).toString('base64'),
      assets: assembly.assets,
      bootWire: assembly.wire,
      bootstrapUrl: assembly.wire.batches[0].url,
      theme: currentTheme(),
      banner: versionBanner(dshVersion(status.url) ?? status.version),
    })
  })
}
