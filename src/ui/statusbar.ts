import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

function label(status: ServerStatus): { text: string; tooltip: string; color: vscode.ThemeColor } {
  switch (status.state) {
    case 'running':
      return {
        text: `$(zap) DSH: 运行中 :${status.port ?? '?'}`,
        tooltip: status.adopted
          ? `DSH One — 已复用已有实例 ${status.url}（该实例由外部启动，不会被插件终止）；点击在浏览器打开`
          : `DSH One — ${status.url}；点击在浏览器打开`,
        color: new vscode.ThemeColor('charts.green'),
      }
    case 'starting':
      return {
        text: '$(sync~spin) DSH: 启动中',
        tooltip: 'DSH One — 服务启动中',
        color: new vscode.ThemeColor('charts.yellow'),
      }
    case 'error':
      return {
        text: '$(error) DSH: 错误',
        tooltip: 'DSH One — 服务出错，点击查看',
        color: new vscode.ThemeColor('charts.red'),
      }
    default:
      return {
        text: '$(circle-slash) DSH: 已停止',
        tooltip: 'DSH One — 服务已停止，点击启动并在浏览器打开',
        color: new vscode.ThemeColor('disabledForeground'),
      }
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly sub: vscode.Disposable

  constructor(manager: ServerManager) {
    this.item.command = 'dshOne.openExternal'
    this.sub = manager.onDidChangeState((s) => this.update(s))
    this.update(manager.getStatus())
    this.item.show()
  }

  private update(status: ServerStatus): void {
    const { text, tooltip, color } = label(status)
    this.item.text = text
    this.item.tooltip = tooltip
    this.item.color = color
  }

  dispose(): void {
    this.sub.dispose()
    this.item.dispose()
  }
}
