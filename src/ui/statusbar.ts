import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

/**
 * 单块状态栏：$(dsh-fish) 图标 + 状态文字。动作全在悬停 tooltip 里
 * （command 链接，贴着状态栏弹出），文本里不再重复放动作图标；点击
 * 整块 = 打开浏览器（高频）。
 *
 * 注：git 状态栏那种「多段紧凑分组」是 VS Code 内部 addEntry 的
 * compact priority，扩展 API 的 priority 只接受 number（1.135 ext
 * host 会丢弃非数字），逐块高亮和块间距扩展都改不了，所以不做分段。
 */
function text(status: ServerStatus): string {
  switch (status.state) {
    case 'running':
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Running')} :${status.port ?? '?'}`
    case 'starting':
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Starting…')}`
    case 'error':
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Error')}`
    default:
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Stopped')}`
  }
}

function color(status: ServerStatus): vscode.ThemeColor {
  switch (status.state) {
    case 'running':
      return new vscode.ThemeColor('charts.green')
    case 'starting':
      return new vscode.ThemeColor('charts.yellow')
    case 'error':
      return new vscode.ThemeColor('charts.red')
    default:
      return new vscode.ThemeColor('disabledForeground')
  }
}

/** 悬停 tooltip：动作都在这里（command 链接可点击）。 */
function tooltip(status: ServerStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true)
  md.isTrusted = true
  switch (status.state) {
    case 'running':
      md.appendMarkdown(`**DSH One** — ${status.url}\n\n`)
      if (status.adopted) md.appendMarkdown(`${vscode.l10n.t('Reusing an externally started instance; the extension will not stop it')}\n\n`)
      md.appendMarkdown(`[$(globe) ${vscode.l10n.t('Open in Browser')}](command:dshOne.openExternal)`)
      if (!status.adopted) {
        md.appendMarkdown(
          `　[$(refresh) ${vscode.l10n.t('Restart Service')}](command:dshOne.restart)　[$(debug-stop) ${vscode.l10n.t('Stop Service')}](command:dshOne.stop)`,
        )
      }
      md.appendMarkdown(`　[$(output) ${vscode.l10n.t('Show Logs')}](command:dshOne.showLogs)`)
      return md
    case 'starting':
      md.appendMarkdown(`**DSH One** — ${vscode.l10n.t('Service is starting…')}`)
      return md
    case 'error':
      md.appendMarkdown(`**DSH One** — ${vscode.l10n.t('Service Error')}\n\n`)
      md.appendMarkdown(
        `[$(refresh) ${vscode.l10n.t('Retry Starting')}](command:dshOne.openExternal)　[$(output) ${vscode.l10n.t('Show Logs')}](command:dshOne.showLogs)`,
      )
      return md
    default:
      md.appendMarkdown(`**DSH One** — ${vscode.l10n.t('Service Stopped')}\n\n`)
      md.appendMarkdown(
        `[$(play) ${vscode.l10n.t('Start Service')}](command:dshOne.openExternal)　[$(output) ${vscode.l10n.t('Show Logs')}](command:dshOne.showLogs)`,
      )
      return md
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly sub: vscode.Disposable

  constructor(manager: ServerManager) {
    this.item.command = 'dshOne.openExternal'
    this.item.name = 'DSH One'
    this.sub = manager.onDidChangeState((s) => this.update(s))
    this.update(manager.getStatus())
    this.item.show()
  }

  private update(status: ServerStatus): void {
    this.item.text = text(status)
    this.item.tooltip = tooltip(status)
    this.item.color = color(status)
  }

  dispose(): void {
    this.sub.dispose()
    this.item.dispose()
  }
}
