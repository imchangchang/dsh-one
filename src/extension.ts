import * as vscode from 'vscode'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { archiveSession, createSession, renameSession } from './server/dshRpc.ts'
import { openInTab } from './ui/webview.ts'
import { ChatViewProvider } from './ui/chatView.ts'
import { SessionNode, SessionTreeProvider, WorkspaceNode } from './ui/sessionTree.ts'
import { StatusBar } from './ui/statusbar.ts'

let server: ServerManager | undefined

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  const manager = new ServerManager(context, logger)
  server = manager

  const statusBar = new StatusBar(manager)
  const sessions = new SessionTreeProvider(manager, logger)
  const chatView = new ChatViewProvider(manager, logger, context.extensionUri, () => void sessions.refresh())

  // Chat/session reconciliation after every tree rebuild: drop the attached
  // session when it vanished host-side (archived/deleted elsewhere), and land
  // on the current workspace's newest session once per server run.
  let autoAttachedUrl: string | null = null
  const reconcileChat = sessions.onDidChangeTreeData(() => {
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
    vscode.window.registerTreeDataProvider('dshOne.sessions', sessions),
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      return vscode.commands.executeCommand('dshOne.sessions.focus')
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
    // Session click: attach the native chat view and focus it.
    vscode.commands.registerCommand('dshOne.session.open', (node?: SessionNode) => {
      if (node) chatView.setSession(node.model.sessionId)
      return vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (node?: WorkspaceNode) => {
      const url = sessions.runningUrl
      if (!url) return
      const workspaceId = node?.model.workspaceId ?? sessions.defaultWorkspaceId()
      if (!workspaceId) {
        vscode.window.showWarningMessage('没有可用的 workspace，请先在 VSCode 中打开文件夹。')
        return
      }
      let sessionId: string
      try {
        sessionId = await createSession(url, workspaceId)
      } catch (err) {
        vscode.window.showErrorMessage(`新建会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      chatView.setSession(sessionId)
      void vscode.commands.executeCommand('dshOne.chat.focus')
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (node?: SessionNode) => {
      const url = sessions.runningUrl
      if (!url || !node) return
      const title = await vscode.window.showInputBox({
        title: '重命名会话',
        prompt: '输入新的会话标题',
        value: node.model.label,
      })
      if (title === undefined) return
      try {
        await renameSession(url, node.model.sessionId, title)
      } catch (err) {
        vscode.window.showErrorMessage(`重命名会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
    vscode.commands.registerCommand('dshOne.session.archive', async (node?: SessionNode) => {
      const url = sessions.runningUrl
      if (!url || !node) return
      const pick = await vscode.window.showWarningMessage(
        `确认归档会话「${node.model.label}」？归档后会从列表中隐藏。`,
        { modal: true },
        '归档',
      )
      if (pick !== '归档') return
      try {
        await archiveSession(url, node.model.sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(`归档会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      // Archiving the attached chat session drops the chat back to empty.
      if (chatView.currentSessionId === node.model.sessionId) chatView.setSession(null)
    }),
    vscode.commands.registerCommand('dshOne.workspace.openFolder', async (node?: WorkspaceNode) => {
      if (!node) return
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.model.path), {
        forceNewWindow: false,
      })
    }),
  )
}

export function deactivate(): void {
  // Must be synchronous: VSCode does not await async cleanup on shutdown.
  server?.killSync()
}
