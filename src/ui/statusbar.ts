import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

function text(status: ServerStatus): string {
  switch (status.state) {
    case 'running':
      return `$(zap) DSH: 运行中 :${status.port ?? '?'}`
    case 'starting':
      return '$(sync~spin) DSH: 启动中'
    case 'error':
      return '$(error) DSH: 错误'
    default:
      return '$(circle-slash) DSH: 已停止'
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

/** 主状态块的 tooltip（command 链接可点击）；动作按钮有自己的 tooltip。 */
function mainTooltip(status: ServerStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true)
  md.isTrusted = true
  switch (status.state) {
    case 'running':
      md.appendMarkdown(`**DSH One** — ${status.url}（点击在浏览器中打开）\n\n`)
      if (status.adopted) md.appendMarkdown('复用外部启动的实例，不会被插件停止\n\n')
      md.appendMarkdown('[$(output) 显示日志](command:dshOne.showLogs)')
      return md
    case 'starting':
      md.appendMarkdown('**DSH One** — 服务启动中…')
      return md
    case 'error':
      md.appendMarkdown('**DSH One** — 服务出错（点击重试）\n\n')
      md.appendMarkdown('[$(output) 显示日志](command:dshOne.showLogs)')
      return md
    default:
      md.appendMarkdown('**DSH One** — 服务已停止（点击启动）\n\n')
      md.appendMarkdown('[$(output) 显示日志](command:dshOne.showLogs)')
      return md
  }
}

/**
 * 状态栏由三个独立 item 组成（同 git 的分支/同步按钮）：主状态块
 * （点击打开/启动）+ 重启、停止两个小图标按钮。按钮仅在运行中的
 * 自有实例时可见——收养的实例永不杀，服务未运行时无事可停。
 */
export class StatusBar implements vscode.Disposable {
  private readonly main = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly restartBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9)
  private readonly stopBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8)
  private readonly sub: vscode.Disposable

  constructor(manager: ServerManager) {
    this.main.command = 'dshOne.openExternal'
    this.restartBtn.text = '$(refresh)'
    this.restartBtn.tooltip = 'DSH One — 重启服务'
    this.restartBtn.command = 'dshOne.restart'
    this.stopBtn.text = '$(debug-stop)'
    this.stopBtn.tooltip = 'DSH One — 停止服务'
    this.stopBtn.command = 'dshOne.stop'
    this.main.show()
    this.sub = manager.onDidChangeState((s) => this.update(s))
    this.update(manager.getStatus())
  }

  private update(status: ServerStatus): void {
    this.main.text = text(status)
    this.main.tooltip = mainTooltip(status)
    this.main.color = color(status)
    const actionsVisible = status.state === 'running' && !status.adopted
    if (actionsVisible) {
      this.restartBtn.show()
      this.stopBtn.show()
    } else {
      this.restartBtn.hide()
      this.stopBtn.hide()
    }
  }

  dispose(): void {
    this.sub.dispose()
    this.main.dispose()
    this.restartBtn.dispose()
    this.stopBtn.dispose()
  }
}
