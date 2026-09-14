import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import type { ServerManager } from '../server/manager.ts'
import { sanitize, type Logger } from '../log.ts'
import { startAssemblyMirror, type AssemblyMirror } from '../server/assemblyMirror.ts'
import { cookieHeader, dshVersion } from '../server/serverAuth.ts'
import { parse as parseSemver, compare as compareSemver } from '../pure/semver.ts'
import { assemblyPageHtml } from './assembly/pageHtml.ts'
import {
  CHAT_BLOCK_LIST,
  SIDEBAR_BLOCK_LIST,
  SHELL_PLUGIN_ID,
  SIDEBAR_SHELL_PLUGIN_ID,
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

/** 一棵树 = 一份 block list + 一个自有 frame 插件 id（见 wireFilter.ts）。 */
interface AssemblyTree {
  blockList: ReadonlyArray<BlockedPlugin>
  shellPluginId: string
}

/** chat 树（装配对话区，#64 行为）与 sidebar 树（侧栏位，#70）。 */
const CHAT_TREE: AssemblyTree = { blockList: CHAT_BLOCK_LIST, shellPluginId: SHELL_PLUGIN_ID }
const SIDEBAR_TREE: AssemblyTree = { blockList: SIDEBAR_BLOCK_LIST, shellPluginId: SIDEBAR_SHELL_PLUGIN_ID }

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
  return { wire: filterWire(extractBootWire(html), tree.blockList, tree.shellPluginId), assets: extractFrontendAssets(html) }
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

/** 注册「装配对话区」命令：打开 mirror 伺服的 cordis 装配页 webview 面板。 */
export function registerAssembledChat(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
): vscode.Disposable {
  return vscode.commands.registerCommand('dshOne.assembledChat', async () => {
    const status = await manager.ensureStarted()
    if (status.state !== 'running' || !status.url) {
      void vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not running'))
      return
    }
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
      mirror = await startAssemblyMirror(
        () => manager.getStatus().url,
        logger,
        {
          pluginsDir: path.join(context.extensionUri.fsPath, 'dist', 'assembly', 'plugins'),
          blockList: CHAT_TREE.blockList,
        },
      )
    } catch (err) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to start the assembly mirror: {0}', err instanceof Error ? err.message : String(err)),
      )
      return
    }
    // 后开替换先开：只保留一个装配面板与其 mirror。replace 期间的 dispose 是
    // 我们自己触发的，不算用户手动关闭。
    replacing = true
    try {
      active?.panel.dispose()
    } finally {
      replacing = false
    }
    const panel = vscode.window.createWebviewPanel(
      ASSEMBLED_CHAT_VIEW_TYPE,
      vscode.l10n.t('dsh Chat (assembled)'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    active = { panel, mirror }
    logger.info(`assembled chat: ${mirror.origin}`)
    const probeSub = subscribeAssemblyProbe(panel.webview, logger)
    panel.onDidDispose(() => {
      probeSub.dispose()
      if (active?.panel === panel) active = undefined
      if (!replacing) closedByUser = true
      mirror.dispose()
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
      const vscode = acquireVsCodeApi()
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
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true }
    const probeSub = subscribeAssemblyProbe(view.webview, this.logger)
    const retrySub = view.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'assembly:retry') {
        void this.assemble(view)
      }
    })
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) this.onDidBecomeVisible?.()
    })
    view.onDidDispose(() => {
      probeSub.dispose()
      retrySub.dispose()
      visibilitySub.dispose()
      this.mirror?.dispose()
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
        this.mirror?.dispose()
        this.mirror = await startAssemblyMirror(
          () => this.manager.getStatus().url,
          this.logger,
          {
            pluginsDir: path.join(this.context.extensionUri.fsPath, 'dist', 'assembly', 'plugins'),
            blockList: SIDEBAR_TREE.blockList,
          },
        )
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
    this.mirror?.dispose()
    this.mirror = undefined
  }
}

/** 注册侧栏位装配 provider（#70）：webview view dshOne.chat = 官方侧栏装配。 */
export function registerAssembledSidebar(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  logger: Logger,
  options: { onDidBecomeVisible?: () => void } = {},
): vscode.Disposable {
  const provider = new AssembledSidebarProvider(context, manager, logger, options.onDidBecomeVisible)
  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(ASSEMBLED_SIDEBAR_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
  )
}
