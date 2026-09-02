import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { archiveSession, createSession, ensureWorkspace, forkSession, renameSession } from './server/dshRpc.ts'
import { openInTab } from './ui/webview.ts'
import { ChatViewProvider } from './ui/chatView.ts'
import { SessionsStore } from './ui/sessionsStore.ts'
import { SessionsViewProvider } from './ui/sessionsView.ts'
import { StatusBar } from './ui/statusbar.ts'

/** Official dsh product page with the "Get started" install instructions. */
const DSH_INSTALL_URL = 'https://www.deepseek.com/harness/'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  const manager = new ServerManager(context, logger)

  // Auto-start (or adopt) the dsh web service on activation, so opening the
  // chat/session views never begins with a manual click.
  if (vscode.workspace.getConfiguration('dshOne').get<boolean>('autoStart', true)) {
    void manager.ensureStarted()
  }

  const statusBar = new StatusBar(manager)
  const sessions = new SessionsStore(manager, logger, context.workspaceState)
  const chatView = new ChatViewProvider(manager, logger, context.extensionUri, sessions, () => void sessions.refresh())

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
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      chatView.openPanel()
    }),
    // Status bar click: open the dsh web UI in the system browser (starting
    // the service first when needed).
    vscode.commands.registerCommand('dshOne.openExternal', async () => {
      const status = await manager.ensureStarted()
      if (status.url) await vscode.env.openExternal(vscode.Uri.parse(status.url))
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
        vscode.window.showWarningMessage(vscode.l10n.t('没有可用的 workspace，请先在 VSCode 中打开文件夹。'))
        return
      }
      let sessionId: string
      try {
        sessionId = await createSession(url, { workspaceId: targetWorkspaceId })
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('新建会话失败：{0}', errorText(err)))
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
        vscode.window.showErrorMessage(vscode.l10n.t('新建未分组会话失败：{0}', errorText(err)))
        return
      }
      await sessions.refresh()
      chatView.openSession(createdId)
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (sessionId?: string, currentTitle?: string) => {
      const url = sessions.runningUrl
      if (!url || typeof sessionId !== 'string') return
      const title = await vscode.window.showInputBox({
        title: vscode.l10n.t('重命名会话'),
        prompt: vscode.l10n.t('输入新的会话标题'),
        value: typeof currentTitle === 'string' ? currentTitle : '',
      })
      if (title === undefined) return
      try {
        await renameSession(url, sessionId, title)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('重命名会话失败：{0}', errorText(err)))
        return
      }
      await sessions.refresh()
    }),
    vscode.commands.registerCommand('dshOne.session.archive', async (sessionId?: string, currentTitle?: string) => {
      const url = sessions.runningUrl
      if (!url || typeof sessionId !== 'string') return
      const label = typeof currentTitle === 'string' ? currentTitle : sessionId
      const archive = vscode.l10n.t('归档')
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('确认归档会话「{0}」？归档后会从列表中隐藏。', label),
        { modal: true },
        archive,
      )
      if (pick !== archive) return
      try {
        await archiveSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('归档会话失败：{0}', errorText(err)))
        return
      }
      await sessions.refresh()
      // Archiving an opened chat session closes its tab (per-session).
      chatView.closeSession(sessionId)
    }),
    vscode.commands.registerCommand('dshOne.session.fork', async (sessionId?: string) => {
      const url = sessions.runningUrl
      if (!url || typeof sessionId !== 'string') return
      let newSessionId: string
      try {
        newSessionId = await forkSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('分支会话失败：{0}', errorText(err)))
        return
      }
      await sessions.refresh()
      // fork 后的子会话在新 tab 打开（用户决策：fork 后新开 tab，原 tab 保留）。
      chatView.openSessionInNewTab(newSessionId)
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
        openLabel: vscode.l10n.t('添加为 workspace'),
        title: vscode.l10n.t('新建 workspace：选择文件夹'),
      })
      const path = picked?.[0]?.fsPath
      if (!path) return undefined
      try {
        const workspace = await ensureWorkspace(url, path)
        await sessions.refresh()
        return workspace
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('新建 workspace 失败：{0}', errorText(err)))
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
        vscode.window.showErrorMessage(vscode.l10n.t('未找到 dsh 全局目录 ~/.dsh，请先安装并运行一次 dsh 再创建工作区。'))
        return undefined
      }
      const workspacesDir = path.join(dshHome, 'workspaces')
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('创建工作区'),
        prompt: vscode.l10n.t('将在 ~/.dsh/workspaces/ 下创建同名目录，并注册为 dsh workspace。'),
        placeHolder: vscode.l10n.t('工作区名称'),
        validateInput: async (value) => {
          const trimmed = value.trim()
          if (!trimmed) return vscode.l10n.t('名称不能为空')
          if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
            return vscode.l10n.t('名称不能包含路径分隔符')
          }
          try {
            await fs.access(path.join(workspacesDir, trimmed))
            return vscode.l10n.t('该名称的工作区已存在')
          } catch {
            return null
          }
        },
      })
      if (!name) return undefined
      const dir = path.join(workspacesDir, name.trim())
      try {
        const workspace = await ensureWorkspace(url, dir)
        await sessions.refresh()
        return workspace
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('创建工作区失败：{0}', errorText(err)))
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
