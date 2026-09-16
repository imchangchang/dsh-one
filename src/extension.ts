import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { browserUrl } from './server/serverAuth.ts'
import { archiveSession, createSession, ensureWorkspace, forkSession, renameSession } from './server/dshRpc.ts'
import { formatSessionMention } from './pure/sessionMention.ts'
import {
  hasAssembledChatPanel,
  preheatAssembly,
  registerAssembledChat,
  registerAssembledSettings,
  registerAssembledSidebar,
  revealAssembledChat,
  revealAssembledSettings,
  wasAssembledChatClosedByUser,
} from './ui/assemblyView.ts'
import { SessionsStore } from './ui/sessionsStore.ts'
import { StatusBar } from './ui/statusbar.ts'
import { openInstallGuide } from './ui/installGuide.ts'
import { DshUpdate } from './server/dshUpdate.ts'
import { locateDsh, type LocatedDsh } from './server/locateDsh.ts'
import { decideUpdate } from './pure/dshUpdate.ts'
import { statusActions, statusSummary } from './pure/statusActions.ts'
import { TagBridge } from './server/tagBridge.ts'

/**
 * workspaceState key：装配对话区是否已完成过一次自动打开（见 autoOpenAssembledChat）。
 *
 * **shell 关注点，非插件状态**（#82 铁律的第三类）：这条记的是「本窗口已经把面板
 * 自动打开过一次」这件事，属于面板生命周期，没有跨端语义（官方 web 没有面板、
 * 也没有「自动打开」这回事）。插件自己的用户状态一律不在这里——见
 * `src/pure/treeGroups.ts` 与 `src/ui/assembly/shell/hostCapabilities.ts`。
 */
const ASSEMBLY_AUTO_OPENED_KEY = 'dshOne.assemblyAutoOpened'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 会话动作命令的参数解析（侧栏菜单传 sessionId 字符串）。旧聊天 tab 的
 * 编辑器右键入口已随旧聊天区下线，这里不再解析 tab 资源参数。
 */
function resolveSessionArg(arg: unknown): string | undefined {
  return typeof arg === 'string' && arg ? arg : undefined
}

/**
 * activate 建的 logger（`deactivate` 要用它写「宿主收摊」那条告别日志，#169）。
 */
let hostLogger: Logger | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 日志同时落一份文件（#169）：面板恢复这类宿主行为事后只能靠日志自证，而 VS
  // Code 输出面板的落点不在我们手里（自己的日志目录、会被清理）。位置固定在扩展
  // globalStorage 下，路径写进首行与 docs/development.md。
  const logger = new Logger({ logFileDir: vscode.Uri.joinPath(context.globalStorageUri, 'logs').fsPath })
  const mode = context.extensionMode === vscode.ExtensionMode.Development ? 'dev' : 'stable'
  logger.info(
    `dsh-one activating (platform=${process.platform}/${process.arch}, pid=${process.pid}, vscode=${vscode.version}, mode=${mode})`,
  )
  if (logger.filePath !== undefined) logger.info(`log file: ${logger.filePath}`)
  hostLogger = logger

  const manager = new ServerManager(context, logger)

  // Auto-start (or adopt) the dsh web service on activation, so opening the
  // chat/session views never begins with a manual click.
  if (vscode.workspace.getConfiguration('dshOne').get<boolean>('autoStart', true)) {
    void manager.ensureStarted()
  }

  const dshUpdate = new DshUpdate(logger)
  const statusBar = new StatusBar(manager, dshUpdate)

  // #86 更新检查：这里做一次静默检查（查到才影响 tooltip 里那行提示；失败只进日志，
  // 不打扰用户）。只在拿到真实 dsh 版本之后查一次——版本未知时比不出结果，
  // 「检查更新」命令随时可以再手动触发。
  let updateChecked = false
  const tryUpdateCheck = (): void => {
    if (updateChecked) return
    const status = manager.getStatus()
    if (status.state !== 'running' || !status.version || status.version === 'unknown') return
    updateChecked = true
    void dshUpdate.check()
  }
  context.subscriptions.push(manager.onDidChangeState(tryUpdateCheck))
  tryUpdateCheck()

  // #71 预热：激活后网关一旦 running，后台暖共享代理 + 三树过滤整包缓存
  // （静默，失败不挡激活）。首个侧栏揭面/首个 tab 不再付 mirror 启动与
  // 网关往返的冷启动成本。
  let preheated = false
  const tryPreheat = (): void => {
    if (preheated || manager.getStatus().state !== 'running') return
    preheated = true
    void preheatAssembly(context, manager, logger)
  }
  context.subscriptions.push(manager.onDidChangeState(tryPreheat))
  tryPreheat()
  // 五组客户端状态（回收站/分组/标签组/置顶/未读）落在 ~/.dsh/dsh-one/ 文件
  // （跨窗口/重启共享，create 里完成旧 Memento 一次性迁移并接管文件监视）；
  // 排序/折叠等 UI 偏好仍走 Memento。
  const sessions = await SessionsStore.create(manager, logger, context.workspaceState, context.globalState)
  // loopback tag-bridge（#18）：起 127.0.0.1 随机端口 + 每进程 token，写
  // ~/.dsh/dsh-one/bridge.json，给派生脚本 --tag 代写 tags.json（规避 agent
  // 进程直写工作区外文件的沙箱拦截）。失败（少数坏环境）只降级——--tag 不可用，
  // 脚本会报「扩展未加载」指路，不影响其余扩展功能。
  const tagBridge = new TagBridge({
    handle: async (req) => {
      if (req.action === 'assign') {
        // 归组：按组名找/建（assignTagGroup）或按 tagId 必须存在（assignByTagId）。
        return req.group !== undefined
          ? sessions.assignTagGroup(req.group, req.sessionIds)
          : sessions.assignByTagId(req.sessionIds, req.tagId!)
      }
      if (req.action === 'get') return { ok: true, group: sessions.sessionTagOf(req.sessionId) ?? null }
      return { ok: true, sessionCount: sessions.unassignSessions(req.sessionIds) }
    },
    logger,
  })
  await tagBridge.start().catch((err) => logger.warn(`tag-bridge start failed (--tag unavailable): ${errorText(err)}`))

  // 「最近打开的会话」：旧聊天 tab 下线后，侧栏高亮/行内改名的附着语义由它
  // 承接——从扩展侧打开会话（侧栏点击/新建/fork）即记为最近打开。装配页内部
  // 切会话不经过扩展，高亮以最后一次从扩展侧打开的会话为准。
  let lastOpenedSessionId: string | null = null
  const activeSessionChanged = new vscode.EventEmitter<string | null>()
  const setLastOpenedSession = (id: string | null): void => {
    if (lastOpenedSessionId === id) return
    lastOpenedSessionId = id
    activeSessionChanged.fire(id)
  }

  // 打开/聚焦装配对话区：已开则聚焦（不重复装配），未开走命令全量打开
  // （ensureStarted + 清单装配 + 起 mirror）。侧栏点开会话、新建会话、
  // fork 与默认打开都复用这个入口。
  const openAssembledChat = async (): Promise<void> => {
    if (!revealAssembledChat()) await vscode.commands.executeCommand('dshOne.assembledChat')
  }

  // 默认打开装配对话区（#68）：侧栏 view 展示时，若装配面板没开就自动开一次。
  // 「只自动开一次」落在 workspaceState；用户手动关过面板也不再强开（尊重选择）；
  // 服务还没就绪时不落标记，等侧栏下次展示且服务在跑时再开（首次点击可能撞上
  // 服务启动中，不给用户报错弹窗）。
  const autoOpenAssembledChat = async (): Promise<void> => {
    if (context.workspaceState.get<boolean>(ASSEMBLY_AUTO_OPENED_KEY)) return
    if (revealAssembledChat() || wasAssembledChatClosedByUser()) {
      await context.workspaceState.update(ASSEMBLY_AUTO_OPENED_KEY, true)
      return
    }
    if (manager.getStatus().state !== 'running') return
    await vscode.commands.executeCommand('dshOne.assembledChat')
    if (hasAssembledChatPanel()) await context.workspaceState.update(ASSEMBLY_AUTO_OPENED_KEY, true)
  }

  // 打开/聚焦设置面板（#70 设置独立成页）：侧栏齿轮点击与命令面板共用。
  const openAssembledSettings = async (): Promise<void> => {
    if (!revealAssembledSettings()) await vscode.commands.executeCommand('dshOne.assembledSettings')
  }

  // #86 检查更新用的「当前版本」：优先现在能不能定位到 dsh（那才是真实安装位置上的版本），
  // 定位不到就退回状态里已经探到的版本（服务在跑时总是有）。
  const installedDshVersion = async (): Promise<string | undefined> => {
    try {
      const located = await locateDsh(logger)
      return located.version === 'unknown' ? undefined : located.version
    } catch {
      const version = manager.getStatus().version
      return version && version !== 'unknown' ? version : undefined
    }
  }

  // #86 升级要 dsh 的可执行文件路径（用来推导同目录的 npm）；定位不到就没法拼命令，
  // 直接把 locate 的报错（含安装指引）给用户。
  const locateForUpgrade = async (): Promise<LocatedDsh | undefined> => {
    try {
      return await locateDsh(logger)
    } catch (err) {
      void vscode.window.showErrorMessage(errorText(err))
      return undefined
    }
  }

  // 侧栏 sessions 面板（#70）：dshOne.chat view 的内容换成官方侧栏装配
  // （第二棵 cordis 树，assemblyView.ts），自研 vanilla 侧栏（sessionsView/
  // sessionsWebview）摘钩保留——#65 迁移参照物，暂不使用。可见性钩子沿用
  // #68 语义：侧栏 view 展示时自动开一次装配对话区；齿轮点击开设置面板。
  context.subscriptions.push(registerAssembledSidebar(context, manager, logger, {
    onDidBecomeVisible: () => void autoOpenAssembledChat(),
    onOpenSettings: () => void openAssembledSettings(),
  }))

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    dshUpdate,
    sessions,
    tagBridge,
    activeSessionChanged,
    // 窗口失焦期间侧栏可能被覆盖，回到聚焦时列表可能过期——刷新一次（失焦不刷）。
    // 焦点变化本身也记一条（#169）：用户报的「切走窗口再回来面板没了」要从日志里
    // 对得上当时的焦点事件，才分得清是「宿主重启带走了面板」还是「焦点回来触发了
    // 什么把面板替换掉了」。
    vscode.window.onDidChangeWindowState((state) => {
      logger.info(`window focus: ${state.focused ? 'focused' : 'blurred'}`)
      if (state.focused) void sessions.refreshSoon()
    }),
    vscode.commands.registerCommand('dshOne.start', async () => {
      await manager.ensureStarted()
    }),
    // Status bar click: open the dsh web UI in the system browser (starting
    // the service first when needed). 0.1.2 认证：浏览器没有扩展的 cookie，
    // 只能开带 token 的 URL（官方打印 URL 的同一形态）换自己的 cookie。
    // asExternalUri：远程宿主（code-server/VS Code Server）把本机 URL 转成
    // 客户端可访问的代理 URL 且保留 query（code-server 自己的 openExternal
    // 改写会把 ?token= 剥掉导致 401）；本地窗口下发回原 URL，行为不变。
    vscode.commands.registerCommand('dshOne.openExternal', async () => {
      const status = await manager.ensureStarted()
      if (!status.url) return
      const uri = vscode.Uri.parse(browserUrl(status.url))
      const external = await vscode.env.asExternalUri(uri)
      // 日志只记录脱敏后的形态（token 不落日志）。
      const externalUrl = new URL(external.toString())
      externalUrl.searchParams.set('token', '***')
      logger.info(`opening dsh web: ${externalUrl.toString()}`)
      await vscode.env.openExternal(external)
    }),
    // cordis 装配对话区（#64 goal 1，#68 起为唯一对话区）：官方组件装配页 +
    // 自研外壳，命令面板进；点活动栏 DSH One 图标也会自动打开（见
    // autoOpenAssembledChat）。
    registerAssembledChat(context, manager, logger),
    // 装配设置面板（#70 设置独立成页）：官方 settings.* 座位整页渲染。
    registerAssembledSettings(context, manager, logger),
    vscode.commands.registerCommand('dshOne.restart', async () => {
      await manager.restart()
    }),
    vscode.commands.registerCommand('dshOne.stop', async () => {
      await manager.stop()
    }),
    // 外部启动的认证 dsh（防护错误态）：粘贴终端 URL 里的 launch token 连接（B 档）。
    vscode.commands.registerCommand('dshOne.external.pasteToken', async () => {
      const status = manager.getStatus()
      if (status.reason !== 'authDshNoToken') return
      const token = await vscode.window.showInputBox({
        title: vscode.l10n.t('Paste dsh Launch Token'),
        prompt: vscode.l10n.t('Paste the part after ?token= from the URL printed by dsh web in the terminal'),
        placeHolder: 'token=…',
        ignoreFocusOut: true,
      })
      const trimmed = token?.trim()
      if (!trimmed) return
      try {
        const next = await manager.connectExternalToken(trimmed)
        await sessions.refresh()
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Connected to the external dsh instance on port {0}', next.port ?? status.port ?? '?'),
        )
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to connect to the external dsh: {0}', errorText(err)))
      }
    }),
    // 一键复制 URL 模板：http://127.0.0.1:<port>/?token=（用户拿终端打印的 URL 对照补 token）。
    vscode.commands.registerCommand('dshOne.external.copyTokenTemplate', async () => {
      const port = manager.getStatus().port
      if (port === undefined) return
      await vscode.env.clipboard.writeText(`http://127.0.0.1:${port}/?token=`)
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Copied the URL template. Fill in the token from the URL printed by dsh web in the terminal.'),
      )
    }),
    // A 档：停止外部实例——单 pid、杀前身份确认，杀前确认弹窗（外部实例可能正在用户终端看日志）。
    vscode.commands.registerCommand('dshOne.external.stop', async () => {
      const status = manager.getStatus()
      if (status.reason !== 'authDshNoToken' && status.external !== true && status.adopted !== true) return
      const port = status.port ?? '?'
      const confirm = vscode.l10n.t('Stop')
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('Stop the dsh on port {0}? It was started outside this extension (in your terminal or another window).', port),
        { modal: true },
        confirm,
      )
      if (pick !== confirm) return
      try {
        await manager.stopExternal()
        await sessions.refresh()
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to stop the external dsh: {0}', errorText(err)))
      }
    }),
    // A 档重启：停止外部实例 + 扩展 spawn 新实例（新实例归扩展管理，此后免确认）。
    vscode.commands.registerCommand('dshOne.external.restart', async () => {
      const status = manager.getStatus()
      if (status.reason !== 'authDshNoToken' && status.external !== true && status.adopted !== true) return
      const port = status.port ?? '?'
      const confirm = vscode.l10n.t('Restart')
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Stop the external dsh on port {0} and start a new instance managed by this extension? The new instance will be owned by this extension from then on.',
          port,
        ),
        { modal: true },
        confirm,
      )
      if (pick !== confirm) return
      try {
        await manager.restartExternal()
        await sessions.refresh()
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to restart the external dsh: {0}', errorText(err)))
      }
    }),
    vscode.commands.registerCommand('dshOne.showLogs', () => {
      logger.show()
    }),
    // #86 检查更新：固定比 npm 的 latest dist-tag（口径与理由见 src/pure/dshUpdate.ts）。
    // 有新版本时顺带给「升级」按钮；查不到就报检查失败——不冒充「已是最新」。
    vscode.commands.registerCommand('dshOne.checkUpdate', async () => {
      const installed = await installedDshVersion()
      await dshUpdate.check()
      const verdict = decideUpdate(installed, dshUpdate.latest())
      if (verdict.state === 'update') {
        const upgrade = vscode.l10n.t('Upgrade')
        const pick = await vscode.window.showInformationMessage(
          vscode.l10n.t('A newer dsh is available: v{0} (current v{1}).', verdict.latest!, verdict.installed!),
          upgrade,
        )
        if (pick === upgrade) await vscode.commands.executeCommand('dshOne.upgrade')
        return
      }
      if (verdict.state === 'current') {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('dsh is up to date (v{0}).', verdict.latest!),
        )
        return
      }
      if (verdict.state === 'ahead') {
        // alpha/next 用户会落到这里：npm latest 比手上旧，没什么可升的。
        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Installed dsh v{0} is newer than the npm latest v{1}; nothing to upgrade.',
            verdict.installed!,
            verdict.latest!,
          ),
        )
        return
      }
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Update check failed: {0}', dshUpdate.lastError() ?? vscode.l10n.t('unknown reason')),
      )
    }),
    // #86 升级：在集成终端里跑全局安装命令（命令可见、可中断）。装的版本比 latest 新时
    // 先弹确认说明「继续等于降级」，避免 alpha 用户被无声地拉回正式通道。
    vscode.commands.registerCommand('dshOne.upgrade', async () => {
      const dsh = await locateForUpgrade()
      if (!dsh) return
      if (!dshUpdate.latest()) await dshUpdate.check()
      const latest = dshUpdate.latest()
      const verdict = decideUpdate(dsh.version, latest)
      if (verdict.state === 'current') {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('dsh is up to date (v{0}).', latest!),
        )
        return
      }
      if (verdict.state === 'ahead') {
        const proceed = vscode.l10n.t('Continue')
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Installed dsh v{0} is newer than the npm latest v{1}; continuing installs the older version.',
            verdict.installed!,
            latest!,
          ),
          { modal: true },
          proceed,
        )
        if (answer !== proceed) return
      }
      dshUpdate.runUpgradeInTerminal(dsh, latest)
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Installing dsh in the terminal; restart the dsh service when it finishes.'),
      )
    }),
    // #70 摘钩标注：以下会话/工作区命令原为自研侧栏 webview 消息驱动（行内
    // 菜单/右键菜单转发）。侧栏位换成官方侧栏装配后失去调用方，注册保留作
    // #65 迁移参照物（特有功能叠加时由桥/postMessage 重新接线），暂不使用。
    // dshOne.session.new / workspace.add / workspace.create 无参从命令面板
    // 调用仍有效，不在此列。
    vscode.commands.registerCommand('dshOne.sessions.refresh', async () => {
      await sessions.refresh()
    }),
    // Click a session in the sidebar panel: open the assembled chat with it
    // remembered as the last opened session (highlight in the sidebar).
    vscode.commands.registerCommand('dshOne.session.open', (sessionId?: string) => {
      if (typeof sessionId !== 'string') return
      setLastOpenedSession(sessionId)
      void openAssembledChat()
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (workspaceId?: string, tagId?: string) => {
      const url = sessions.runningUrl
      if (!url) return
      const targetWorkspaceId = typeof workspaceId === 'string' ? workspaceId : sessions.defaultWorkspaceId()
      if (!targetWorkspaceId) {
        vscode.window.showWarningMessage(vscode.l10n.t('No workspace available. Open a folder in VSCode first.'))
        return
      }
      let sessionId: string
      try {
        sessionId = await createSession(url, { workspaceId: targetWorkspaceId })
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create session: {0}', errorText(err)))
        return
      }
      // 组头右键「创建对话」：创建后把新会话挂到指定 tag 组。显式传所属
      // workspace（新建会话尚未进基线，workspaceOfSession 反查会落「未分组」），
      // 确保归属写到正确桶；tagId 缺省时保持未分组。
      if (typeof tagId === 'string' && tagId !== '') {
        sessions.setSessionTag(sessionId, tagId, targetWorkspaceId)
      }
      await sessions.refresh()
      setLastOpenedSession(sessionId)
      void openAssembledChat()
    }),
    // 新建「未分组」对话：不挂任何 workspace 的会话。预分配会话 id，临时
    // 目录（os.tmpdir()，跨平台等价于 /tmp）以 日期+会话id 命名作为会话
    // cwd——host 会创建该目录且不注册 workspace，会话在列表归入「未分组」。
    vscode.commands.registerCommand('dshOne.session.newUngrouped', async () => {
      const url = sessions.runningUrl
      if (!url) return
      const sessionId = `session-${randomUUID()}`
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
      const cwd = path.join(os.tmpdir(), `dsh-ungrouped-${stamp}-${sessionId}`)
      let createdId: string
      try {
        createdId = await createSession(url, { cwd, sessionId })
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create ungrouped session: {0}', errorText(err)))
        return
      }
      await sessions.refresh()
      setLastOpenedSession(createdId)
      void openAssembledChat()
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (arg?: unknown, currentTitle?: string) => {
      const url = sessions.runningUrl
      const sessionId = resolveSessionArg(arg)
      if (!url || !sessionId) return
      const title = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rename Session'),
        prompt: vscode.l10n.t('Enter a new session title'),
        value: typeof currentTitle === 'string' ? currentTitle : '',
      })
      if (title === undefined) return
      try {
        await renameSession(url, sessionId, title)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename session: {0}', errorText(err)))
        return
      }
      await sessions.refresh()
    }),
    vscode.commands.registerCommand('dshOne.session.archive', async (arg?: unknown, currentTitle?: string) => {
      const url = sessions.runningUrl
      const sessionId = resolveSessionArg(arg)
      if (!url || !sessionId) return
      // 置顶防线（pinned-not-archivable）：UI 已置灰，这层兜底防命令被绕过。
      if (sessions.snapshot().pinned.includes(sessionId)) {
        vscode.window.showWarningMessage(vscode.l10n.t('Pinned sessions cannot be archived; unpin them first'))
        return
      }
      const label = typeof currentTitle === 'string' && currentTitle ? currentTitle : sessionId
      const archive = vscode.l10n.t('Archive')
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('Archive session "{0}"? It will be hidden from the list after archiving.', label),
        { modal: true },
        archive,
      )
      if (pick !== archive) return
      try {
        await archiveSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to archive session: {0}', errorText(err)))
        return
      }
      await sessions.refresh()
      // 归档即终点：从回收站本地集合移除（会话在回收站里的情形）。
      sessions.clearRecycleBinIds([sessionId])
    }),
    // 批量归档（多选模式）：确认框已在 sessions webview 内展示，这里不再弹
    // 确认，直接循环归档；返回失败 id 列表供面板保留勾选重试。
    vscode.commands.registerCommand('dshOne.session.archiveMany', async (sessionIds?: unknown) => {
      const url = sessions.runningUrl
      const ids = Array.isArray(sessionIds) ? sessionIds.filter((x): x is string => typeof x === 'string' && x !== '') : []
      if (!url || ids.length === 0) return []
      // 置顶防线（pinned-not-archivable）：批量请求里的置顶 id 直接计入 failed，
      // 面板据此保留勾选（checkbox 已置灰，命令层兜底防绕过）。
      const pinned = new Set(sessions.snapshot().pinned)
      const failed: string[] = []
      const succeeded: string[] = []
      for (const sessionId of ids) {
        if (pinned.has(sessionId)) {
          failed.push(sessionId)
          continue
        }
        try {
          await archiveSession(url, sessionId)
          succeeded.push(sessionId)
        } catch {
          failed.push(sessionId)
        }
      }
      if (succeeded.length > 0) {
        await sessions.refresh()
        // 归档即终点：成功项从回收站本地集合移除（清空回收站/单个归档的情形）。
        sessions.clearRecycleBinIds(succeeded)
      }
      if (failed.length > 0) {
        const sample = failed.slice(0, 3).map((id) => id.slice(0, 8)).join(', ')
        vscode.window.showWarningMessage(
          vscode.l10n.t('Failed to archive {0} session(s): {1}', failed.length, sample),
        )
      }
      return failed
    }),
    vscode.commands.registerCommand('dshOne.session.fork', async (arg?: unknown) => {
      const url = sessions.runningUrl
      const sessionId = resolveSessionArg(arg)
      if (!url || !sessionId) return
      let newSessionId: string
      try {
        newSessionId = await forkSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to fork session: {0}', errorText(err)))
        return
      }
      await sessions.refresh()
      // fork 后的子会话成为最近打开并聚焦装配对话区（旧聊天 tab 下线后无
      // 「新 tab」概念，装配面板是唯一对话区）。
      setLastOpenedSession(newSessionId)
      void openAssembledChat()
    }),
    // 复制会话引用 mention（侧栏菜单）。装配对话区接管聊天后，mention 粘贴
    // 落点由官方输入框承接。
    vscode.commands.registerCommand('dshOne.session.copyReference', async (arg?: unknown, currentTitle?: string) => {
      const sessionId = resolveSessionArg(arg)
      if (!sessionId) return
      const label =
        typeof currentTitle === 'string' && currentTitle ? currentTitle : vscode.l10n.t('Session {0}', sessionId.slice(0, 8))
      await vscode.env.clipboard.writeText(formatSessionMention(label, sessionId))
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Session reference copied. Paste it into the input box to mention this session'),
      )
    }),
    // #109：第二个参数 `forceNewWindow` 供侧栏工作区右键的「在新窗口打开文件夹」用
    // （缺省 false = 旧侧栏「在 VS Code 打开」的当前窗口语义，老调用点行为不变）。
    vscode.commands.registerCommand('dshOne.workspace.openFolder', async (path?: string, forceNewWindow?: boolean) => {
      if (typeof path !== 'string' || !path) return
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
        forceNewWindow: forceNewWindow === true,
      })
    }),
    vscode.commands.registerCommand('dshOne.workspace.openTerminal', (path?: string) => {
      if (typeof path !== 'string' || !path) return
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
      vscode.window.createTerminal({ name, cwd: path }).show()
    }),
    // 安装引导：打开我们自己的引导 tab（#100，单例：已开则聚焦）——引导内容
    // （平台下拉 + 一键命令 + 复制）窄侧栏放不下，独立成一个编辑器 tab；官方
    // 安装文档作为 tab 里的一条入口保留。
    vscode.commands.registerCommand('dshOne.openInstallPage', () => openInstallGuide(logger)),
    // #90 状态栏点击 = 打开动作面板：动作清单与悬停气泡同一份表
    // （src/pure/statusActions.ts），这里只负责把它渲染成原生 QuickPick 并转发命令。
    vscode.commands.registerCommand('dshOne.statusPanel', async () => {
      const status = manager.getStatus()
      const verdict = decideUpdate(status.version, dshUpdate.latest())
      const t = (message: string, ...args: Array<string | number | boolean>): string =>
        vscode.l10n.t(message, ...args)
      const actions = statusActions(status, t, verdict)
      const picked = await vscode.window.showQuickPick(
        actions.map((action) => ({ label: `$(${action.icon}) ${action.label}`, action })),
        { title: 'DSH One', placeHolder: statusSummary(status, t, verdict) },
      )
      if (picked) await vscode.commands.executeCommand(picked.action.command)
    }),
    // 未安装 dsh 时状态栏「Install dsh」链接的落点：聚焦侧栏面板，那里是
    // 「未安装」状态页（`reason === 'dshNotFound'`），页面上的「查看安装指南」
    // 再开上面的引导 tab。侧栏本身就是窄条，不在这里直接塞引导内容。    vscode.commands.registerCommand('dshOne.openSessions', async () => {
      await vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    // Title-area "+": register a picked folder as a new dsh workspace.
    // Returns the registered workspace (or undefined when cancelled/failed) so
    // the sessions panel's「添加已有文件夹…」can switch to it afterwards;
    // the sidebar entry ignores the return value.
    vscode.commands.registerCommand('dshOne.workspace.add', async () => {
      const url = sessions.runningUrl
      if (!url) return undefined
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Add as workspace'),
        title: vscode.l10n.t('New Workspace: Select Folder'),
      })
      const path = picked?.[0]?.fsPath
      if (!path) return undefined
      try {
        const workspace = await ensureWorkspace(url, path)
        await sessions.refresh()
        return workspace
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create workspace: {0}', errorText(err)))
        return undefined
      }
    }),
    // Create a brand-new workspace: make a folder under the dsh global
    // directory (~/.dsh/workspaces/<name>) and register it in one step.
    // Same return contract as dshOne.workspace.add (used by the sessions panel).
    vscode.commands.registerCommand('dshOne.workspace.create', async () => {
      const url = sessions.runningUrl
      if (!url) return undefined
      const dshHome = path.join(os.homedir(), '.dsh')
      try {
        await fs.access(dshHome)
      } catch {
        vscode.window.showErrorMessage(vscode.l10n.t('dsh global directory ~/.dsh not found. Install dsh and run it once before creating a workspace.'))
        return undefined
      }
      const workspacesDir = path.join(dshHome, 'workspaces')
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('Create Workspace'),
        prompt: vscode.l10n.t('Creates a folder with the same name under ~/.dsh/workspaces/ and registers it as a dsh workspace.'),
        placeHolder: vscode.l10n.t('Workspace name'),
        validateInput: async (value) => {
          const trimmed = value.trim()
          if (!trimmed) return vscode.l10n.t('Name cannot be empty')
          if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
            return vscode.l10n.t('Name cannot contain path separators')
          }
          try {
            await fs.access(path.join(workspacesDir, trimmed))
            return vscode.l10n.t('A workspace with this name already exists')
          } catch {
            return null
          }
        },
      })
      if (!name) return undefined
      const dir = path.join(workspacesDir, name.trim())
      try {
        // Host-side workspace.create 只能「认领已存在目录」（fs.realpath 校验，
        // 路径不存在直接 ENOENT），所以先建目录再注册。
        await fs.mkdir(dir, { recursive: true })
        const workspace = await ensureWorkspace(url, dir)
        await sessions.refresh()
        return workspace
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create workspace: {0}', errorText(err)))
        return undefined
      }
    }),
  )
}

export function deactivate(): void {
  // dsh 与 VSCode 生命周期解绑：reload/关窗不再终止 dsh（pidfile 记录身份，
  // 下个窗口 re-own；只有 dshOne.stop/restart 会杀）。本地资源由
  // context.subscriptions 自动 dispose，这里无事可做。
  //
  // 只留一条告别日志（#169）：窗口重载 / 扩展宿主退出时 VS Code 不逐个 dispose
  // 面板（用户看到的就是「面板没了」），日志里有这条 + 其后是一份新 pid 的日志
  // 文件 = 面板是被宿主带走的；没有这条 = 得另找原因。写在同步 IO 上，来得及。
  hostLogger?.info('dsh-one deactivating (extension host shutting down)')
}
