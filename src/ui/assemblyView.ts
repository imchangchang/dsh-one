import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import type { ServerManager } from '../server/manager.ts'
import { sanitize, type Logger } from '../log.ts'
import { startAssemblyMirror, type AssemblyMirror } from '../server/assemblyMirror.ts'
import { cookieHeader, dshVersion } from '../server/serverAuth.ts'
import { parse as parseSemver, compare as compareSemver } from '../pure/semver.ts'
import { assemblyPageHtml } from './assembly/pageHtml.ts'
import { extractBootWire, extractFrontendAssets, filterWire, type BootWire, type GatewayAssets } from './assembly/wireFilter.ts'

/**
 * cordis 装配对话区面板（#64）：命令 dshOne.assembledChat → ensureStarted
 * 后起 assemblyMirror（loopback 反代），webview.html = 装配页
 * （ui/assembly/pageHtml.ts，普通浏览器同页可开，零 acquireVsCodeApi）。
 * 生命周期照官方嵌入面板模式（#60）：单例、后开替换先开、关面板即 dispose mirror。
 * #68 起它是唯一对话区：点侧栏会话/新建/fork 经 revealAssembledChat 聚焦复用，
 * 点活动栏 DSH One 图标经 autoOpen（extension.ts）自动开一次。
 *
 * blocklist 模式：面板打开时（扩展宿主侧，node 无 CORS）用 cookie GET 网关
 * `/` 的注入 HTML，提取官方 __DSH_BOOT__ wire + 前端资产名，按 BLOCK_LIST
 * 过滤（application 批重指 mirror /plugins-local，mirror 拉官方原 combo 剥
 * blocked 段后伺服），追加 @dsh-one/vscode-shell，内联进装配页。
 *
 * 版本门：网关 dsh 版本不在 [0.1.2-rc.1, 0.2.0) 时页面顶部加信息条，不阻断。
 */

export const ASSEMBLED_CHAT_VIEW_TYPE = 'dshOne.assembledChat'

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

/** 用 serverAuth 的 cookie GET 网关 /，提取 wire 并按 BLOCK_LIST 过滤（见 wireFilter.ts）。 */
async function loadGatewayAssembly(gateway: string): Promise<GatewayAssembly> {
  const cookie = cookieHeader(gateway)
  const res = await fetch(`${gateway}/`, {
    headers: cookie !== undefined ? { cookie } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
  const html = await res.text()
  return { wire: filterWire(extractBootWire(html)), assets: extractFrontendAssets(html) }
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
      assembly = await loadGatewayAssembly(status.url)
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
    const theme =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
        ? ('light' as const)
        : ('dark' as const)
    const panel = vscode.window.createWebviewPanel(
      ASSEMBLED_CHAT_VIEW_TYPE,
      vscode.l10n.t('dsh Chat (assembled)'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    active = { panel, mirror }
    logger.info(`assembled chat: ${mirror.origin}`)
    // 装配页诊断探针（仅 webview 激活，见 assembly/probe.ts）回传日志：
    // [assembly] 前缀写入输出面板「DSH One」频道；只认 assembly:log，其余消息
    // 类型忽略。面板关闭即随 dispose 停收。文本过 sanitize 脱敏（URL 掩码）。
    const probeSub = panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return
      const m = msg as { type?: unknown; level?: unknown; text?: unknown }
      if (m.type !== 'assembly:log') return
      const line = `[assembly] ${sanitize(typeof m.text === 'string' ? m.text : String(m.text ?? ''))}`
      if (m.level === 'error') logger.error(line)
      else if (m.level === 'warn') logger.warn(line)
      else logger.info(line)
    })
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
      theme,
      banner: versionBanner(dshVersion(status.url) ?? status.version),
    })
  })
}
