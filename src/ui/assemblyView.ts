import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { sanitize, type Logger } from '../log.ts'
import { startAssemblyMirror, type AssemblyMirror } from '../server/assemblyMirror.ts'
import { localBundleRev } from '../server/localBundleRev.ts'
import { cookieHeader, dshVersion } from '../server/serverAuth.ts'
import { inPrereqRange, installCommand, prereqRangeLabel } from '../pure/versionGate.ts'
import { assemblyPageHtml } from './assembly/pageHtml.ts'
import { defaultHostBridgeDeps, subscribeHostCalls, type HostBridgeDeps } from './assembly/hostBridge.ts'
import { createGatewayWorkspaceRoots } from './assembly/hostWorkspaceRoots.ts'
import { panelOpenSessionIds, panelSessionsMessage, routeSelection } from '../pure/sessionPanelRouting.ts'
import { pluginsPageMessage } from '../pure/pluginsPageRouting.ts'
import { chatPanelTabTitle, panelTabTitle } from '../pure/panelTab.ts'
import { panelTabIconPath } from './panelIcon.ts'
import { assignSessionTab, releaseSessionTab, sessionTabOf } from '../pure/sessionTabs.ts'
import { listSessions } from '../server/dshRpc.ts'
import { workspaceRootsOfSessionRows } from '../pure/workspaceRoots.ts'
import {
  bootstrapUrlOf,
  extractBootWire,
  extractFrontendAssets,
  filterWire,
  type BootWire,
  type GatewayAssets,
} from './assembly/wireFilter.ts'
import { ASSEMBLY_TREES, CHAT_TREE, PLUGINS_TREE, SETTINGS_TREE, SIDEBAR_TREE, localPluginIdsOf, type AssemblyTree } from './assembly/trees.ts'
import {
  ASSEMBLED_CHAT_VIEW_TYPE,
  decodeChatPanelState,
  placeRestoredChatPanel,
  type ChatPanelTarget,
} from '../pure/chatPanelState.ts'
import {
  decideSidebarStatus,
  assemblyFailureView,
  type SidebarHostStatus,
  type SidebarStatusDecision,
  type SidebarStatusView,
} from '../pure/sidebarStatus.ts'
import { createStatusFollow } from '../pure/sidebarStatusFollow.ts'
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
 * 版本门：网关 dsh 版本不在 [0.1.5-rc.2, 0.2.0) 时页面顶部加信息条（带一条能装出
 * 受支持版本的安装命令），不阻断。区间取值与安装命令都出自 src/pure/versionGate.ts。
 *
 * 面板恢复（#169）：chat 面板注册了 WebviewPanelSerializer（view type 见
 * pure/chatPanelState.ts），窗口重载 / 扩展宿主重启后由它把标签页装回原来的
 * 会话——没有 serializer 时 VS Code 会直接丢掉这些标签页。
 */

/**
 * 侧栏 view 的 contribute id（package.json views，#70 起内容 = 官方侧栏装配）。
 */
export const ASSEMBLED_SIDEBAR_VIEW_ID = 'dshOne.chat'

/** 当前打开的面板（单例：后开替换先开，与官方嵌入面板一致）。 */
let active: { panel: vscode.WebviewPanel; mirror: AssemblyMirror } | undefined

/** 面板是否被用户手动关过：「后开替换先开」的内部 dispose 不算（见 replacing）。 */
let closedByUser = false

/** 「后开替换先开」dispose 旧面板期间置 true，屏蔽其 dispose 产生的用户关闭信号。 */
let replacing = false

/**
 * 已开则聚焦并返回 true：侧栏点开会话/新建/fork/默认打开复用，避免整页重复装配。
 *
 * 死面板当没有（#223）：引用指向已 dispose 的面板时返回 false，调用方接着走「开一个
 * 新面板」那条路——不能把 `Webview is disposed` 抛给命令调用方（那一路用户侧同样是
 * 「点了没反应」）。这里**不在成功路径上落日志**：侧栏每次变可见都会调它，刷屏。
 */
export function revealAssembledChat(): boolean {
  const panel = pickChatPanel().panel
  if (panel === undefined) return false
  try {
    panel.reveal()
    return true
  } catch (err) {
    if (!isDeadWebviewError(err)) throw err
    noteDeadPanel(panel, err, undefined)
    return false
  }
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

/**
 * 自有插件产物目录（`dist/assembly/plugins`，构建期落盘）：mirror 读本地 bundle 的
 * 就是它，`localBundleRev` 也按它算本地产物的内容版本。
 */
function localPluginsDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'dist', 'assembly', 'plugins')
}

/**
 * 用 serverAuth 的 cookie GET 网关 /，提取 wire 并按该树 block list 过滤。
 *
 * localRev（本地产物的内容版本）在这里现算：它是 combo URL 缓存键里我们自己那一半，
 * 每次装配都从磁盘重算，重建过 bundle 之后打开的面板/重载的窗口才会取到新界面（#173）。
 */
async function loadGatewayAssembly(
  context: vscode.ExtensionContext,
  gateway: string,
  tree: AssemblyTree,
  logger: Logger,
): Promise<GatewayAssembly> {
  const cookie = cookieHeader(gateway)
  const res = await fetch(`${gateway}/`, {
    headers: cookie !== undefined ? { cookie } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
  const html = await res.text()
  return {
    // block list 里缺失的官方插件条目只报告不阻断（官方合并/下线插件是正常演进）
    wire: filterWire(
      extractBootWire(html),
      tree.blockList,
      tree.framePluginId,
      tree.extraPluginIds,
      await localBundleRev(localPluginsDir(context)),
      (line) => logger.warn(line),
    ),
    assets: extractFrontendAssets(html),
  }
}

/** 版本门：区间内/无法取得版本来源时返回信息条文本（undefined = 放行不显示）。 */
function versionBanner(version: string | undefined): string | undefined {
  if (version !== undefined && inPrereqRange(version)) return undefined
  // 信息条不只说「期望区间」——没告诉用户该装哪一版时，用户看到区间也不知道下一步做
  // 什么（#234）。所以两条文案都带一条能装出受支持版本的命令。
  const range = prereqRangeLabel()
  const install = installCommand()
  return version === undefined
    ? vscode.l10n.t('The dsh version is unknown; this chat UI was verified against {0}. Install a verified dsh with: {1}', range, install)
    : vscode.l10n.t('The connected dsh is {0}, outside the range this chat UI was verified against ({1}). Install a verified dsh with: {2}', version, range, install)
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
 * 宿主调用通道的允许根里的**追加那一份**（四棵树共用）：网关上各会话的工作目录集合。
 * 为什么需要它：git.show 的 cwd 按「当前会话所属工作区」传（页面侧从官方 sessions
 * 服务取，见 gitCardPlugin），那个目录未必是 VS Code 打开的目录，但它一定出现在网关的
 * 会话清单里——用这份服务端数据当允许根，页面伪造不了。
 *
 * 为什么不是 workspace.list：现代 dsh（0.1.2）没有这个端点（实测 POST
 * /api/workspace/list 返回 not found，与编造方法名同响应；官方客户端走
 * `workspace/follow` 流式方法，宿主一次性调用取不到）。详见
 * src/pure/workspaceRoots.ts 的头注。
 * 会话清单取一次缓存 5 分钟（hostWorkspaceRoots），每个 manager 一个实例。
 */
const gatewayRootsByManager = new WeakMap<ServerManager, () => Promise<readonly string[]>>()

/**
 * 侧栏面板专属的宿主能力（#99 顶栏齿轮 / ＋ 菜单「创建新工作区目录」、#176「添加完接着
 * 开新会话」、#247 官方侧栏那条「插件」行）。其余面板不给 = 那几枚入口在它们的页面里
 * 不出现（能力口按 `viaBridge` 如实上报，但页面侧另有 `settingsPage` / `workspaceCreate`
 * 判定，见 hostCapabilities）。
 *
 * **键集与 `hostBridgeDeps` 里那几条展开一一对应**：这里的每一条都必须原样搬进返回的
 * deps，漏一条就是「页面调得动、宿主恒回 `unsupported`」（#247 的现场）——`test/hostCapabilityDeps.test.ts`
 * 按这份类型逐个键钉住，往这里加第五条时它会在 typecheck 就先红。
 */
export interface SidebarPanelActions {
  openSettings?: () => void
  createWorkspaceDirectory?: () => Promise<unknown>
  /**
   * #176：在某个工作区里新建会话并打开（转发既有 `dshOne.session.new` 命令）。
   * 与上面两条一样是**该面板专属**的能力——只有侧栏那棵树需要它。
   */
  newSessionInWorkspace?: (workspaceId: string) => void
  /**
   * #247：打开（或聚焦）官方插件页（那个全局面板在我们的 shell 里是一个独立编辑器页）。
   * 同样是侧栏面板专属：官方侧栏那条「插件」行的点击经 `ctx.layout.selectPanel` 落到
   * 侧栏树的 layout 服务上，受理方再经能力口 `openPlugins` 回到宿主。
   */
  openPlugins?: () => void
}

/**
 * 宿主调用通道的依赖装配点（四棵树的 webview 都挂它，panelActions 只有侧栏树给）：
 * VS Code 工作区目录 + ~/.dsh + 上面那份追加允许根，加上下面逐条列的宿主动作。
 *
 * 导出是给 `test/hostCapabilityDeps.test.ts` 用的：那一组判据直接对这个函数断言
 * 「给了的每一条能力都必须原样出现在返回的 deps 里」——装配实验室用的假宿主自己
 * 应答能力调用，跑到的是「页面叫得动」，跑不到这一层（#247 穿透实验室的正是这个缺口）。
 */
export function hostBridgeDeps(
  manager: ServerManager,
  logger: Logger,
  gatewayOrigin?: () => string | undefined,
  panelActions?: SidebarPanelActions,
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
    // #121 侧栏树的会话行点击：先问「这个会话开在面板里吗」（宿主自己去重、页面侧
    // 据此决定就地改名还是按打开处理），答「没开」时再请宿主把面板亮到它（清一色
    // 落到 openSessionChat，与侧栏点会话那条通路同一个函数）。
    sessionInPanel: (sessionId) => sessionInPanel(sessionId),
    openSessionPanel: (sessionId) => showSessionInPanel(sessionId, logger),
    // #147：面板里现在开着哪些会话——侧栏树渲染「跑完还没被打开」那颗绿点时要吃它。
    // 与 `sessionInPanel` 同一份事实（`panelOpenSessions`），保证查询与广播不漂移。
    panelSessions: () => [...panelOpenSessions()],
    // git 查询的扫描/命中/超时留痕走输出面板「DSH One」频道（probe 同一条通道），
    // 页面侧不感知、UI 不阻塞。
    log: (line: string) => logger.info(line),
    // #109 工作区行：在编辑器窗口里打开文件夹（当前窗口 / 新窗口）与在目录上开集成
    // 终端。两条都转发到既有命令（那一套动作旧侧栏就在用，宿主侧只有一份实现）：
    // 页面只送路径与「要不要新窗口」，其余（Uri、终端名、cwd）在命令里定。
    openFolder: async (args) => {
      await vscode.commands.executeCommand('dshOne.workspace.openFolder', args.path, args.newWindow)
    },
    openTerminal: (args) => {
      void vscode.commands.executeCommand('dshOne.workspace.openTerminal', args.path)
    },
    // #99 侧栏顶栏：设置齿轮与 ＋ 菜单的「创建新工作区目录」。两项都是**该面板
    // 专属**的能力，由调用方注入；缺省不给 = 那两个入口在别的页面里不出现。
    //
    // 这四条展开与 `SidebarPanelActions` 的键集一一对应，**一条都不能少**：#247 的
    // 现场就是这里少了 `openPlugins` 那一条，于是 `hostBridge.ts` 派发表里的
    // `deps.openPlugins === undefined` 恒真，用户点侧栏那条「插件」行永远得到
    // `unsupported`（`host call vscode.openPlugins rejected: unsupported`）。
    // 判据见 test/hostCapabilityDeps.test.ts。
    ...(panelActions?.openSettings === undefined ? {} : { openSettings: panelActions.openSettings }),
    ...(panelActions?.createWorkspaceDirectory === undefined
      ? {}
      : { createWorkspaceDirectory: panelActions.createWorkspaceDirectory }),
    ...(panelActions?.newSessionInWorkspace === undefined
      ? {}
      : { newSessionInWorkspace: panelActions.newSessionInWorkspace }),
    ...(panelActions?.openPlugins === undefined ? {} : { openPlugins: panelActions.openPlugins }),
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
let creatingPanel: Promise<ChatPanelCreateResult> | undefined
/** 创建期间（或服务未就绪时）累积的待开会话；后来者覆盖先来者。 */
let pendingSessionOpen: string | undefined

/**
 * 已 dispose 的面板（#223 存活标志）。
 *
 * 为什么不能只看引用在不在：面板被关掉之后 `chatSingleton` / `active` 有可能还指着它
 * （宿主收摊时不逐个 dispose 面板，关闭事件与点击赛跑），这时 `reveal()` /
 * `postMessage` 抛 `Webview is disposed`——用户看到的就是「点了没反应」；而且坏引用
 * 不清，之后每一次点都撞同一堵墙（用户日志实证：7 秒内连撞 4 次）。置位点 =
 * `mountChatPanel` 的 `onDidDispose`（面板生命周期的唯一出口），以及真撞上那个异常时
 * （`noteDeadPanel`）。
 *
 * 实测说明：dispose 处理器在同一个同步 tick 里也把引用清了，所以「标志已置位、引用还在」
 * 这一刻在现有代码里到不了（去掉这条判定的负向对照是 0 条红，见本轮报告 N-11）。它是按
 * #223 第 1 条要求加的防御，也是日志里 `panel=singleton:disposed` 那一格的来源；把用户
 * 现场真正修好的是下面那条「捕获死面板 → 清引用 + 只重试一次」。
 */
const disposedPanels = new WeakSet<vscode.WebviewPanel>()

/** 面板 dispose 的时刻（#224 现场取证：失败行要写得出这个面板什么时候没的）。 */
const panelDisposedAt = new WeakMap<vscode.WebviewPanel, number>()

/** 面板装配起来的时刻（#224：dispose 行报存活时长）。 */
const panelMountedAt = new WeakMap<vscode.WebviewPanel, number>()

/**
 * 扩展宿主是否已开始收摊（#224 取证）：`deactivate` 调 {@link markHostDeactivating}
 * 置位。`chat panel disposed` 那行带上它，才分得清「用户点关闭」与「宿主把面板带走」
 * ——后者要跟同一 boot 的 `dsh-one deactivating` 那条日志对照着读。
 */
let hostDeactivating = false

/** 宿主开始收摊（`deactivate` 调用）：此后 dispose / 失败的面板按「宿主带走的」留痕。 */
export function markHostDeactivating(): void {
  hostDeactivating = true
}

/** 错误文字（日志字段用）。 */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 面板占的那份共享 mirror 引用的释放动作（装配时登记，见 `mountChatPanel`）。
 * 释放必须**幂等**（#223）：正常 dispose 与「发现面板已经死了」是两条路，都可能走到，
 * 而 `releaseSharedMirror` 只是减一——减两次会把别人正用着的 mirror 关掉。
 */
const panelRelease = new WeakMap<vscode.WebviewPanel, () => void>()

/** 释放这个面板占的资源（只生效一次）：dispose 与「发现已死」两条路共用。 */
function releasePanelResources(panel: vscode.WebviewPanel): void {
  const release = panelRelease.get(panel)
  if (release === undefined) return
  panelRelease.delete(panel)
  release()
}

/** #224 日志里「选中的面板」那一格：形态 + 它当时是不是已经没了。 */
type PanelField = 'none' | 'singleton:alive' | 'singleton:disposed'

/** 这次请求选中的单例面板 + 给日志的形态字段（#223 的存活判定入口）。 */
interface PickedChatPanel {
  /** 还活着的面板；没有、或引用指向已 dispose 的面板时为 undefined。 */
  panel: vscode.WebviewPanel | undefined
  found: PanelField
}

/**
 * 取这次请求该用的单例面板（#223）：**死面板一律当没有**——引用指向已 dispose 的
 * 面板时当场把坏引用清掉，返回 undefined，调用方随后走「建新面板」那条路。
 */
function pickChatPanel(): PickedChatPanel {
  const panel = chatSingleton?.panel ?? active?.panel
  if (panel === undefined) return { panel: undefined, found: 'none' }
  if (disposedPanels.has(panel)) {
    clearPanelRefs(panel)
    return { panel: undefined, found: 'singleton:disposed' }
  }
  return { panel, found: 'singleton:alive' }
}

/** 清掉指向这个面板的引用（只清它自己占着的那一格）。 */
function clearPanelRefs(panel: vscode.WebviewPanel): void {
  if (active?.panel === panel) active = undefined
  if (chatSingleton?.panel === panel) chatSingleton = undefined
}

/** 「面板 / webview 已经没了」这一类错误（#223）：VS Code 对已 dispose 的 webview 抛它。 */
function isDeadWebviewError(err: unknown): boolean {
  return /webview is disposed/i.test(errorText(err))
}

/**
 * #224 失败现场（一次请求没成功时能读出来的那几件事）：请求的会话、面板当时挂的会话、
 * 这个面板什么时候没的（`unobserved` = 宿主没把它的 dispose 送到我们这里）、还有没有
 * 待开请求、创建在不在途、宿主是不是已经开始收摊。
 */
function failureScene(panel: vscode.WebviewPanel | undefined, sessionId: string | undefined): string {
  const died = panel === undefined ? undefined : panelDisposedAt.get(panel)
  return [
    `requested=${shortSession(sessionId)}`,
    `panelSession=${shortSession(panel === undefined ? undefined : panelSessionId.get(panel))}`,
    `panelDisposedAt=${died === undefined ? 'unobserved' : new Date(died).toISOString()}`,
    `pending=${shortSession(pendingSessionOpen)}`,
    `creating=${creatingPanel !== undefined ? 'yes' : 'no'}`,
    `hostTeardown=${hostDeactivating ? 'yes' : 'no'}`,
  ].join(' ')
}

/**
 * #223：发现「引用还在、面板已经没了」——置存活标志、清坏引用、落一条带现场的 warn。
 * 坏引用清掉之后，之后每一次点都不会再撞同一堵墙；本次请求由调用方重走创建路径。
 */
function noteDeadPanel(panel: vscode.WebviewPanel, err: unknown, sessionId: string | undefined): void {
  const scene = failureScene(panel, sessionId)
  disposedPanels.add(panel)
  clearPanelRefs(panel)
  // 面板没了 = 它占的共享 mirror 引用可以还了（幂等：宿主后来补发 dispose 也不会减两次）。
  releasePanelResources(panel)
  chatDeps?.logger.warn(`chat open: panel is already gone (${scene}): ${errorText(err)}`)
}

/**
 * #224：这条通路（点会话 / 新会话要开面板）的每次请求落一行——一次点击一行，别刷屏。
 * 字段定长好 grep：
 *
 * `chat open: session=<短 id> panel=<none|singleton:alive|singleton:disposed> branch=<reveal|switch|create|retry|pending> result=<ok|failed:…>`
 */
function logChatOpen(fields: {
  sessionId: string | undefined
  panel: PanelField
  branch: string
  result: string
}): void {
  chatDeps?.logger.info(
    `chat open: session=${shortSession(fields.sessionId)} panel=${fields.panel} branch=${fields.branch} result=${fields.result}`,
  )
}

/**
 * 宿主的面板里现在开着哪些会话（#121 的单条查询与 #147 的整份下发共用这一份事实）。
 *
 * 判据是面板与它当前会话的映射：单例面板（`chatSingleton` / `active` + `panelSessionId`）
 * 与显式多开的标签页（`sessionTabPanels`）都算——两种形态都是这条会话的对话区真的
 * 在屏幕上。无面板、或面板上挂着别的会话 = 不在集合里。
 *
 * 注意它**不等于**「侧栏认为的当前会话」（`list.current`）：那个来自官方 sessions
 * 服务的状态（启动时可能是官方恢复的上次会话），与宿主真的开了哪个面板是两件事。
 */
function panelOpenSessions(): ReadonlySet<string> {
  // 死面板不算「开着」（#223）：这一份事实喂给侧栏树渲染绿点，指着死面板会让它
  // 认为某条会话正开在屏幕上（`pickChatPanel` 顺手把坏引用清掉）。
  const panel = pickChatPanel().panel
  return panelOpenSessionIds(
    panel === undefined ? undefined : panelSessionId.get(panel),
    sessionTabPanels.keys(),
  )
}

/**
 * 这个会话现在是不是正开在宿主的面板里（#121）——侧栏树据此判「点当前会话行 = 就地
 * 改名还是按打开处理」。
 */
function sessionInPanel(sessionId: string): boolean {
  return panelOpenSessions().has(sessionId)
}

/**
 * 把「面板里正开着哪些会话」推给全部装配页（#147）。
 *
 * 为什么要这条宿主 → 页面的下行通道：官方「跑完还没被打开」那颗绿点的武装条件是
 * **这一页的 selected 不是它**（`dsh-api-session-controller` 的
 * `syncCompletedNotifications`）。官方 web 只有一页、selected 就是屏幕上那一条，判据
 * 成立；我们的 shell 有两个 webview（侧栏页 + 对话面板页各一份官方 client），宿主把
 * 面板切到某条会话不会回写给侧栏页，于是侧栏页的 selected 与屏幕上真正开着的会话可以
 * 是两回事——那条会话跑完，侧栏照旧给它亮绿点，而用户正在看它（#147 报的现场）。
 *
 * 页面侧怎么消费：侧栏树把它算进「渲染这颗绿点」的判据（见
 * `workspaceTree/tree.ts` 的 `usePanelOpenSessions`）。**官方 web 侧收不到这条消息**
 * （那一端没有宿主面板这个事实）——集合恒为空、行为与今天完全一致。
 *
 * 发送时机 = 面板↔会话映射的每一处变化（建面板 / 页面报来的就地切换 / 关面板 /
 * 多开标签页的增删），另有页面挂载时的一条主动查询（`session.panelSessions`：
 * 页面可能比面板晚起来，只靠推送会漏掉这一刻的事实）。
 */
function broadcastPanelSessions(): void {
  const message = panelSessionsMessage(panelOpenSessions())
  // 尽力而为的下发：登记在册的 webview 里可能已经有一条没了（宿主收摊、与关闭赛跑，
  // 见 #223），那一条的 postMessage 会拒绝——**别让它变成没人处理的 rejection**
  // （实现在真宿主里会记一条 unhandled rejection，谁也读不出当时发生了什么）。
  for (const target of assemblyWebviews) void target.postMessage(message).then(undefined, () => undefined)
}

/**
 * 把对话面板亮到这个会话（#121）：与侧栏 `dshOne.sessionSelected` 那条通路
 * （下面的 `openSessionChat`）同一个函数——创建 / 聚焦 / 就地切换三种处置完全一致。
 *
 * 兜底不再静默（#223）：日志带现场，界面给用户一行反馈——此前这里只落一条 warn，
 * 用户侧零反应，「点了没反应」就是这么来的。（prepareChatPanel 那几种失败另有自己的
 * 弹窗与状态页，能落到这里的是创建路径上的意外错误。）
 */
function showSessionInPanel(sessionId: string, logger: Logger): void {
  void openSessionChat(sessionId).catch((err: unknown) => {
    const reason = errorText(err)
    logger.warn(`assembled chat: opening ${shortSession(sessionId)} failed (${failureScene(undefined, sessionId)}): ${reason}`)
    void vscode.window.showErrorMessage(vscode.l10n.t('Failed to open the chat panel: {0}', reason))
  })
}

/**
 * 把待开会话兑现到既有面板：同 id 只 reveal（宿主去重），不同才就地切换。
 *
 * 返回值（#223/#224）：`served` = 已兑现、`none` = 没有待开请求、`unserved` = 有请求
 * 但没兑现（没有可用面板，或面板在兑现的这一刻没了）——请求仍留在 `pendingSessionOpen`，
 * 调用方据此再走一次创建（同一次点击只这一跳，不是循环）。
 */
async function drainPendingSession(): Promise<'none' | 'served' | 'unserved'> {
  const logger = chatDeps?.logger
  const requested = pendingSessionOpen
  if (requested === undefined) return 'none'
  const picked = pickChatPanel()
  if (picked.panel === undefined) {
    // 没有可用面板（含引用指向死面板）：死面板的坏引用已由 pickChatPanel 清掉，请求
    // 留在 pending 等下一次创建兑现。这是一次「记下了但没兑现」（正常路径不会走到：
    // 兑现成功时 pending 已被创建那一步清掉），如实留一条带现场的 warn（#224）。
    logger?.warn(
      `chat open: pending request not served panel=${picked.found} (${failureScene(undefined, requested)})`,
    )
    return 'unserved'
  }
  const panel = picked.panel
  const route = routeSelection({ hasPanel: true, panelSessionId: panelSessionId.get(panel) }, requested)
  pendingSessionOpen = undefined
  try {
    panel.reveal()
    if (route === 'switch') {
      logger?.info(`assembled chat: switching to ${shortSession(requested)} (pending request)`)
      await panel.webview.postMessage({ type: 'dshOne.switchSession', sessionId: requested })
    }
  } catch (err) {
    if (!isDeadWebviewError(err)) throw err
    // 兑现的这一刻面板没了：请求放回 pending，调用方会再走一次创建。
    pendingSessionOpen = requested
    noteDeadPanel(panel, err, requested)
    return 'unserved'
  }
  logChatOpen({ sessionId: requested, panel: picked.found, branch: 'pending', result: 'ok' })
  return 'served'
}

/**
 * 建面板的结果（#224：失败要写得出失败在哪一步）。
 */
type ChatPanelCreateResult = { ok: true } | { ok: false; step: 'service' | 'manifest' | 'mirror' }

/** 会话 tab 的装配（命令路径的复用体）：opts.sessionId 有值 = 会话 tab（注入启动）。 */
async function openChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { sessionId?: string } = {},
): Promise<ChatPanelCreateResult> {
  // 已有在途创建：等它建完，再按路由把这次请求落到那个面板上（不重复建）
  if (creatingPanel !== undefined) {
    const result = await creatingPanel
    if (options.sessionId !== undefined) {
      pendingSessionOpen = options.sessionId
      await drainPendingSession()
    }
    return result
  }
  const creating = createChatPanel(context, manager, logger, options)
  creatingPanel = creating
  try {
    return await creating
  } finally {
    creatingPanel = undefined
    // 创建期间来的请求（例如用户在建默认面板时点了会话）：建完立即兑现
    await drainPendingSession()
  }
}

/** 面板的共用前置：服务就绪 + chat 树清单 + 共享 mirror（失败已弹窗）。 */
interface ChatPanelSetup {
  mirror: AssemblyMirror
  assembly: GatewayAssembly
  /** 版本门信息条文本（undefined = 网关在区间内，不显示）。 */
  banner: string | undefined
}

/**
 * 前置结果：装配成功给 setup；失败给一态状态页视图（#169 恢复路径要把它画
 * 进面板——恢复出来的标签页不能停在一片空白上）。失败时的用户可见提示
 * （showErrorMessage）仍在这里发，与「用户主动开面板」路径的行为一致。
 */
type ChatPanelPrep =
  | { ok: true; setup: ChatPanelSetup }
  | { ok: false; view: SidebarStatusView; step: ChatPanelFailStep }

/** 前置失败在哪一步（#224：请求留痕里 `result=failed:<这一步>`）。 */
type ChatPanelFailStep = 'service' | 'manifest' | 'mirror'

/**
 * 服务状态 → 状态页视图（`assemble` 这一态不该走到这里；真出现了按「服务没在跑」
 * 兜底，页面给出启动按钮，用户点一下就能自救）。
 */
function statusViewOf(status: SidebarHostStatus): SidebarStatusView {
  const decision = decideSidebarStatus(status)
  return decision.kind === 'assemble' ? { kind: 'serviceDown', starting: false } : decision
}

async function prepareChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<ChatPanelPrep> {
  const status = await manager.ensureStarted()
  if (status.state !== 'running' || !status.url) {
    void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
    return { ok: false, view: statusViewOf(status), step: 'service' }
  }
  let assembly: GatewayAssembly
  try {
    assembly = await loadGatewayAssembly(context, status.url, CHAT_TREE, logger)
  } catch (err) {
    const reason = errorText(err)
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to load the UI manifest from the dsh gateway: {0}', reason),
    )
    return { ok: false, view: assemblyFailureView(manager.getStatus(), reason), step: 'manifest' }
  }
  let mirror: AssemblyMirror
  try {
    mirror = await acquireSharedMirror(context, manager, logger)
  } catch (err) {
    const reason = errorText(err)
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to start the local UI proxy: {0}', reason),
    )
    return { ok: false, view: assemblyFailureView(manager.getStatus(), reason), step: 'mirror' }
  }
  return { ok: true, setup: { mirror, assembly, banner: versionBanner(dshVersion(status.url) ?? status.version) } }
}

/**
 * 对话面板标签页标题的当前值（#212）：会话标题 → 工作区名 → 「对话」，格式与图标口径
 * 都在 `pure/panelTab.ts`。**不再退到会话 id 片段**——用户看不出 `session-47…` 是哪条会话。
 */
function chatTitle(sessionTitle?: string): string {
  return chatPanelTabTitle({
    sessionTitle,
    workspaceName: titleWorkspaceName(),
    chatLabel: vscode.l10n.t('Chat'),
  })
}

/**
 * 标题兜底用的工作区名：`vscode.workspace.name` 优先（单文件夹窗口就是文件夹名），
 * 没有（未打开任何文件夹、未命名工作区）时取第一个文件夹的目录名。
 */
function titleWorkspaceName(): string | undefined {
  const name = vscode.workspace.name?.trim()
  if (name !== undefined && name !== '') return name
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder === undefined ? undefined : path.basename(folder.uri.fsPath)
}

/**
 * 面板的共用接线与首帧：探针、活跃上报（标题跟随）、宿主调用通道、主题广播登记，
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
  // 存活时长从这里起算（#224 的 dispose 行要用它）。
  panelMountedAt.set(panel, Date.now())
  // 这份 mirror 引用由这个面板持有：dispose 与「发现面板已经死了」两条路共用这一条
  // 释放动作（幂等，见 releasePanelResources）。
  panelRelease.set(panel, () => releaseSharedMirror(mirror))
  if (sessionId !== undefined) panelSessionId.set(panel, sessionId)
  if (tab && sessionId !== undefined) assignSessionTab(sessionTabPanels, panel, sessionId)
  // 地图变了就下发一次（#147）：新面板注入的会话当场就是「面板里开着它」。
  if (sessionId !== undefined) broadcastPanelSessions()
  const probeSub = subscribeAssemblyProbe(panel.webview, logger)
  // 标签页外观（#212）：刚装起来这一刻只有「人话」可给（会话标题还没上报上来），先按
  // 口径标名；图标在这里重挂一次是给恢复路径用的——VS Code 经 serializer 交回来的面板
  // 是个空壳，标题与图标都不随状态回来。
  panel.title = chatTitle()
  panel.iconPath = panelTabIconPath(context.extensionUri)
  // 活跃/标题上报（session-boot 插件）：维护映射 + 面板标题跟随会话标题。
  const metaSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { type?: unknown; sessionId?: unknown; title?: unknown }
    if (m.type !== 'dshOne.sessionMeta' || typeof m.sessionId !== 'string') return
    const moved = panelSessionId.get(panel) !== m.sessionId
    panelSessionId.set(panel, m.sessionId)
    // 页面内切会话（多开面板）：把**这个面板**的格子挪到新会话，别的面板的格子不碰
    //（旧实现按会话 id 直接删，两面板映射交叉时会删错，见 pure/sessionTabs.ts）。
    if (tab) assignSessionTab(sessionTabPanels, panel, m.sessionId)
    // 页面内切走 / 切到另一条会话 = 地图变了，下发一次（#147）。同 id 的重复上报
    //（官方每次重挂都会报一次）不发，免得白白重推。
    if (moved) broadcastPanelSessions()
    if (typeof m.title === 'string' && m.title !== '') panel.title = chatTitle(m.title)
  })
  // 宿主调用通道（#65 批 1）：页面插件（git 卡片/右键菜单/多开入口等）经它取 git 数据、
  // 开多开标签页与 VS Code 动作；白名单 + 参数校核在 hostBridge 内收口。
  const hostSub = subscribeHostCalls(panel.webview, logger, hostBridgeDeps(manager, logger, () => mirror.origin))
  trackAssemblyWebview(context, panel.webview)
  panel.onDidDispose(() => {
    // 存活标志（#223）：取面板的地方据此把死面板当没有；坏引用也在这里清掉。
    disposedPanels.add(panel)
    panelDisposedAt.set(panel, Date.now())
    // 面板生命周期的留痕（#169；#224 补齐现场）：dispose 只可能是「我们自己替换单例」
    // 或「用户/宿主关掉的」两种；后者的两档靠 `hostTeardown` 分开——`reason=other` +
    // `hostTeardown=yes` = 扩展宿主正在收摊（跟同一 boot 的 `dsh-one deactivating`
    // 配对），`hostTeardown=no` 才是用户点关闭。`age` 是面板存活时长，
    // `pending` / `creating` 是关掉这一刻还在飞的两件事。
    const born = panelMountedAt.get(panel)
    logger.info(
      `chat panel disposed: kind=${tab ? 'tab' : 'singleton'} session=${shortSession(panelSessionId.get(panel))}` +
        ` reason=${replacing ? 'replace' : 'other'} age=${born === undefined ? 'unknown' : `${Date.now() - born}ms`}` +
        ` pending=${shortSession(pendingSessionOpen)} creating=${creatingPanel !== undefined ? 'yes' : 'no'}` +
        ` hostTeardown=${hostDeactivating ? 'yes' : 'no'}`,
    )
    probeSub.dispose()
    metaSub.dispose()
    hostSub.dispose()
    untrackAssemblyWebview(panel.webview)
    if (tab) releaseSessionTab(sessionTabPanels, panel)
    panelSessionId.delete(panel)
    if (active?.panel === panel) active = undefined
    if (chatSingleton?.panel === panel) chatSingleton = undefined
    // 这个面板不在屏幕上了：地图变了，下发一次（#147）。
    broadcastPanelSessions()
    // 「用户关过」只记单例：关掉一个多开面板不该改变默认打开（#68）的行为。
    if (!tab && !replacing) closedByUser = true
    releasePanelResources(panel)
  })
  panel.webview.html = assemblyPageHtml({
    mirrorOrigin: mirror.origin,
    cspNonce: crypto.randomBytes(16).toString('base64'),
    assets: assembly.assets,
    bootWire: assembly.wire,
    bootstrapUrl: bootstrapUrlOf(assembly.wire),
    theme: currentTheme(),
    banner,
    bootSessionId: sessionId,
    panelTab: tab,
    localPluginIds: localPluginIdsOf(CHAT_TREE),
  })
}

/**
 * 日志里的会话名（前 13 位够区分；无会话写 none）。
 */
function shortSession(sessionId: string | undefined): string {
  return sessionId === undefined ? 'none' : sessionId.slice(0, 13)
}

/**
 * 建面板 / 装页中途失败时的收尾（#223）：撤掉刚登记的引用与那份 mirror 引用——
 * 不能留下指向死面板的单例（之后每次点都撞同一堵墙），也不能漏掉没人释放的
 * loopback 代理（引用计数只减不增，那次创建之后这个端口就一直开着）。
 */
function discardFailedPanel(panel: vscode.WebviewPanel | undefined, mirror: AssemblyMirror): void {
  if (panel === undefined) {
    releaseSharedMirror(mirror)
    return
  }
  disposedPanels.add(panel)
  clearPanelRefs(panel)
  releasePanelResources(panel)
}

/** 真正的建面板流程（由 openChatPanel 串行化调用）：单例语义，任何创建都顶替旧单例。 */
async function createChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { sessionId?: string },
): Promise<ChatPanelCreateResult> {
  const prepared = await prepareChatPanel(context, manager, logger)
  if (!prepared.ok) return { ok: false, step: prepared.step }
  const setup = prepared.setup
  const sessionId = options.sessionId
  // 单例语义（#71 终态）：任何创建都顶替旧单例（replace 期间的 dispose
  // 是我们自己触发的，不算用户手动关闭）。
  const replacedPanel = active?.panel
  if (replacedPanel !== undefined) {
    logger.info(
      `chat panel replaced: session=${shortSession(panelSessionId.get(replacedPanel))} -> ${shortSession(sessionId)}`,
    )
  }
  replacing = true
  try {
    replacedPanel?.dispose()
  } finally {
    replacing = false
  }
  let panel: vscode.WebviewPanel | undefined
  try {
    panel = vscode.window.createWebviewPanel(
      ASSEMBLED_CHAT_VIEW_TYPE,
      chatTitle(),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    panel.iconPath = panelTabIconPath(context.extensionUri)
    active = { panel, mirror: setup.mirror }
    chatSingleton = { panel }
    if (sessionId !== undefined && pendingSessionOpen === sessionId) pendingSessionOpen = undefined
    logger.info(`assembled chat: ${setup.mirror.origin}${sessionId === undefined ? '' : ` session=${sessionId.slice(0, 13)}`}`)
    logger.info(`chat panel created: kind=singleton session=${shortSession(sessionId)}`)
    mountChatPanel({ context, manager, logger, panel, setup, sessionId, tab: false })
  } catch (err) {
    // 建面板 / 装页中途失败（例：面板刚建出来就被宿主收走）：撤掉刚登记的引用与
    // mirror 引用，再把错误抛出去（用户侧由调用方给一行可见反馈）。
    discardFailedPanel(panel, setup.mirror)
    if (pendingSessionOpen === sessionId) pendingSessionOpen = undefined
    throw err
  }
  return { ok: true }
}

/**
 * 多开一个会话标签页（#72）——会话行菜单「在新标签页打开」的宿主落点。语义：
 * **已开则聚焦**（宿主去重；在途创建算已开，连点不会开两个）、未开则新建。
 * 全程不碰单例（`chatSingleton`/`active`）：多开与单 tab 各走各的，互不干扰。
 */
export async function openSessionInNewTab(sessionId: string): Promise<void> {
  // 死面板不算「已开」（#223）：它那一格先清掉，再按「没开」走下面新建——否则
  // `reveal()` 抛 Webview is disposed，用户看到的同样是「点了没反应」。
  const openTab = sessionTabOf(sessionTabPanels, sessionId)
  if (openTab !== undefined) {
    try {
      openTab.reveal()
      return
    } catch (err) {
      if (!isDeadWebviewError(err)) throw err
      noteDeadPanel(openTab, err, sessionId)
      releaseSessionTab(sessionTabPanels, openTab)
    }
  }
  // 在途创建（#72 的「已有」判定）：等创建落地再聚焦，绝不新建第二个面板。
  if (creatingSessionTabs.has(sessionId)) {
    await creatingSessionTabs.get(sessionId)
    sessionTabOf(sessionTabPanels, sessionId)?.reveal()
    return
  }
  const deps = chatDeps
  if (deps === undefined) return // 注册还没发生（页面入口也来自注册后的树）
  const created = (async () => {
    const prepared = await prepareChatPanel(deps.context, deps.manager, deps.logger)
    if (!prepared.ok) return
    const setup = prepared.setup
    let panel: vscode.WebviewPanel | undefined
    try {
      panel = vscode.window.createWebviewPanel(
        ASSEMBLED_CHAT_VIEW_TYPE,
        chatTitle(),
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      )
      panel.iconPath = panelTabIconPath(deps.context.extensionUri)
      deps.logger.info(`assembled chat tab: ${setup.mirror.origin} session=${sessionId.slice(0, 13)}`)
      deps.logger.info(`chat panel created: kind=tab session=${shortSession(sessionId)}`)
      mountChatPanel({
        context: deps.context,
        manager: deps.manager,
        logger: deps.logger,
        panel,
        setup,
        sessionId,
        tab: true,
      })
    } catch (err) {
      discardFailedPanel(panel, setup.mirror)
      throw err
    }
  })()
  creatingSessionTabs.set(sessionId, created)
  try {
    await created
  } finally {
    creatingSessionTabs.delete(sessionId)
  }
}

/**
 * 恢复一个对话面板（#169，`WebviewPanelSerializer` 的落点）：窗口重载 / 扩展宿主
 * 重启之后，VS Code 把页面当初经 `setState` 存下的 state 交回来，这里按它把标签页
 * 装回原来的会话。
 *
 * 重试那条路要留着：装配失败（网关没起来、清单拉不到）时面板上是状态页 + 按钮，
 * 按钮的动作由这里挂着——恢复出来的面板 VS Code 建完就不管了，接线只能自己来。
 */
function restoreChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  panel: vscode.WebviewPanel,
  state: unknown,
): Promise<void> {
  const saved = decodeChatPanelState(state)
  // 没存过 state（老面板、或页面没来得及写）按「默认单例面板」恢复：面板照样
  // 回来，只是不带会话注入，跟官方恢复值走。
  const target: ChatPanelTarget = saved ?? { sessionId: undefined, tab: false }
  logger.info(
    `chat panel restoring: kind=${target.tab ? 'tab' : 'singleton'} session=${shortSession(target.sessionId)} saved=${saved === undefined ? 'no' : 'yes'}`,
  )
  try {
    // 恢复出来的是新建的空壳 webview：脚本放行得显式设回来（创建时的选项不随
    // 序列化回来），下面的状态页与装配页都靠它。
    panel.webview.options = { enableScripts: true }
  } catch (err) {
    // 面板已经被关掉（恢复与用户关闭赛跑）：没什么可恢复的，如实留一条（带现场：
    // #224 里这一条要能读出「这个面板当时什么状态」）。
    logger.warn(`chat panel restore skipped (${failureScene(panel, target.sessionId)}): ${errorText(err)}`)
    return Promise.resolve()
  }
  let attempt: Promise<void> | undefined
  const run = (): Promise<void> => {
    attempt ??= mountRestoredChatPanel(context, manager, logger, panel, target).finally(() => {
      attempt = undefined
    })
    return attempt
  }
  const startThenRun = async (): Promise<void> => {
    try {
      await manager.ensureStarted()
    } catch (err) {
      logger.warn(`chat panel restore: starting the dsh service failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    await run()
  }
  // 状态页那三个按钮与侧栏同一套消息名（assembly:start / assembly:retry /
  // assembly:openInstallGuide），动作落到本面板；装配页不发这三个类型，无冲突。
  const messageSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const type = (msg as { type?: unknown }).type
    if (type === 'assembly:retry') void run()
    else if (type === 'assembly:start') void startThenRun()
    else if (type === 'assembly:openInstallGuide') openInstallGuide(logger, context.extensionUri)
  })
  panel.onDidDispose(() => messageSub.dispose())
  return run()
}

/**
 * 恢复时的装配一次：装得上就 mountChatPanel，装不上画状态页（面板照常可用、带重试）。
 * 全程不抛（`deserializeWebviewPanel` 抛错会被 VS Code 记成恢复失败、标签页丢掉）。
 */
async function mountRestoredChatPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  panel: vscode.WebviewPanel,
  target: ChatPanelTarget,
): Promise<void> {
  // 首帧：服务不在跑时先落「正在启动 / 未运行」页（同侧栏，别让用户对着空白等）；
  // 在跑就别闪一下状态页——装配是秒级的事。
  const initial = decideSidebarStatus(manager.getStatus())
  if (initial.kind !== 'assemble') renderChatStatusPage(panel, initial, logger)
  try {
    const prepared = await prepareChatPanel(context, manager, logger)
    if (!prepared.ok) {
      logger.warn(`chat panel restore failed: ${prepared.view.kind} (step=${prepared.step})`)
      renderChatStatusPage(panel, prepared.view, logger)
      return
    }
    const setup = prepared.setup
    const sessionId = await restoredSession(manager, target.sessionId, logger)
    const placement = placeRestoredChatPanel(
      { sessionId, tab: target.tab },
      // 单例槽位已被占（它恢复得晚，或别处已经开着/正开着一个单例）：这个面板降级
      // 成普通标签页，不顶掉已经在的那一个。**死面板不算占着**（#223）：引用指向
      // 已 dispose 的面板时按空处理，恢复出来的面板照常接单例槽位。
      { singletonOpen: pickChatPanel().panel !== undefined || creatingPanel !== undefined },
    )
    panel.title = chatTitle()
    if (placement === 'singleton') {
      active = { panel, mirror: setup.mirror }
      chatSingleton = { panel }
    }
    logger.info(`chat panel restored: kind=${placement} session=${shortSession(sessionId)}`)
    try {
      mountChatPanel({ context, manager, logger, panel, setup, sessionId, tab: placement === 'tab' })
    } catch (err) {
      // 走到这说明面板在装配期间被关掉了（webview 已 dispose）：把刚登记的槽位
      // 撤掉，别留一个指向死面板的单例。
      if (active?.panel === panel) active = undefined
      if (chatSingleton?.panel === panel) chatSingleton = undefined
      releasePanelResources(panel)
      logger.warn(`chat panel restore aborted (${failureScene(panel, sessionId)}): ${errorText(err)}`)
    }
  } catch (err) {
    const reason = errorText(err)
    logger.warn(`chat panel restore failed: ${reason}`)
    renderChatStatusPage(panel, assemblyFailureView(manager.getStatus(), reason), logger)
  }
}

/**
 * 恢复要开的那个会话还在不在（#169）：面板关着的这段时间里它可能被归档或删掉，
 * 把不存在的 id 注进页面只会让用户莫名其妙（页面会保持官方恢复值）。查不到就
 * 丢掉这个 id 并明说一句；网关查不通（刚起、网络抖动）时保留——「不知道」不等于
 * 「不存在」。
 */
async function restoredSession(
  manager: ServerManager,
  sessionId: string | undefined,
  logger: Logger,
): Promise<string | undefined> {
  if (sessionId === undefined) return undefined
  const url = manager.getStatus().url
  if (url === undefined) return sessionId
  try {
    const rows = await listSessions(url)
    if (rows.some((row) => row.sessionId === sessionId)) return sessionId
    logger.warn(`chat panel restore: session ${shortSession(sessionId)} is gone; restoring without it`)
    void vscode.window.showWarningMessage(
      vscode.l10n.t('The session this chat panel was showing no longer exists; the panel opens without it.'),
    )
    return undefined
  } catch (err) {
    logger.warn(
      `chat panel restore: session list unavailable (${err instanceof Error ? err.message : String(err)}); keeping ${shortSession(sessionId)}`,
    )
    return sessionId
  }
}

/**
 * 状态页画进面板（#169 的降级落点）：网关没起来 / 装不起来时不能停在一片空白上。
 * 复用侧栏那套状态页（同样三态、同样三个消息名），文案按面板说。
 *
 * 面板已经被关掉（恢复与用户关窗赛跑）就没地方画了，也不再抛——那一路由
 * dispose 的日志留痕，不必在这里制造一个错误。
 */
function renderChatStatusPage(panel: vscode.WebviewPanel, view: SidebarStatusView, logger?: Logger): void {
  try {
    panel.webview.html = sidebarStatusHtml(view, { surface: 'chatPanel' })
  } catch (err) {
    /* 面板已 dispose */
    // 静默的 catch 事后查不出来（#224）：面板已经被关掉（恢复与关窗赛跑）时没地方
    // 画了，如实留一条。
    logger?.warn(`chat panel status page skipped in a disposed panel: ${errorText(err)}`)
  }
}

/**
 * 侧栏桥消息落点（单例路由）：有活面板 → 揭示 + 转发就地切换消息（不 reload、
 * 不遮罩——运行时切换走官方打开会话的入口，加载态官方自带）；没有 → 创建
 * （冷启动注入 bootSessionId，防闪帧遮罩此刻生效一次）。
 *
 * #223 的两条守卫都在这里：**死面板当没有**（引用指向已 dispose 的面板时清掉坏引用
 * 直接建新的），以及真撞上 `Webview is disposed` 时**重试一次**走创建路径（只一次，
 * 绝不循环）。#224 的请求留痕也在这里落（一次点击一行）。
 */
async function openSessionChat(sessionId: string): Promise<void> {
  const picked = pickChatPanel()
  // 「找到的是死面板」= 本次请求要走的就是重试那条路（坏引用已被 pickChatPanel 清掉）。
  let branch: 'create' | 'retry' | 'reveal' | 'switch' = picked.found === 'singleton:disposed' ? 'retry' : 'create'
  if (picked.panel !== undefined) {
    // 有活面板：同 id 只聚焦（宿主去重），不同才就地切换
    try {
      branch = await serveFromPanel(picked.panel, sessionId)
      logChatOpen({ sessionId, panel: picked.found, branch, result: 'ok' })
      return
    } catch (err) {
      if (!isDeadWebviewError(err)) throw err
      // 引用还在、webview 已经没了：清坏引用并落到下面走创建路径（这一次「重试」
      // 就是为它准备的）。
      noteDeadPanel(picked.panel, err, sessionId)
      branch = 'retry'
    }
  }
  // 没可用面板：记下请求，冷启动以该会话创建（创建在途时等它建完再兑现，不重复建面板）
  pendingSessionOpen = sessionId
  // 这一格里已经发现的死面板要如实报出去（`found` 那一刻我们还不知道它死了）。
  const panelField: PanelField = branch === 'retry' ? 'singleton:disposed' : 'none'
  if (creatingPanel !== undefined) {
    await creatingPanel
    // 在途创建建完后由 drain 兑现这次请求（它自己落那行日志）
    if ((await drainPendingSession()) !== 'unserved') return
    // 建完的面板在这期间没了：落到下面自己再走一次创建（同一次点击只这一跳）
    if (creatingPanel !== undefined) return
  }
  const deps = chatDeps
  if (deps === undefined) {
    logChatOpen({ sessionId, panel: panelField, branch, result: 'failed:not-registered' })
    return // 注册还没发生：留在 pending，注册后由 registerAssembledChat 兜
  }
  try {
    const created = await openChatPanel(deps.context, deps.manager, deps.logger, { sessionId })
    logChatOpen({ sessionId, panel: panelField, branch, result: created.ok ? 'ok' : `failed:${created.step}` })
  } catch (err) {
    // 创建路径自己抛了（不是「准备步骤失败」那种有回执的失败）：留痕后原样上抛，
    // 由调用方（宿主能力口那条路）给用户一行可见反馈。
    logChatOpen({ sessionId, panel: panelField, branch, result: `failed:${errorText(err)}` })
    throw err
  }
}

/**
 * 把请求送到既有面板（#223）：同 id 只聚焦（宿主去重），不同才就地切换。
 *
 * 失败（面板已死）**原样抛给调用方**——统一在那里「清坏引用 + 重试一次」；其它错误
 * 照旧上抛，不吞。`postMessage` 的拒绝也要能被那次重试接住，所以这里等它，不 `void`。
 */
async function serveFromPanel(panel: vscode.WebviewPanel, sessionId: string): Promise<'reveal' | 'switch'> {
  const route = routeSelection({ hasPanel: true, panelSessionId: panelSessionId.get(panel) }, sessionId)
  panel.reveal()
  if (route === 'reveal') return 'reveal'
  await panel.webview.postMessage({ type: 'dshOne.switchSession', sessionId })
  return 'switch'
}

/**
 * #71 性能——共享 loopback mirror 池：同一窗口同一网关地址一个 mirror 实例
 * （稳定端口 = webview 源稳定 → 跨 tab HTTP 缓存生效，44 插件整包不再每 tab
 * 全量重下）。引用计数：每个面板 acquire，关 dispose 随最后一个回收。
 * 多树伺服：单 mirror 按树（framePluginId 键）各缓存一份过滤版整包。
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
      pluginsDir: localPluginsDir(context),
      treeCombos: ASSEMBLY_TREES.map((tree) => ({ framePluginId: tree.framePluginId, blockList: tree.blockList })),
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
    // 每树预取一次 combo，URL 里只带该树的**外框插件 id**：它既是缓存路由键
    // （mirror 按它选这份过滤整包），也是让 mirror 真的去拉官方整包的理由——
    // serveCombo 无论请求里有没有官方 id 都会先取一次该树的过滤整包（#178 A10：
    // 原先另塞一个官方 id 当「触发段」，那是硬编码一个我们并不拥有的 id，
    // 它被上游改名就会让这条请求 404、预热静默失效）。rev 任意值即可（缓存键）。
    for (const tree of ASSEMBLY_TREES) {
      await fetch(`${mirror.origin}/plugins-local/??${tree.framePluginId}/client.js&rev=preheat`)
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
  return vscode.Disposable.from(
    // #224：命令路径（新建会话 / fork / 面板命令 / 默认打开）也落一行请求留痕——
    // 与侧栏点击那条路合起来，这条通路的每一次请求都读得出来。
    vscode.commands.registerCommand('dshOne.assembledChat', async () => {
      const found = pickChatPanel().found
      const created = await openChatPanel(context, manager, logger)
      logChatOpen({
        sessionId: undefined,
        panel: found,
        branch: found === 'singleton:disposed' ? 'retry' : 'create',
        result: created.ok ? 'ok' : `failed:${created.step}`,
      })
    }),
    // 面板跨「窗口重载 / 扩展宿主重启」的恢复（#169）：没注册 serializer 时
    // VS Code 会把这些标签页直接丢掉（用户观感 = 「面板没了、要重新打开」）。
    // state 由页面经官方 `acquireVsCodeApi().setState()` 存（见 sessionBootPlugin），
    // 这里读回来重装。前提是 package.json 声明了
    // `onWebviewPanel:dshOne.assembledChat` 激活事件——恢复发生在激活之前，
    // 扩展没被唤起就没人注册 serializer（官方文档的硬要求）。
    vscode.window.registerWebviewPanelSerializer(ASSEMBLED_CHAT_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state) => restoreChatPanel(context, manager, logger, panel, state),
    }),
  )
}

/**
 * 侧栏位装配 provider（#70）：dshOne.chat view 的内容从自研 vanilla 换成
 * 官方侧栏装配（第二棵 cordis 树）。生命周期：首次 resolve 装配一次，mirror
 * 随 view dispose 回收（retainContextWhenHidden 下折叠不触发 dispose）；
 * 装不起来（未安装 / 服务没起 / 装配失败）落状态页，各自的按钮重新走一遍。
 *
 * 状态页跟随服务状态变化（#101）：视图可见期间订着 `ServerManager.onDidChangeState`，
 * 状态一变就按新状态重画（服务起来了则直接去装配），用户不必再等下一次动作。
 */
class AssembledSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private mirror: AssemblyMirror | undefined
  private running: Promise<void> | undefined

  /** 当前画在视图里的是不是状态页（装配页在位时不抢它的刷新）。 */
  private statusShown = false

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
    /**
     * 开/聚焦插件页（#247：官方侧栏那条「插件」行的落点，经宿主能力口
     * `openPlugins` 触发——那一行的点击走官方 `ctx.layout.selectPanel('plugins')`，
     * 落到我们提供的 layout 服务上，受理方再经能力口回到这里）。
     */
    private readonly onOpenPlugins?: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true }
    const probeSub = subscribeAssemblyProbe(view.webview, this.logger)
    const hostSub = subscribeHostCalls(
      view.webview,
      this.logger,
      hostBridgeDeps(this.manager, this.logger, () => this.mirror?.origin, {
        // #99：顶栏齿轮走能力口（不再要求页面自己 postMessage）；三条都复用既有动作
        // ——设置页的注册/聚焦在马甲这一层（onOpenSettings），建目录复用
        // `dshOne.workspace.create` 命令（宿主原生输入框 + 建目录 + 注册 + 刷新），
        // #176 的「添加完接着开新会话」复用 `dshOne.session.new` 命令（建会话 + 开
        // 装配对话页），页面只看得到能力口。
        openSettings: () => this.onOpenSettings?.(),
        // #247：官方侧栏那条「插件」行点了之后开我们那一页（它落在独立编辑器页里，
        // 与设置页同一个形状）。受理这次点击的是侧栏树自己的 layout 服务（机制层 2：
        // 官方通过服务契约调它），这里只是那条链路的宿主端。
        openPlugins: () => this.onOpenPlugins?.(),
        // 返回值要**原样透出**：命令给的是新注册的 `WorkspaceView`，页面靠它的 id
        // 去开新会话、并在被分组过滤挡住时点名提示（#176 之前这里把它丢掉了）。
        createWorkspaceDirectory: async () => await vscode.commands.executeCommand('dshOne.workspace.create'),
        newSessionInWorkspace: (workspaceId: string) => {
          void vscode.commands.executeCommand('dshOne.session.new', workspaceId)
        },
      }),
    )
    trackAssemblyWebview(this.context, view.webview)
    const retrySub = view.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return
      const type = (msg as { type?: unknown }).type
      if (type === 'assembly:retry') void this.assemble(view)
      else if (type === 'assembly:start') this.startFromStatusPage(view)
      else if (type === 'assembly:openInstallGuide') openInstallGuide(this.logger, this.context.extensionUri)
      else if (type === 'dshOne.sessionSelected') {
        const sessionId = (msg as { sessionId?: unknown }).sessionId
        if (typeof sessionId === 'string' && sessionId !== '') void openSessionChat(sessionId)
      }
    })
    // 状态页跟随服务状态变化（#101）：服务被别处起停时，画出来的状态页跟着变。
    const follow = createStatusFollow<ServerStatus>({
      source: this.manager,
      isStatusShown: () => this.statusShown,
      onStatusChanged: (status) => this.followStatus(view, status),
    })
    follow.start()
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (!view.visible) {
        // 藏起来的页面不必跟着重画，也就不必留着这份监听。
        follow.stop()
        return
      }
      this.onDidBecomeVisible?.()
      // 收起侧栏期间服务的起停没人听：回来时按当前状态补一次。
      follow.start()
      if (this.statusShown) this.followStatus(view, this.manager.getStatus())
    })
    view.onDidDispose(() => {
      probeSub.dispose()
      hostSub.dispose()
      retrySub.dispose()
      visibilitySub.dispose()
      follow.stop()
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
    this.renderStatus(view.webview, decideSidebarStatus(this.manager.getStatus()))
    void started.then(() => this.assemble(view))
  }

  /**
   * 落状态页（#100）：三态各有自己的文案与按钮——
   * - 未安装：「查看安装指南」→ 开独立的安装引导 tab（窄侧栏放不下引导内容）；
   * - 服务未运行 / 启动中：「启动 dsh 服务」（启动中只显示进度文案）；
   * - 装配失败：说明原因 + 「重试装配」。
   *
   * 判定结果若是 `assemble`（服务在跑、交给装配页）就什么都不做。
   * 页面的 HTML 由 `sidebarStatusPage.ts` 出（宿主侧普通 HTML，不参与装配树）。
   */
  private renderStatus(webview: vscode.Webview, decision: SidebarStatusDecision): void {
    if (decision.kind === 'assemble') return
    this.statusShown = true
    webview.html = sidebarStatusHtml(decision)
  }

  /**
   * 服务状态变了一次（#101）：能装配了就去装配（例如服务被别处起来了），
   * 否则按新状态把状态页重画一遍。
   */
  private followStatus(view: vscode.WebviewView, status: ServerStatus): void {
    const decision = decideSidebarStatus(status)
    if (decision.kind !== 'assemble') {
      this.renderStatus(view.webview, decision)
      return
    }
    void this.assemble(view)
  }

  /** 装配一次：ensureStarted → 清单 → mirror → 装配页；装不起来落状态页。 */
  private assemble(view: vscode.WebviewView): void {
    this.running ??= (async () => {
      // 首帧先落状态页（服务在跑时马上被装配页替换）：侧栏揭面到装配完成之间是
      // 网关往返，这段时间不该是白屏。已在装的服务不用重画（等结果就行）。
      const initial = decideSidebarStatus(this.manager.getStatus())
      if (initial.kind !== 'assemble') this.renderStatus(view.webview, initial)
      const status = await this.manager.ensureStarted()
      const decision = decideSidebarStatus(status)
      if (decision.kind !== 'assemble') {
        this.renderStatus(view.webview, decision)
        return
      }
      try {
        const assembly = await loadGatewayAssembly(this.context, decision.url, SIDEBAR_TREE, this.logger)
        // 重试路径：先释放旧 mirror（插件集可能已变）。
        if (this.mirror !== undefined) releaseSharedMirror(this.mirror)
        this.mirror = await acquireSharedMirror(this.context, this.manager, this.logger)
        this.logger.info(`assembled sidebar: ${this.mirror.origin}`)
        // 装配页在位：此后状态变化不再由状态页的跟随接管。
        this.statusShown = false
        view.webview.html = assemblyPageHtml({
          mirrorOrigin: this.mirror.origin,
          cspNonce: crypto.randomBytes(16).toString('base64'),
          assets: assembly.assets,
          bootWire: assembly.wire,
          bootstrapUrl: bootstrapUrlOf(assembly.wire),
          theme: currentTheme(),
          banner: versionBanner(dshVersion(decision.url) ?? status.version),
          localPluginIds: localPluginIdsOf(SIDEBAR_TREE),
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.logger.warn(`assembled sidebar failed: ${reason}`)
        this.mirror?.dispose()
        this.mirror = undefined
        this.renderStatus(view.webview, assemblyFailureView(status, reason))
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
  options: { onDidBecomeVisible?: () => void; onOpenSettings?: () => void; onOpenPlugins?: () => void } = {},
): vscode.Disposable {
  const provider = new AssembledSidebarProvider(
    context,
    manager,
    logger,
    options.onDidBecomeVisible,
    options.onOpenSettings,
    options.onOpenPlugins,
  )
  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(ASSEMBLED_SIDEBAR_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
  )
}

/**
 * 设置面板的宿主侧状态（#233：「已开则聚焦」这条路原先**没有存活判定、也没有任何日志**，
 * 口径对齐 chat 面板在 #223 / #224 补上的那一套）。
 *
 * 为什么需要存活判定：设置页的打开动作是两步——侧栏齿轮经宿主能力口 `openSettings` 先问
 * 「已开则聚焦」（{@link revealAssembledSettings}），问不到才走命令
 * `dshOne.assembledSettings` 全量新建（`extension.ts` 的 `openAssembledSettings`）。
 * 而齿轮那条路是**不等着调用**的（`hostBridge.ts` 里 `deps.openSettings()` 后面没有
 * await），所以 `reveal()` 撞上死面板时抛出的 `Webview is disposed` **没人接**：用户侧
 * 「点了没反应」，日志里一条记录也没有（#233 报的现场）。
 */
let settingsDeps: { logger: Logger } | undefined

/** 当前打开的设置面板（单例：后开替换先开，与 chat 面板一致）。 */
let activeSettings: { panel: vscode.WebviewPanel; mirror: AssemblyMirror } | undefined

/** 已 dispose 的设置面板（#233 存活标志）：取面板的地方据此把死面板当没有。 */
const disposedSettingsPanels = new WeakSet<vscode.WebviewPanel>()

/** 设置面板装配起来的时刻（#233：dispose 行报存活时长）。 */
const settingsMountedAt = new WeakMap<vscode.WebviewPanel, number>()

/** 设置面板 dispose 的时刻（#233 现场取证：失败行要写得出这个面板什么时候没的）。 */
const settingsDisposedAt = new WeakMap<vscode.WebviewPanel, number>()

/**
 * 设置面板占的那份共享 mirror 引用的释放动作（装配时登记）。释放必须**幂等**（与 chat
 * 面板同因）：正常 dispose 与「发现面板已经死了」是两条路，都可能走到，而
 * `releaseSharedMirror` 只是减一——减两次会把别人正用着的 mirror 关掉。
 */
const settingsRelease = new WeakMap<vscode.WebviewPanel, () => void>()

/** 在途的设置面板创建：连点两次齿轮只建一个面板（口径同 chat 面板的 `creatingPanel`）。 */
let creatingSettingsPanel: Promise<SettingsPanelCreateResult> | undefined

/** #233 日志里「选中的设置面板」那一格：形态 + 它当时是不是已经没了。 */
type SettingsPanelField = 'none' | 'singleton:alive' | 'singleton:disposed'

/** 这次请求选中的设置面板 + 给日志的形态字段（#233 的存活判定入口）。 */
interface PickedSettingsPanel {
  /** 还活着的面板；没有、或引用指向已 dispose 的面板时为 undefined。 */
  panel: vscode.WebviewPanel | undefined
  found: SettingsPanelField
}

/**
 * 取这次请求该用的设置面板（#233，口径同 chat 的 `pickChatPanel`）：**死面板一律当没有**
 * ——引用指向已 dispose 的面板时当场清掉坏引用、还掉它占的 mirror 引用、留一条带现场的
 * warn，返回 undefined，调用方随后走「新建」那条路。
 *
 * 实测说明（与 chat 面板 #223 同一条）：dispose 处理器在同一个同步 tick 里也把引用清了，
 * 所以「标志已置位、引用还在」这一刻在现有代码里到不了（负向对照 0 条红，见 #233 报告）。
 * 它是按「关掉之后再点必须新建」这条要求加的防御，也是日志里 `panel=singleton:disposed`
 * 那一格的来源；把用户现场真正修好的是下面那条「捕获死面板 → 清引用 → 返回 false 让上层
 * 新建」。
 */
function pickSettingsPanel(): PickedSettingsPanel {
  const panel = activeSettings?.panel
  if (panel === undefined) return { panel: undefined, found: 'none' }
  if (disposedSettingsPanels.has(panel)) {
    noteDeadSettingsPanel(panel, undefined)
    return { panel: undefined, found: 'singleton:disposed' }
  }
  return { panel, found: 'singleton:alive' }
}

/** 清掉指向这个面板的引用（设置面板只有单例这一格）。 */
function clearSettingsRefs(panel: vscode.WebviewPanel): void {
  if (activeSettings?.panel === panel) activeSettings = undefined
}

/** 释放这个设置面板占的资源（只生效一次）：dispose 与「发现已死」两条路共用。 */
function releaseSettingsPanelResources(panel: vscode.WebviewPanel): void {
  const release = settingsRelease.get(panel)
  if (release === undefined) return
  settingsRelease.delete(panel)
  release()
}

/**
 * #233 失败现场：这个面板什么时候没的（`unobserved` = 宿主没把它的 dispose 送到我们这里）、
 * 创建在不在途、宿主是不是已经开始收摊（后两项与 chat 面板的现场字段同一口径）。
 */
function settingsFailureScene(panel: vscode.WebviewPanel | undefined): string {
  const died = panel === undefined ? undefined : settingsDisposedAt.get(panel)
  return [
    `panelDisposedAt=${died === undefined ? 'unobserved' : new Date(died).toISOString()}`,
    `creating=${creatingSettingsPanel !== undefined ? 'yes' : 'no'}`,
    `hostTeardown=${hostDeactivating ? 'yes' : 'no'}`,
  ].join(' ')
}

/**
 * #233：发现「引用还在、面板已经没了」——置存活标志、清坏引用、还掉它占的 mirror 引用、
 * 落一条带现场的 warn。坏引用清掉之后，之后每一次点都不会再撞同一堵墙。
 */
function noteDeadSettingsPanel(panel: vscode.WebviewPanel, err: unknown): void {
  disposedSettingsPanels.add(panel)
  clearSettingsRefs(panel)
  releaseSettingsPanelResources(panel)
  settingsDeps?.logger.warn(
    `settings open: panel is already gone (${settingsFailureScene(panel)})${err === undefined ? '' : `: ${errorText(err)}`}`,
  )
}

/**
 * #233 的请求留痕（口径对齐 #224 给 chat 面板的）：一次「打开设置」一行，字段定长好 grep：
 *
 * `settings open: panel=<none|singleton:alive|singleton:disposed> branch=<reveal|create> result=<ok|failed:…>`
 *
 * 「聚焦」那一步落 `branch=reveal`（齿轮那条路）、「新建」那一步落 `branch=create`（命令
 * 那条路）；一次点击因此可能是两行——前一行说明为什么没能直接聚焦，读的时候按同一个
 * tick 连着看。
 */
function logSettingsOpen(fields: { panel: SettingsPanelField; branch: 'reveal' | 'create'; result: string }): void {
  settingsDeps?.logger.info(
    `settings open: panel=${fields.panel} branch=${fields.branch} result=${fields.result}`,
  )
}

/**
 * 已开则聚焦并返回 true：侧栏齿轮点击与命令面板共用（`extension.ts` 那条
 * `if (!revealAssembledSettings()) 走命令`），避免重复装配。
 *
 * 死面板当没有（#233）：引用指向已 dispose 的面板、或 `reveal()` 撞上 `Webview is disposed`
 * 时，清掉坏引用并返回 false，让上一层去建新的——**绝不把异常抛给调用方**：齿轮那条路是
 * 不等着调用的，抛出去没人接，用户侧就是「点了没反应」，日志里也一片安静。
 */
export function revealAssembledSettings(): boolean {
  const picked = pickSettingsPanel()
  if (picked.panel === undefined) {
    // 这一格里刚才发现的死面板如实落一行；正常「没有面板」不落——那一次点击的留痕由
    // 命令那一步落（一次打开一行）。
    if (picked.found === 'singleton:disposed') {
      logSettingsOpen({ panel: picked.found, branch: 'reveal', result: 'failed:panel-disposed' })
    }
    return false
  }
  try {
    picked.panel.reveal()
    logSettingsOpen({ panel: picked.found, branch: 'reveal', result: 'ok' })
    return true
  } catch (err) {
    if (!isDeadWebviewError(err)) throw err
    noteDeadSettingsPanel(picked.panel, err)
    logSettingsOpen({ panel: picked.found, branch: 'reveal', result: `failed:${errorText(err)}` })
    return false
  }
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
  // #233：日志句柄登记在这里——`revealAssembledSettings` 是导出给 `extension.ts` 调的，
  // 拿不到 logger（chat 面板的 `chatDeps` 同一个做法）。
  settingsDeps = { logger }
  return vscode.commands.registerCommand('dshOne.assembledSettings', async () => {
    // 这一格里选中的面板（请求那一刻的形态，含「引用指着死面板」）：#233 的留痕用它。
    const found = pickSettingsPanel().found
    const created = await openSettingsPanel(context, manager, logger)
    logSettingsOpen({ panel: found, branch: 'create', result: created.ok ? 'ok' : `failed:${created.step}` })
  })
}

/** 建设置面板的结果（#233：失败要写得出失败在哪一步，日志里就是 `result=failed:<这一步>`）。 */
type SettingsPanelCreateResult = { ok: true } | { ok: false; step: string }

/**
 * 打开设置面板（命令 `dshOne.assembledSettings` 的实现体）。
 *
 * 在途创建就等它建完（口径与 chat 面板的 `openChatPanel` 一致）：用户在「还没有面板」时
 * 连点两次齿轮，两次请求落在同一个创建上——只建一个面板，不增生。
 */
async function openSettingsPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<SettingsPanelCreateResult> {
  const inFlight = creatingSettingsPanel
  if (inFlight !== undefined) return await inFlight
  const creating = createSettingsPanel(context, manager, logger)
  creatingSettingsPanel = creating
  try {
    return await creating
  } finally {
    creatingSettingsPanel = undefined
  }
}

/** 真正的建设置面板流程（由 openSettingsPanel 串行化调用）：单例语义，任何创建都顶替旧单例。 */
async function createSettingsPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<SettingsPanelCreateResult> {
  const status = await manager.ensureStarted()
  if (status.state !== 'running' || !status.url) {
    void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
    return { ok: false, step: 'service' }
  }
  let assembly: GatewayAssembly
  try {
    assembly = await loadGatewayAssembly(context, status.url, SETTINGS_TREE, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to load the UI manifest from the dsh gateway: {0}', err instanceof Error ? err.message : String(err)),
    )
    return { ok: false, step: 'manifest' }
  }
  let mirror: AssemblyMirror
  try {
    mirror = await acquireSharedMirror(context, manager, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to start the local UI proxy: {0}', err instanceof Error ? err.message : String(err)),
    )
    return { ok: false, step: 'mirror' }
  }
  // 单例语义：任何创建都顶替旧单例。取面板走 pickSettingsPanel——引用指着死面板时它当场
  // 把坏引用清掉、把那份 mirror 引用还掉（#233），下面这一跳就不会漏下旧面板的资源。
  const replaced = pickSettingsPanel().panel
  if (replaced !== undefined) {
    logger.info('settings panel replaced')
    replacing = true
    try {
      replaced.dispose()
    } finally {
      replacing = false
    }
  }
  // 建到一半失败时要撤的那个面板（连面板都没建出来时是 undefined）。
  let created: vscode.WebviewPanel | undefined
  try {
    // 面板用一个局部常量接住：后面那些处理（含 onDidDispose 闭包）都挂在它身上，闭包里
    // 引用外层的 `created` 是可能为 undefined 的可变变量，TS 收窄不到。
    const panel = vscode.window.createWebviewPanel(
      'dshOne.assembledSettings',
      panelTabTitle(vscode.l10n.t('Settings')),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    created = panel
    panel.iconPath = panelTabIconPath(context.extensionUri)
    activeSettings = { panel, mirror }
    // 这份 mirror 引用由这个面板持有：dispose 与「发现面板已经死了」两条路共用这一条
    // 释放动作（幂等，见 releaseSettingsPanelResources）。
    settingsRelease.set(panel, () => releaseSharedMirror(mirror))
    // 存活时长从这里起算（#233 的 dispose 行要用它）。
    settingsMountedAt.set(panel, Date.now())
    logger.info(`assembled settings: ${mirror.origin}`)
    logger.info('settings panel created')
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
      // 存活标志（#233）：取面板的地方据此把死面板当没有。
      disposedSettingsPanels.add(panel)
      settingsDisposedAt.set(panel, Date.now())
      // 面板生命周期的留痕（#233，口径同 chat 面板 #224）：dispose 只可能是「我们自己
      // 替换单例」或「用户/宿主关掉的」两种；后者的两档靠 `hostTeardown` 分开——
      // `reason=other` + `hostTeardown=yes` = 扩展宿主正在收摊（跟同一 boot 的
      // `dsh-one deactivating` 配对），`hostTeardown=no` 才是用户点关闭。`age` 是面板
      // 存活时长。
      const born = settingsMountedAt.get(panel)
      logger.info(
        `settings panel disposed: reason=${replacing ? 'replace' : 'other'}` +
          ` age=${born === undefined ? 'unknown' : `${Date.now() - born}ms`}` +
          ` hostTeardown=${hostDeactivating ? 'yes' : 'no'}`,
      )
      // 清引用与还 mirror 引用这两步必须在 finally 里（#233）：中间任何一步抛错都不能留下
      // 「指向死面板的引用」（之后每次点都撞同一堵墙，用户侧就是「点了没反应」）或
      // 「没人还的共享 mirror 引用」（那个 loopback 端口就一直开着）。原实现把清引用放在
      // 最后一句，前面任一环抛错就漏掉了。
      try {
        probeSub.dispose()
        docSub.dispose()
        hostSub.dispose()
        untrackAssemblyWebview(panel.webview)
      } finally {
        clearSettingsRefs(panel)
        releaseSettingsPanelResources(panel)
      }
    })
    panel.webview.html = assemblyPageHtml({
      mirrorOrigin: mirror.origin,
      cspNonce: crypto.randomBytes(16).toString('base64'),
      assets: assembly.assets,
      bootWire: assembly.wire,
      bootstrapUrl: bootstrapUrlOf(assembly.wire),
      theme: currentTheme(),
      banner: versionBanner(dshVersion(status.url) ?? status.version),
      localPluginIds: localPluginIdsOf(SETTINGS_TREE),
    })
  } catch (err) {
    // 建面板 / 装页中途失败（例：面板刚建出来就被宿主收走）：撤掉刚登记的引用与那份
    // mirror 引用，再给用户一行可见反馈（#233：命令这条路**不许静默**——它被齿轮那条路
    // 不等着调用，抛出去就是一个没人接的 rejection = 用户侧「点了没反应」）。
    discardFailedSettingsPanel(created, mirror)
    void vscode.window.showErrorMessage(vscode.l10n.t('Failed to open the settings panel: {0}', errorText(err)))
    return { ok: false, step: `create:${errorText(err)}` }
  }
  return { ok: true }
}

/**
 * 建设置面板中途失败时的收尾（#233，口径同 chat 面板的 `discardFailedPanel`）：撤掉刚登记
 * 的引用与那份 mirror 引用——不能留下指向死面板的单例（之后每次点都撞同一堵墙），也不能
 * 漏掉没人释放的 loopback 代理（引用计数只减不增，那次创建之后这个端口就一直开着）。
 */
function discardFailedSettingsPanel(panel: vscode.WebviewPanel | undefined, mirror: AssemblyMirror): void {
  if (panel === undefined) {
    releaseSharedMirror(mirror)
    return
  }
  disposedSettingsPanels.add(panel)
  clearSettingsRefs(panel)
  releaseSettingsPanelResources(panel)
}


// ---------------------------------------------------------------------------
// 插件页面板（#247）：官方那个「插件」全局面板（keyed `main` 的 key `plugins`）
// 在 VS Code 侧单开一个编辑器页
//
// 形态与设置面板同源（#70 设置独立成页）：单例、装配一棵自己的树（PLUGINS_TREE）、
// 共享 mirror、命令 `dshOne.assembledPlugins` 全量新建、经宿主能力口
// `openPlugins` 打开（侧栏那一行点击的落点，见 sidebarLayoutPlugin 的 openPanel
// 处置）。
//
// 与设置面板的两处差别，都在这一段里写清：
// 1. **多一条「这一页开着没有」的回灌**（`broadcastPluginsPage`）：那一页的入口在
//    侧栏 webview 里，而它自己开在另一个 webview——侧栏那一行的选中态（官方
//    PanelRow 读 root 槽位钩子 `panelInfo`）要跟着这份事实走，所以建成/关掉各推一条
//    `dshOne.pluginsPage`（形状与解析在 `pure/pluginsPageRouting.ts`）。设置页没有
//    这一条：它的入口（顶栏齿轮）不显示选中态。
// 2. **不注册 WebviewPanelSerializer**：chat 面板注册 serializer 是因为它要恢复
//    「开的是哪条会话」这份状态（#169）；插件页没有随面板变的参数，重载窗口丢掉标签页
//    与设置页同一种处置（用户从命令面板/侧栏那一行再开一次即可）。
// ---------------------------------------------------------------------------

/** 当前打开的插件页面板（单例：后开替换先开，与 chat / 设置面板一致）。 */
let activePlugins: { panel: vscode.WebviewPanel; mirror: AssemblyMirror } | undefined

/** 已 dispose 的插件页面板：取面板的地方据此把死面板当没有（口径同设置面板 #233）。 */
const disposedPluginsPanels = new WeakSet<vscode.WebviewPanel>()

/** 插件页面板占的那份共享 mirror 引用的释放动作（幂等，同设置面板）。 */
const pluginsRelease = new WeakMap<vscode.WebviewPanel, () => void>()

/** 在途的插件页面板创建：连点两次只建一个面板（口径同 chat / 设置面板）。 */
let creatingPluginsPanel: Promise<PluginsPanelCreateResult> | undefined

/** 建设置/插件页面板的结果（口径同设置面板 #233：失败要写得出失败在哪一步）。 */
type PluginsPanelCreateResult = { ok: true } | { ok: false; step: string }

/** 取这次请求该用的插件页面板：死面板一律当没有（口径同设置面板）。 */
function pickPluginsPanel(): vscode.WebviewPanel | undefined {
  const panel = activePlugins?.panel
  if (panel === undefined) return undefined
  if (disposedPluginsPanels.has(panel)) {
    clearPluginsRefs(panel)
    releasePluginsPanelResources(panel)
    pluginsDeps?.logger.warn('plugins open: panel is already gone')
    return undefined
  }
  return panel
}

/** 清掉指向这个面板的引用（插件页只有单例这一格）。 */
function clearPluginsRefs(panel: vscode.WebviewPanel): void {
  if (activePlugins?.panel === panel) activePlugins = undefined
}

/** 释放这个插件页面板占的资源（只生效一次）：dispose 与「发现已死」两条路共用。 */
function releasePluginsPanelResources(panel: vscode.WebviewPanel): void {
  const release = pluginsRelease.get(panel)
  if (release === undefined) return
  pluginsRelease.delete(panel)
  release()
}

/** 插件页面板的日志句柄（同设置面板：`revealAssembledPlugins` 导出给 extension.ts 调）。 */
let pluginsDeps: { logger: Logger } | undefined

/**
 * 「插件页现在开着没有」的回灌（见本节文件头第 1 条）：侧栏那一行的选中态读的
 * 就是这份事实。广播对象是所有装配 webview（`assemblyWebviews`，主题广播同一份
 * 名单），`postMessage` 的拒绝吞掉——名单里可能有刚 dispose 的页面（#223 同因）。
 */
function broadcastPluginsPage(): void {
  const message = pluginsPageMessage(activePlugins !== undefined)
  for (const target of assemblyWebviews) void target.postMessage(message).then(undefined, () => undefined)
}

/**
 * 已开则聚焦并返回 true：侧栏那一行（经宿主能力口 `openPlugins`）与命令面板共用
 * （`extension.ts` 那条 `if (!revealAssembledPlugins()) 走命令`），避免重复装配。
 *
 * 死面板当没有（口径同设置面板 #233）：那一行是不等着调用的（`hostBridge` 里
 * `deps.openPlugins()` 后面没有 await），抛出去就是一个没人接的 rejection = 用户侧
 * 「点了没反应」。
 */
export function revealAssembledPlugins(): boolean {
  const panel = pickPluginsPanel()
  if (panel === undefined) return false
  try {
    panel.reveal()
    return true
  } catch (err) {
    if (!isDeadWebviewError(err)) throw err
    disposedPluginsPanels.add(panel)
    clearPluginsRefs(panel)
    releasePluginsPanelResources(panel)
    pluginsDeps?.logger.warn(`plugins open: panel is already gone: ${errorText(err)}`)
    return false
  }
}

/** 注册插件页命令（#247）：dshOne.assembledPlugins。 */
export function registerAssembledPlugins(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): vscode.Disposable {
  pluginsDeps = { logger }
  return vscode.commands.registerCommand('dshOne.assembledPlugins', async () => {
    await openPluginsPanel(context, manager, logger)
  })
}

/** 在途创建就等它建完（口径同 chat / 设置面板）：连点两次只建一个面板，不增生。 */
async function openPluginsPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<PluginsPanelCreateResult> {
  const inFlight = creatingPluginsPanel
  if (inFlight !== undefined) return await inFlight
  const creating = createPluginsPanel(context, manager, logger)
  creatingPluginsPanel = creating
  try {
    return await creating
  } finally {
    creatingPluginsPanel = undefined
  }
}

/** 真正的建插件页面板流程（由 openPluginsPanel 串行化调用）：单例语义，任何创建都顶替旧单例。 */
async function createPluginsPanel(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): Promise<PluginsPanelCreateResult> {
  const status = await manager.ensureStarted()
  if (status.state !== 'running' || !status.url) {
    void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
    return { ok: false, step: 'service' }
  }
  let assembly: GatewayAssembly
  try {
    assembly = await loadGatewayAssembly(context, status.url, PLUGINS_TREE, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to load the UI manifest from the dsh gateway: {0}', errorText(err)),
    )
    return { ok: false, step: 'manifest' }
  }
  let mirror: AssemblyMirror
  try {
    mirror = await acquireSharedMirror(context, manager, logger)
  } catch (err) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Failed to start the local UI proxy: {0}', errorText(err)))
    return { ok: false, step: 'mirror' }
  }
  // 单例语义：任何创建都顶替旧单例（取面板走 pickPluginsPanel——引用指着死面板时它
  // 当场把坏引用清掉、把那份 mirror 引用还掉，下面这一跳就不会漏下旧面板的资源）。
  const replaced = pickPluginsPanel()
  if (replaced !== undefined) {
    logger.info('plugins panel replaced')
    replacing = true
    try {
      replaced.dispose()
    } finally {
      replacing = false
    }
  }
  let created: vscode.WebviewPanel | undefined
  try {
    const panel = vscode.window.createWebviewPanel(
      'dshOne.assembledPlugins',
      panelTabTitle(vscode.l10n.t('Plugins')),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    created = panel
    panel.iconPath = panelTabIconPath(context.extensionUri)
    activePlugins = { panel, mirror }
    pluginsRelease.set(panel, () => releaseSharedMirror(mirror))
    logger.info(`assembled plugins: ${mirror.origin}`)
    logger.info('plugins panel created')
    const probeSub = subscribeAssemblyProbe(panel.webview, logger)
    const hostSub = subscribeHostCalls(panel.webview, logger, hostBridgeDeps(manager, logger, () => mirror.origin))
    trackAssemblyWebview(context, panel.webview)
    panel.onDidDispose(() => {
      disposedPluginsPanels.add(panel)
      logger.info(`plugins panel disposed: reason=${replacing ? 'replace' : 'other'}`)
      try {
        probeSub.dispose()
        hostSub.dispose()
        untrackAssemblyWebview(panel.webview)
      } finally {
        clearPluginsRefs(panel)
        releasePluginsPanelResources(panel)
      }
      // 那一页没了：侧栏行的选中态跟着回落（见本节文件头第 1 条）。
      broadcastPluginsPage()
    })
    panel.webview.html = assemblyPageHtml({
      mirrorOrigin: mirror.origin,
      cspNonce: crypto.randomBytes(16).toString('base64'),
      assets: assembly.assets,
      bootWire: assembly.wire,
      bootstrapUrl: bootstrapUrlOf(assembly.wire),
      theme: currentTheme(),
      banner: versionBanner(dshVersion(status.url) ?? status.version),
      localPluginIds: localPluginIdsOf(PLUGINS_TREE),
    })
    // 建好了：侧栏那一行的选中态点亮（此刻起这一页真的开着）。
    broadcastPluginsPage()
  } catch (err) {
    // 建面板 / 装页中途失败：撤掉刚登记的引用与那份 mirror 引用，再给用户一行可见反馈
    // （命令这条路不许静默——它被侧栏那一行不等着调用，抛出去就是一个没人接的 rejection）。
    discardFailedPluginsPanel(created, mirror)
    void vscode.window.showErrorMessage(vscode.l10n.t('Failed to open the plugins panel: {0}', errorText(err)))
    return { ok: false, step: `create:${errorText(err)}` }
  }
  return { ok: true }
}

/** 建插件页面板中途失败时的收尾（口径同设置面板的 discardFailedSettingsPanel）。 */
function discardFailedPluginsPanel(panel: vscode.WebviewPanel | undefined, mirror: AssemblyMirror): void {
  if (panel === undefined) {
    releaseSharedMirror(mirror)
    return
  }
  disposedPluginsPanels.add(panel)
  clearPluginsRefs(panel)
  releasePluginsPanelResources(panel)
}
