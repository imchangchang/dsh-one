import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerManager } from '../server/manager.ts'
import { sanitize, type Logger } from '../log.ts'
import { startAssemblyMirror, type AssemblyMirror } from '../server/assemblyMirror.ts'
import { cookieHeader, dshVersion } from '../server/serverAuth.ts'
import { parse as parseSemver, compare as compareSemver } from '../pure/semver.ts'
import { assemblyPageHtml } from './assembly/pageHtml.ts'
import { defaultHostBridgeDeps, subscribeHostCalls, type HostBridgeDeps } from './assembly/hostBridge.ts'
import { createGatewayWorkspaceRoots } from './assembly/hostWorkspaceRoots.ts'
import { drainAfterCreate, routeSelection } from '../pure/sessionPanelRouting.ts'
import { assignSessionTab, hasSessionTab, releaseSessionTab, sessionTabOf } from '../pure/sessionTabs.ts'
import { listSessions } from '../server/dshRpc.ts'
import { workspaceRootsOfSessionRows } from '../pure/workspaceRoots.ts'
import {
  extractBootWire,
  extractFrontendAssets,
  filterWire,
  type BootWire,
  type GatewayAssets,
} from './assembly/wireFilter.ts'
import { ASSEMBLY_TREES, CHAT_TREE, SETTINGS_TREE, SIDEBAR_TREE, type AssemblyTree } from './assembly/trees.ts'
import { decideSidebarStatus, assemblyFailureView, type SidebarStatusDecision } from '../pure/sidebarStatus.ts'
import { sidebarStatusHtml } from './sidebarStatusPage.ts'
import { openInstallGuide } from './installGuide.ts'

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

/** 版本门区间（低于下限缺 browser-session 认证/装载协议，高于上限行为无保证）。 */
const PREREQ_MIN = '0.1.2-rc.1'
const PREREQ_MAX = '0.2.0'

/** 用 serverAuth 的 cookie GET 网关 /，提取 wire 并按该树 block list 过滤。 */
async function loadGatewayAssembly(gateway: string, tree: AssemblyTree, logger: Logger): Promise<GatewayAssembly> {
  const cookie = cookieHeader(gateway)
  const res = await fetch(`${gateway}/`, {
    headers: cookie !== undefined ? { cookie } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
  const html = await res.text()
  return {
    // block list 里缺失的官方插件条目只报告不阻断（官方合并/下线插件是正常演进）
    wire: filterWire(extractBootWire(html), tree.blockList, tree.shellPluginId, tree.extraPluginIds, (line) =>
      logger.warn(line),
    ),
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
 * 宿主能力桥的依赖（三棵树共用）：VS Code 工作区目录 + ~/.dsh + **网关上各会话的
 * 工作目录集合**。后者是因为 git.show 的 cwd 按「当前会话所属工作区」传（页面侧从
 * 官方 sessions 服务取，见 gitCardPlugin），那个目录未必是 VS Code 打开的目录，
 * 但它一定出现在网关的会话清单里——用这份服务端数据当允许根，页面伪造不了。
 *
 * 为什么不是 workspace.list：现代 dsh（0.1.2）没有这个端点（实测 POST
 * /api/workspace/list 返回 not found，与编造方法名同响应；官方客户端走
 * `workspace/follow` 流式方法，宿主一次性调用取不到）。详见
 * src/pure/workspaceRoots.ts 的头注。
 * 会话清单取一次缓存 5 分钟（hostWorkspaceRoots），每个 manager 一个实例。
 */
const gatewayRootsByManager = new WeakMap<ServerManager, () => Promise<readonly string[]>>()

function hostBridgeDeps(
  manager: ServerManager,
  logger: Logger,
  gatewayOrigin?: () => string | undefined,
  /**
   * 侧栏面板专属的两条能力（#99 顶栏齿轮 / ＋ 菜单「创建新工作区目录」）。其余
   * 面板不给 = 那两枚入口在它们的页面里不出现（能力口按 `viaBridge` 如实上报，
   * 但页面侧另有 `settingsPage` / `workspaceCreate` 判定，见 hostCapabilities）。
   */
  panelActions?: { openSettings?: () => void; createWorkspaceDirectory?: () => Promise<unknown> },
): HostBridgeDeps {
  let roots = gatewayRootsByManager.get(manager)
  if (roots === undefined) {
    roots = createGatewayWorkspaceRoots({
      fetchPaths: async () => {
        const status = manager.getStatus()
        if (status.state !== 'running' || !status.url) return []
        return workspaceRootsOfSessionRows(await listSessions(status.url))
      },
    })
    gatewayRootsByManager.set(manager, roots)
  }
  return {
    ...defaultHostBridgeDeps(),
    extraAllowedRoots: roots,
    // `file.download` 的取数源 = 该面板所用 mirror 的 loopback 源（鉴权 cookie 由
    // 代理侧附加；页面拿不到也不该拿到 cookie）。mirror 随面板释放，故传 getter。
    ...(gatewayOrigin === undefined ? {} : { gatewayOrigin }),
    // 「在新标签页打开」（#72 多开通道）：页面侧只发会话 id，开面板的动作全在这里
    // （面板与共享 mirror 的生命周期都归本模块）。
    openSessionInNewTab: (sessionId) => void openSessionInNewTab(sessionId),
    // git 查询的扫描/命中/超时留痕走输出面板「DSH One」频道（probe 同一条通道），
    // 页面侧不感知、UI 不阻塞。
    log: (line: string) => logger.info(line),
    // #99 侧栏顶栏：设置齿轮与 ＋ 菜单的「创建新工作区目录」。两项都是**该面板
    // 专属**的能力，由调用方注入；缺省不给 = 那两个入口在别的页面里不出现。
    ...(panelActions?.openSettings === undefined ? {} : { openSettings: panelActions.openSettings }),
    ...(panelActions?.createWorkspaceDirectory === undefined
      ? {}
      : { createWorkspaceDirectory: panelActions.createWorkspaceDirectory }),
  }
}

/**
 * #71 chat 面板的两种形态（#72 起）：
 * - **单例（默认）**：与官方一致单 tab、点侧栏就地切换。任何单例创建都顶替旧单例
 *   （`chatSingleton`/`active`），侧栏点会话只聚焦 + 转发就地切换消息。
 * - **多开（显式）**：会话行菜单「在新标签页打开」为那个会话单开一个面板，
 *   登记在 `sessionTabPanels`（会话 id → 面板，规则见 pure/sessionTabs.ts）。
 *   多开面板与单例互不影响：开多开不顶替单例，关多开不改单例行为，也不影响
 *   「默认开一次（#68）」对用户关闭的判断（`closedByUser` 只认单例面板）。
 */
const sessionTabPanels = new Map<string, vscode.WebviewPanel>()
/** 在途的多开创建（会话 id → 创建中任务）：连点两次不开两个面板。 */
const creatingSessionTabs = new Map<string, Promise<void>>()
const panelSessionId = new WeakMap<vscode.WebviewPanel, string>()
let chatSingleton: { panel: vscode.WebviewPanel } | undefined
let chatDeps: { context: vscode.ExtensionContext; manager: ServerManager; logger: Logger } | undefined

/**
 * 在途的面板创建（#65 返修 7）：默认开一次（#68）与用户点击可能同时要建面板，
 * 两个创建互相顶替是「启动后第一次点击不生效」的宿主根因。这里把创建串行化：
 * 后来的请求**等前一个建完**，再按路由判定落到既有面板上（切换/去重），不再重复建。
 */
let creatingPanel: Promise<void> | undefined
/** 创建期间（或服务未就绪时）累积的待开会话；后来者覆盖先来者。 */
let pendingSessionOpen: string | undefined

/** 面板当前会话 id（无面板 = undefined）。 */
function panelSession(): string | undefined {
  const panel = chatSingleton?.panel ?? active?.panel
  return panel === undefined ? undefined : panelSessionId.get(panel)
}

/** 把待开会话兑现到既有面板：同 id 只 reveal（宿主去重），不同才就地切换。 */
function drainPendingSession(logger: Logger): void {
  const requested = pendingSessionOpen
  if (requested === undefined) return
  const panel = chatSingleton?.panel ?? active?.panel
  if (panel === undefined) return
  pendingSessionOpen = undefined
  if (routeSelection({ hasPanel: true, panelSessionId: panelSessionId.get(panel) }, requested) === 'reveal') {
    panel.reveal()
    return
  }
  panel.reveal()
  logger.info(`assembled chat: switching to ${requested.slice(0, 13)} (pending request)`)
  void panel.webview.postMessage({ type: 'dshOne.switchSession', sessionId: requested })
}

/** 会话 tab 的装配（命令路径的复用体）：opts.sessionId 有值 = 会话 tab（注入启动）。 */
async function openChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { sessionId?: string } = {},
): Promise<void> {
  // 已有在途创建：等它建完，再按路由把这次请求落到那个面板上（不重复建）
  if (creatingPanel !== undefined) {
    await creatingPanel
    if (options.sessionId !== undefined) {
      pendingSessionOpen = options.sessionId
      drainPendingSession(logger)
    }
    return
  }
  creatingPanel = createChatPanel(context, manager, logger, options)
  try {
    await creatingPanel
  } finally {
    creatingPanel = undefined
    // 创建期间来的请求（例如用户在建默认面板时点了会话）：建完立即兑现
    drainPendingSession(logger)
  }
}

/** 面板的共用前置：服务就绪 + chat 树清单 + 共享 mirror（失败已弹窗，返回 undefined）。 */
interface ChatPanelSetup {
  mirror: AssemblyMirror
  assembly: GatewayAssembly
  /** 版本门信息条文本（undefined = 网关在区间内，不显示）。 */
  banner: string | undefined
}

async function prepareChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<ChatPanelSetup | undefined> {
  const status = await manager.ensureStarted()
  if (status.state !== 'running' || !status.url) {
    void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
    return undefined
  }
  let assembly: GatewayAssembly
  try {
    assembly = await loadGatewayAssembly(status.url, CHAT_TREE, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to load the assembly wire from the dsh gateway: {0}', err instanceof Error ? err.message : String(err)),
    )
    return undefined
  }
  let mirror: AssemblyMirror
  try {
    mirror = await acquireSharedMirror(context, manager, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to start the assembly mirror: {0}', err instanceof Error ? err.message : String(err)),
    )
    return undefined
  }
  return { mirror, assembly, banner: versionBanner(dshVersion(status.url) ?? status.version) }
}

/**
 * 面板的共用接线与首帧：探针、活跃上报（标题跟随）、宿主能力桥、主题广播登记，
 * 以及 dispose 时按形态回收（多开面板释放自己那一格映射；单例面板才记
 * 「用户关过」）。两种形态只差这些登记动作，页面本身是同一份装配页。
 */
function mountChatPanel(params: {
  context: vscode.ExtensionContext
  manager: ServerManager
  logger: Logger
  panel: vscode.WebviewPanel
  setup: ChatPanelSetup
  /** 启动注入的目标会话：写进页面 `__DSH_ONE_BOOT__.sessionId`（冷启动即该会话）。 */
  sessionId: string | undefined
  /** true = 多开标签页（登记进多开表、不碰单例）；false = 单例面板。 */
  tab: boolean
}): void {
  const { context, manager, logger, panel, setup, sessionId, tab } = params
  const { mirror, assembly, banner } = setup
  if (sessionId !== undefined) panelSessionId.set(panel, sessionId)
  if (tab && sessionId !== undefined) assignSessionTab(sessionTabPanels, panel, sessionId)
  const probeSub = subscribeAssemblyProbe(panel.webview, logger)
  // 活跃/标题上报（session-boot 插件）：维护映射 + 面板标题跟随会话标题。
  const metaSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { type?: unknown; sessionId?: unknown; title?: unknown }
    if (m.type !== 'dshOne.sessionMeta' || typeof m.sessionId !== 'string') return
    panelSessionId.set(panel, m.sessionId)
    // 页面内切会话（多开面板）：把**这个面板**的格子挪到新会话，别的面板的格子不碰
    //（旧实现按会话 id 直接删，两面板映射交叉时会删错，见 pure/sessionTabs.ts）。
    if (tab) assignSessionTab(sessionTabPanels, panel, m.sessionId)
    if (typeof m.title === 'string' && m.title !== '') panel.title = `dsh: ${m.title}`
  })
  // 宿主能力桥（#65 批 1）：页面插件（git 卡片/右键菜单/多开入口等）经它取 git 数据、
  // 开多开标签页与 VS Code 动作；白名单 + 参数校核在 hostBridge 内收口。
  const hostSub = subscribeHostCalls(panel.webview, logger, hostBridgeDeps(manager, logger, () => mirror.origin))
  trackAssemblyWebview(context, panel.webview)
  panel.onDidDispose(() => {
    probeSub.dispose()
    metaSub.dispose()
    hostSub.dispose()
    untrackAssemblyWebview(panel.webview)
    if (tab) releaseSessionTab(sessionTabPanels, panel)
    panelSessionId.delete(panel)
    if (active?.panel === panel) active = undefined
    if (chatSingleton?.panel === panel) chatSingleton = undefined
    // 「用户关过」只记单例：关掉一个多开面板不该改变默认打开（#68）的行为。
    if (!tab && !replacing) closedByUser = true
    releaseSharedMirror(mirror)
  })
  panel.webview.html = assemblyPageHtml({
    mirrorOrigin: mirror.origin,
    cspNonce: crypto.randomBytes(16).toString('base64'),
    assets: assembly.assets,
    bootWire: assembly.wire,
    bootstrapUrl: assembly.wire.batches[0].url,
    theme: currentTheme(),
    banner,
    bootSessionId: sessionId,
  })
}

/** 真正的建面板流程（由 openChatPanel 串行化调用）：单例语义，任何创建都顶替旧单例。 */
async function createChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { sessionId?: string },
): Promise<void> {
  const setup = await prepareChatPanel(context, manager, logger)
  if (setup === undefined) return
  const sessionId = options.sessionId
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
  active = { panel, mirror: setup.mirror }
  chatSingleton = { panel }
  if (sessionId !== undefined && pendingSessionOpen === sessionId) pendingSessionOpen = undefined
  logger.info(`assembled chat: ${setup.mirror.origin}${sessionId === undefined ? '' : ` session=${sessionId.slice(0, 13)}`}`)
  mountChatPanel({ context, manager, logger, panel, setup, sessionId, tab: false })
}

/**
 * 多开一个会话标签页（#72）——会话行菜单「在新标签页打开」的宿主落点。语义：
 * **已开则聚焦**（宿主去重；在途创建算已开，连点不会开两个）、未开则新建。
 * 全程不碰单例（`chatSingleton`/`active`）：多开与单 tab 各走各的，互不干扰。
 */
export async function openSessionInNewTab(sessionId: string): Promise<void> {
  // 已开（或在途创建，见 pure/sessionTabs.ts 的「已有」判定）：等创建落地再聚焦，
  // 绝不新建第二个面板。
  if (hasSessionTab(sessionTabPanels, creatingSessionTabs, sessionId)) {
    await creatingSessionTabs.get(sessionId)
    sessionTabOf(sessionTabPanels, sessionId)?.reveal()
    return
  }
  const deps = chatDeps
  if (deps === undefined) return // 注册还没发生（页面入口也来自注册后的树）
  const created = (async () => {
    const setup = await prepareChatPanel(deps.context, deps.manager, deps.logger)
    if (setup === undefined) return
    const panel = vscode.window.createWebviewPanel(
      ASSEMBLED_CHAT_VIEW_TYPE,
      `dsh: ${sessionId.slice(0, 13)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    deps.logger.info(`assembled chat tab: ${setup.mirror.origin} session=${sessionId.slice(0, 13)}`)
    mountChatPanel({
      context: deps.context,
      manager: deps.manager,
      logger: deps.logger,
      panel,
      setup,
      sessionId,
      tab: true,
    })
  })()
  creatingSessionTabs.set(sessionId, created)
  try {
    await created
  } finally {
    creatingSessionTabs.delete(sessionId)
  }
}

/**
 * 侧栏桥消息落点（单例路由）：有单例 → 揭示 + 转发就地切换消息（不 reload、
 * 不遮罩——运行时切换走官方 sessions.open，加载态官方自带）；无单例 → 创建
 * （冷启动注入 bootSessionId，防闪帧遮罩此刻生效一次）。
 */
async function openSessionChat(sessionId: string): Promise<void> {
  const panel = chatSingleton?.panel ?? active?.panel
  if (panel !== undefined) {
    // 有面板：同 id 只聚焦（宿主去重），不同才就地切换
    if (routeSelection({ hasPanel: true, panelSessionId: panelSessionId.get(panel) }, sessionId) === 'reveal') {
      panel.reveal()
      return
    }
    panel.reveal()
    void panel.webview.postMessage({ type: 'dshOne.switchSession', sessionId })
    return
  }
  // 没面板：记下请求，冷启动以该会话创建（创建在途时等它建完再兑现，不重复建面板）
  pendingSessionOpen = sessionId
  if (creatingPanel !== undefined) {
    const deps = chatDeps
    await creatingPanel
    if (deps !== undefined) drainPendingSession(deps.logger)
    return
  }
  const deps = chatDeps
  if (deps === undefined) return // 注册还没发生：留在 pending，注册后由 attemptPendingSession 兜
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
      treeCombos: ASSEMBLY_TREES.map((tree) => ({ shellPluginId: tree.shellPluginId, blockList: tree.blockList })),
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
    for (const tree of ASSEMBLY_TREES) {
      await fetch(`${mirror.origin}/plugins-local/??@deepseek-ai/dsh-client-ui-theme/client.js,${tree.shellPluginId}/client.js&rev=preheat`)
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
  // 注册之前到达的点击（理论上不该有，防御）：注册后立刻兑现
  if (pendingSessionOpen !== undefined) void openSessionChat(pendingSessionOpen)
  return vscode.commands.registerCommand('dshOne.assembledChat', () => openChatPanel(context, manager, logger))
}

/**
 * 侧栏状态页（#100）：三态各有自己的文案与按钮——
 * - 未安装：「查看安装指南」→ 开独立的安装引导 tab（窄侧栏放不下引导内容）；
 * - 服务未运行 / 启动中：「启动 dsh 服务」（启动中只显示进度文案）；
 * - 装配失败：说明原因 + 「重试装配」。
 *
 * 判定结果若是 `assemble`（服务在跑、交给装配页）就不动页面。
 * 页面的 HTML 由 `sidebarStatusPage.ts` 出（宿主侧普通 HTML，不参与装配树）。
 */
function renderSidebarStatus(webview: vscode.Webview, decision: SidebarStatusDecision): void {
  if (decision.kind === 'assemble') return
  webview.html = sidebarStatusHtml(decision)
}

/**
 * 侧栏位装配 provider（#70）：dshOne.chat view 的内容从自研 vanilla 换成
 * 官方侧栏装配（第二棵 cordis 树）。生命周期：首次 resolve 装配一次，mirror
 * 随 view dispose 回收（retainContextWhenHidden 下折叠不触发 dispose）；
 * 装不起来（未安装 / 服务没起 / 装配失败）落状态页，各自的按钮重新走一遍。
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
    /**
     * 开/聚焦设置页（#99 起由顶栏齿轮经宿主能力口 `openSettings` 触发；齿轮以前
     * 在底部那一行、走 `dshOne.openSettings` 消息，那条路已随 #99 撤掉）。
     */
    private readonly onOpenSettings?: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true }
    const probeSub = subscribeAssemblyProbe(view.webview, this.logger)
    const hostSub = subscribeHostCalls(
      view.webview,
      this.logger,
      hostBridgeDeps(this.manager, this.logger, () => this.mirror?.origin, {
        // #99：顶栏齿轮走能力口（不再要求页面自己 postMessage）；两条都复用既有动作
        // ——设置页的注册/聚焦在马甲这一层（onOpenSettings），建目录复用
        // `dshOne.workspace.create` 命令（宿主原生输入框 + 建目录 + 注册 + 刷新）。
        openSettings: () => this.onOpenSettings?.(),
        createWorkspaceDirectory: async () => {
          await vscode.commands.executeCommand('dshOne.workspace.create')
        },
      }),
    )
    trackAssemblyWebview(this.context, view.webview)
    const retrySub = view.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return
      const type = (msg as { type?: unknown }).type
      if (type === 'assembly:retry') void this.assemble(view)
      else if (type === 'assembly:start') this.startFromStatusPage(view)
      else if (type === 'assembly:openInstallGuide') openInstallGuide(this.logger)
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

  /**
   * 状态页「启动 dsh 服务」：先落「正在启动」页再走装配。ensureStarted 的第一件
   * 事就是把 state 置成 starting（同步执行），所以这里能立刻读到；不这么做的话，
   * 页面会停在「启动」按钮上直到服务真的起来，看起来像点击没生效。
   */
  private startFromStatusPage(view: vscode.WebviewView): void {
    const started = this.manager.ensureStarted()
    renderSidebarStatus(view.webview, decideSidebarStatus(this.manager.getStatus()))
    void started.then(() => this.assemble(view))
  }

  /** 装配一次：ensureStarted → 清单 → mirror → 装配页；装不起来落状态页。 */
  private assemble(view: vscode.WebviewView): void {
    this.running ??= (async () => {
      // 首帧先落状态页（服务在跑时马上被装配页替换）：侧栏揭面到装配完成之间是
      // 网关往返，这段时间不该是白屏。已在装的服务不用重画（等结果就行）。
      const initial = decideSidebarStatus(this.manager.getStatus())
      if (initial.kind !== 'assemble') renderSidebarStatus(view.webview, initial)
      const status = await this.manager.ensureStarted()
      const decision = decideSidebarStatus(status)
      if (decision.kind !== 'assemble') {
        renderSidebarStatus(view.webview, decision)
        return
      }
      try {
        const assembly = await loadGatewayAssembly(decision.url, SIDEBAR_TREE, this.logger)
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
          banner: versionBanner(dshVersion(decision.url) ?? status.version),
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.logger.warn(`assembled sidebar failed: ${reason}`)
        this.mirror?.dispose()
        this.mirror = undefined
        renderSidebarStatus(view.webview, assemblyFailureView(status, reason))
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
      assembly = await loadGatewayAssembly(status.url, SETTINGS_TREE, logger)
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
    const hostSub = subscribeHostCalls(panel.webview, logger, hostBridgeDeps(manager, logger, () => mirror.origin))
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
