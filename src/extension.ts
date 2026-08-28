import * as vscode from 'vscode'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { archiveSession, createSession, ensureWorkspace, renameSession } from './server/dshRpc.ts'
import { openInTab } from './ui/webview.ts'
import { ChatViewProvider } from './ui/chatView.ts'
import { SessionsStore } from './ui/sessionsStore.ts'
import { StatusBar } from './ui/statusbar.ts'

let server: ServerManager | undefined

/** Official dsh product page with the "Get started" install instructions. */
const DSH_INSTALL_URL = 'https://www.deepseek.com/harness/'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  const manager = new ServerManager(context, logger)
  server = manager

  // Auto-start (or adopt) the dsh web service on activation, so opening the
  // chat/session views never begins with a manual click.
  if (vscode.workspace.getConfiguration('dshOne').get<boolean>('autoStart', true)) {
    void manager.ensureStarted()
  }

  const statusBar = new StatusBar(manager)
  const sessions = new SessionsStore(manager, logger, context.workspaceState)
  const chatView = new ChatViewProvider(manager, logger, context.extensionUri, sessions, () => void sessions.refresh())

  // Chat/session reconciliation after every store rebuild: drop the attached
  // session when it vanished host-side (archived/deleted elsewhere), and land
  // on the current workspace's newest session once per server run.
  let autoAttachedUrl: string | null = null
  const reconcileChat = sessions.onDidChange(() => {
    const url = sessions.runningUrl
    if (!url) {
      autoAttachedUrl = null
      return
    }
    const current = chatView.currentSessionId
    if (current && !sessions.hasSession(current)) {
      chatView.setSession(null)
      return
    }
    if (!current && autoAttachedUrl !== url) {
      const latest = sessions.latestCurrentSessionId()
      if (latest) {
        autoAttachedUrl = url
        chatView.setSession(latest)
      }
    }
  })

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    sessions,
    chatView,
    reconcileChat,
    vscode.window.registerWebviewViewProvider('dshOne.chat', chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      return vscode.commands.executeCommand('dshOne.chat.focus')
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
    // Session click in the webview panel: attach the chat to it.
    vscode.commands.registerCommand('dshOne.session.open', (sessionId?: string) => {
      if (typeof sessionId === 'string') chatView.setSession(sessionId)
      return vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (workspaceId?: string) => {
      const url = sessions.runningUrl
      if (!url) return
      const targetWorkspaceId = typeof workspaceId === 'string' ? workspaceId : sessions.defaultWorkspaceId()
      if (!targetWorkspaceId) {
        vscode.window.showWarningMessage('没有可用的 workspace，请先在 VSCode 中打开文件夹。')
        return
      }
      let sessionId: string
      try {
        sessionId = await createSession(url, targetWorkspaceId)
      } catch (err) {
        vscode.window.showErrorMessage(`新建会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      chatView.setSession(sessionId)
      void vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (sessionId?: string, currentTitle?: string) => {
      const url = sessions.runningUrl
      if (!url || typeof sessionId !== 'string') return
      const title = await vscode.window.showInputBox({
        title: '重命名会话',
        prompt: '输入新的会话标题',
        value: typeof currentTitle === 'string' ? currentTitle : '',
      })
      if (title === undefined) return
      try {
        await renameSession(url, sessionId, title)
      } catch (err) {
        vscode.window.showErrorMessage(`重命名会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
    vscode.commands.registerCommand('dshOne.session.archive', async (sessionId?: string, currentTitle?: string) => {
      const url = sessions.runningUrl
      if (!url || typeof sessionId !== 'string') return
      const pick = await vscode.window.showWarningMessage(
        `确认归档会话「${typeof currentTitle === 'string' ? currentTitle : sessionId}」？归档后会从列表中隐藏。`,
        { modal: true },
        '归档',
      )
      if (pick !== '归档') return
      try {
        await archiveSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(`归档会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      // Archiving the attached chat session drops the chat back to empty.
      if (chatView.currentSessionId === sessionId) chatView.setSession(null)
    }),
    vscode.commands.registerCommand('dshOne.workspace.openFolder', async (path?: string) => {
      if (typeof path !== 'string' || !path) return
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
        forceNewWindow: false,
      })
    }),
    vscode.commands.registerCommand('dshOne.openInstallPage', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DSH_INSTALL_URL))
    }),
    // Title-area "+": register a picked folder as a new dsh workspace.
    vscode.commands.registerCommand('dshOne.workspace.add', async () => {
      const url = sessions.runningUrl
      if (!url) return
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '添加为 workspace',
        title: '新建 workspace：选择文件夹',
      })
      const path = picked?.[0]?.fsPath
      if (!path) return
      try {
        await ensureWorkspace(url, path)
      } catch (err) {
        vscode.window.showErrorMessage(`新建 workspace 失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
  )
}

export function deactivate(): void {
  // Must be synchronous: VSCode does not await async cleanup on shutdown.
  server?.killSync()
}
