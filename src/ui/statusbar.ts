import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

/**
 * 单块状态栏：所有内容都在一个 item 的 text 里，视觉上是完整一体
 * （无间隙、hover 高亮覆盖整块）。git 那种「多段紧凑分组」用的是
 * VS Code 内部的 compact priority（workbench addEntry 私有），扩展
 * API 的 priority 只接受 number，逐块高亮和块间距都改不了——单 item
 * 内嵌图标是扩展能做到的最「一体」形态。
 *
 * 前导 $(dsh-fish) 是扩展贡献的字体图标（contributes.icons）。尾部三
 * 个图标是动作的视觉提示，真正可点的动作在悬停 tooltip 里（command
 * 链接，贴着状态栏弹出）；点击整块 = 打开浏览器（高频）。
 */
function text(status: ServerStatus): string {
  switch (status.state) {
    case 'running': {
      const actions = status.adopted ? '　$(globe)' : '　$(globe)　$(refresh)　$(debug-stop)'
      return `$(dsh-fish) DSH: 运行中 :${status.port ?? '?'}${actions}`
    }
    case 'starting':
      return '$(dsh-fish) DSH: 启动中…'
    case 'error':
      return '$(dsh-fish) DSH: 错误'
    default:
      return '$(dsh-fish) DSH: 已停止'
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
      if (status.adopted) md.appendMarkdown('复用外部启动的实例，不会被插件停止\n\n')
      md.appendMarkdown('[$(globe) 在浏览器中打开](command:dshOne.openExternal)')
      if (!status.adopted) {
        md.appendMarkdown('　[$(refresh) 重启服务](command:dshOne.restart)　[$(debug-stop) 停止服务](command:dshOne.stop)')
      }
      md.appendMarkdown('　[$(output) 显示日志](command:dshOne.showLogs)')
      return md
    case 'starting':
      md.appendMarkdown('**DSH One** — 服务启动中…')
      return md
    case 'error':
      md.appendMarkdown('**DSH One** — 服务出错\n\n')
      md.appendMarkdown('[$(refresh) 重试启动](command:dshOne.openExternal)　[$(output) 显示日志](command:dshOne.showLogs)')
      return md
    default:
      md.appendMarkdown('**DSH One** — 服务已停止\n\n')
      md.appendMarkdown('[$(play) 启动服务](command:dshOne.openExternal)　[$(output) 显示日志](command:dshOne.showLogs)')
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
