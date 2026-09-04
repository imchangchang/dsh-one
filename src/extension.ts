import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { browserUrl } from './server/serverAuth.ts'
import { loadModelWindowCache, setModelWindowCachePersist } from './server/chatSession.ts'
import { archiveSession, createSession, ensureWorkspace, forkSession, renameSession } from './server/dshRpc.ts'
import { isChatPanelTabArg } from './pure/contextResource.ts'
import { formatSessionMention } from './pure/sessionMention.ts'
import { DSH_TAB_VIEW_TYPE, openInTab, restoreDshWebTab } from './ui/webview.ts'
import { ChatViewProvider } from './ui/chatView.ts'
import { CHAT_PANEL_VIEW_TYPE } from './ui/chatTab.ts'
import { SessionsStore } from './ui/sessionsStore.ts'
import { SessionsViewProvider } from './ui/sessionsView.ts'
import { StatusBar } from './ui/statusbar.ts'

/** Official dsh product page with the "Get started" install instructions. */
const DSH_INSTALL_URL = 'https://www.deepseek.com/harness/'

/** globalState key for the learned provider/model → contextWindow map (见 chatSession.ts）。 */
const MODEL_WINDOW_CACHE_KEY = 'chat.modelWindowCache'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 会话动作命令的参数解析（侧栏菜单与编辑器 tab 右键共用）。侧栏直接传
 * sessionId 字符串；编辑器 tab 右键（editor/title/context）传的是被右键 tab
 * 的资源 URI，其中只有编辑器内部 id，API 层无法反查会话（见
 * contextResource.isChatPanelTabArg）——只能回退到当前活动 chat tab（右键的
 * 通常就是活动 tab；这是已知限制）。
 */
function resolveSessionArg(arg: unknown, chatView: ChatViewProvider): string | undefined {
  if (typeof arg === 'string' && arg) return arg
  if (isChatPanelTabArg(arg)) return chatView.currentSessionId ?? undefined
  return undefined
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  // 模型→窗口学习映射跨进程持久化：不持久化则扩展重启后映射为空，切回此前
  // 用过的模型也进「窗口未知」占位。加载必须在任何会话 controller 附着之前。
  loadModelWindowCache(context.globalState.get(MODEL_WINDOW_CACHE_KEY))
  setModelWindowCachePersist((record) => {
    void context.globalState.update(MODEL_WINDOW_CACHE_KEY, record)
  })

  const manager = new ServerManager(context, logger)

  // Auto-start (or adopt) the dsh web service on activation, so opening the
  // chat/session views never begins with a manual click.
  if (vscode.workspace.getConfiguration('dshOne').get<boolean>('autoStart', true)) {
    void manager.ensureStarted()
  }

  const statusBar = new StatusBar(manager)
  // 分组与回收站状态走 globalState（跨窗口/重启共享；回收站 v2 迁移至此），
  // 与 workspaceState 偏好键（排序/折叠/置顶/未读）分区。
  const sessions = new SessionsStore(manager, logger, context.workspaceState, context.globalState)
  const chatView = new ChatViewProvider(manager, logger, context.extensionUri, sessions, context.workspaceState, () =>
    void sessions.refresh(),
  )

  // 侧栏 sessions 面板（webview view）：只渲染会话列表，高亮读 chatView 的
  // activeSessionId（附着的、或懒加载待附着目标），附着变化时重推快照。
  const sessionsView = new SessionsViewProvider(
    manager,
    logger,
    context.extensionUri,
    sessions,
    () => chatView.activeSessionId,
    () => chatView.attachedSessionId,
    chatView.onActiveSessionChanged,
  )

  // Chat/session reconciliation after every store rebuild: close the tab of
  // any opened session that vanished host-side (archived/deleted elsewhere).
  // 服务重启后的活动会话恢复在 chatView 内部做（store 基线刷新确认后自动
  // 重新打开最近活动的会话 tab，只恢复活动的）。
  const reconcileChat = sessions.onDidChange(() => {
    const url = sessions.runningUrl
    if (!url) return
    for (const sessionId of chatView.openSessionIds()) {
      if (!sessions.hasSession(sessionId)) chatView.closeSession(sessionId)
    }
  })

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    sessions,
    chatView,
    sessionsView,
    reconcileChat,
    // 窗口失焦期间侧栏可能被覆盖，回到聚焦时列表可能过期——刷新一次（失焦不刷）。
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) void sessions.refreshSoon()
    }),
    vscode.window.registerWebviewViewProvider('dshOne.chat', sessionsView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // 窗口 reload 恢复打开的 tab：chat 面板按面板 state 里的 tabId 查
    // workspaceState 映射重建会话 tab；dsh web 面板重新 bind（内容随状态刷新）。
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state) => chatView.restoreChatPanel(panel, state),
    }),
    vscode.window.registerWebviewPanelSerializer(DSH_TAB_VIEW_TYPE, {
      deserializeWebviewPanel: (panel) => restoreDshWebTab(panel, manager),
    }),
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      chatView.openPanel()
    }),
    // Status bar "Retry Starting / Start Service": start (or retry) the
    // service only, without opening the system browser. Opening the browser
    // stays reserved for "Open in Browser" and the status bar click
    // (dshOne.openExternal).
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
    vscode.commands.registerCommand('dshOne.openInTab', () => {
      openInTab(manager)
    }),
    vscode.commands.registerCommand('dshOne.restart', async () => {
      await manager.restart()
    }),
    vscode.commands.registerCommand('dshOne.stop', async () => {
      await manager.stop()
    }),
    vscode.commands.registerCommand('dshOne.showLogs', () => {
      logger.show()
    }),
    vscode.commands.registerCommand('dshOne.sessions.refresh', async () => {
      await sessions.refresh()
    }),
    // Click a session in the sidebar panel: open in the current chat tab by
    // default (reused by the sessions webview via the command).
    vscode.commands.registerCommand('dshOne.session.open', (sessionId?: string) => {
      if (typeof sessionId === 'string') chatView.openSession(sessionId)
    }),
    // 侧栏菜单「在新 tab 中打开」：显式新开一个会话 tab。
    vscode.commands.registerCommand('dshOne.session.openInNewTab', (sessionId?: string) => {
      if (typeof sessionId === 'string') chatView.openSessionInNewTab(sessionId)
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (workspaceId?: string) => {
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
      await sessions.refresh()
      chatView.openSession(sessionId)
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
      chatView.openSession(createdId)
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (arg?: unknown, currentTitle?: string) => {
      const url = sessions.runningUrl
      const sessionId = resolveSessionArg(arg, chatView)
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
      const sessionId = resolveSessionArg(arg, chatView)
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
      // Archiving an opened chat session closes its tab (per-session).
      chatView.closeSession(sessionId)
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
        for (const sessionId of succeeded) chatView.closeSession(sessionId)
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
      const sessionId = resolveSessionArg(arg, chatView)
      if (!url || !sessionId) return
      let newSessionId: string
      try {
        newSessionId = await forkSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to fork session: {0}', errorText(err)))
        return
      }
      await sessions.refresh()
      // fork 后的子会话在新 tab 打开（用户决策：fork 后新开 tab，原 tab 保留）。
      chatView.openSessionInNewTab(newSessionId)
    }),
    // 复制会话引用 mention（侧栏菜单与 chat 头部 ⋯ 菜单、编辑器 tab 右键共用）。
    vscode.commands.registerCommand('dshOne.session.copyReference', async (arg?: unknown, currentTitle?: string) => {
      const sessionId = resolveSessionArg(arg, chatView)
      if (!sessionId) return
      const label =
        typeof currentTitle === 'string' && currentTitle
          ? currentTitle
          : chatView.activeSessionTitle ?? vscode.l10n.t('Session {0}', sessionId.slice(0, 8))
      await vscode.env.clipboard.writeText(formatSessionMention(label, sessionId))
      void vscode.window.showInformationMessage(vscode.l10n.t('Session reference copied. Paste it into the input box to mention this session'))
    }),
    // Editor/explorer 右键「发送到当前会话」：把当前文件作为附件暂存到当前
    // 活跃会话的 composer（等同点「添加附件」）。
    vscode.commands.registerCommand('dshOne.session.attachFile', (arg?: unknown) => {
      void chatView.attachFileToSession(arg)
    }),
    vscode.commands.registerCommand('dshOne.workspace.openFolder', async (path?: string) => {
      if (typeof path !== 'string' || !path) return
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
        forceNewWindow: false,
      })
    }),
    vscode.commands.registerCommand('dshOne.workspace.openTerminal', (path?: string) => {
      if (typeof path !== 'string' || !path) return
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
      vscode.window.createTerminal({ name, cwd: path }).show()
    }),
    vscode.commands.registerCommand('dshOne.openInstallPage', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DSH_INSTALL_URL))
    }),
    // 未安装 dsh 时状态栏/「Install dsh」链接的落点：聚焦侧栏面板，那里是带
    // 非官方一键脚本的安装引导空态（dshNotFound）；官方网址在面板空态里还有
    // 「View install guide」入口。
    vscode.commands.registerCommand('dshOne.openSessions', async () => {
      await vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    // Title-area "+": register a picked folder as a new dsh workspace.
    // Returns the registered workspace (or undefined when cancelled/failed) so
    // the chat hero picker's「添加已有文件夹…」can switch to it afterwards;
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
    // Same return contract as dshOne.workspace.add (used by the hero picker).
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
}
