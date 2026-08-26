import * as vscode from 'vscode'
import { Logger } from './log.ts'
import { ensureNode, type NodeRuntime } from './runtime/node.ts'
import { ensureDsh, checkForUpdates, type DshRuntime } from './runtime/dshRuntime.ts'
import { ServerManager } from './server/manager.ts'
import { DshViewProvider, openInTab } from './ui/webview.ts'
import { StatusBar } from './ui/statusbar.ts'

let server: ServerManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  // Runtime resolution is shared and memoized: the server start path and the
  // background update check must not download things twice.
  let runtimePromise: Promise<{ node: NodeRuntime; dsh: DshRuntime }> | null = null
  const resolveAll = (): Promise<{ node: NodeRuntime; dsh: DshRuntime }> => {
    runtimePromise ??= (async () => {
      const node = await ensureNode(context, logger)
      const dsh = await ensureDsh(context, logger, node)
      return { node, dsh }
    })()
    return runtimePromise
  }

  const manager = new ServerManager(context, logger, () => resolveAll().then((r) => r.dsh))
  server = manager

  const provider = new DshViewProvider(manager)
  const statusBar = new StatusBar(manager)

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
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
    vscode.commands.registerCommand('dshOne.checkUpdates', async () => {
      try {
        const { node } = await resolveAll()
        const result = await checkForUpdates(context, logger, node, { force: true })
        notifyUpdate(result, manager)
      } catch (err) {
        vscode.window.showErrorMessage(`DSH One: 检查更新失败 — ${err instanceof Error ? err.message : err}`)
      }
    }),
    vscode.commands.registerCommand('dshOne.showLogs', () => {
      logger.show()
    }),
  )

  // Background update check (throttled to once per 12h inside checkForUpdates).
  void (async () => {
    try {
      const node = await ensureNode(context, logger)
      const result = await checkForUpdates(context, logger, node)
      if (result.installed) notifyUpdate(result, manager)
    } catch (err) {
      logger.warn(`background update check failed: ${err instanceof Error ? err.message : err}`)
    }
  })()
}

function notifyUpdate(
  result: { installed?: string; message: string },
  manager: ServerManager,
): void {
  if (!result.installed) {
    void vscode.window.showInformationMessage(`DSH One: ${result.message}`)
    return
  }
  const running = manager.getStatus().state === 'running' && !manager.getStatus().adopted
  const buttons = running ? ['立即重启', '稍后'] : ['好的']
  void vscode.window.showInformationMessage(`DSH One: ${result.message}`, ...buttons).then((pick) => {
    if (pick === '立即重启') void manager.restart()
  })
}

export function deactivate(): void {
  // Must be synchronous: VSCode does not await async cleanup on shutdown.
  server?.killSync()
}
