import * as vscode from 'vscode'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { archiveSession, createSession, renameSession } from './server/dshRpc.ts'
import { DshViewProvider, openInTab } from './ui/webview.ts'
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

  const provider = new DshViewProvider(manager)
  const statusBar = new StatusBar(manager)
  const sessions = new SessionTreeProvider(manager, logger)

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    sessions,
    vscode.window.registerWebviewViewProvider('dshOne.sidebar', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider('dshOne.sessions', sessions),
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      return vscode.commands.executeCommand('dshOne.sidebar.focus')
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
    // Session click: only focuses the sidebar — the embedded dsh web UI has
    // no deep link to switch sessions remotely (see ui/sessionTree.ts).
    vscode.commands.registerCommand('dshOne.session.open', () => {
      return vscode.commands.executeCommand('dshOne.sidebar.focus')
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (node?: WorkspaceNode) => {
      const url = sessions.runningUrl
      if (!url) return
      const workspaceId = node?.model.workspaceId ?? sessions.defaultWorkspaceId()
      if (!workspaceId) {
        vscode.window.showWarningMessage('没有可用的 workspace，请先在 VSCode 中打开文件夹。')
        return
      }
      try {
        await createSession(url, workspaceId)
      } catch (err) {
        vscode.window.showErrorMessage(`新建会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
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
