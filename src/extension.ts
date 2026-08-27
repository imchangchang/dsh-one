import * as vscode from 'vscode'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { WorkspaceBridge } from './server/workspaceBridge.ts'
import { DshViewProvider, openInTab } from './ui/webview.ts'
import { StatusBar } from './ui/statusbar.ts'

let server: ServerManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  const manager = new ServerManager(context, logger)
  server = manager

  const provider = new DshViewProvider(manager)
  const statusBar = new StatusBar(manager)

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    new WorkspaceBridge(manager, logger),
    vscode.window.registerWebviewViewProvider('dshOne.sidebar', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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
  )
}

export function deactivate(): void {
  // Must be synchronous: VSCode does not await async cleanup on shutdown.
  server?.killSync()
}
