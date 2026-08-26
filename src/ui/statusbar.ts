import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

function label(status: ServerStatus): { text: string; tooltip: string } {
  switch (status.state) {
    case 'running':
      return {
        text: `$(zap) DSH: 运行中 :${status.port ?? '?'}`,
        tooltip: status.adopted
          ? `DSH One — 已连接现有实例 ${status.url}（收养的进程不会被插件终止）`
          : `DSH One — ${status.url}`,
      }
    case 'starting':
      return { text: '$(sync~spin) DSH: 启动中', tooltip: 'DSH One — 服务启动中' }
    case 'error':
      return { text: '$(error) DSH: 错误', tooltip: 'DSH One — 服务出错，点击查看' }
    default:
      return { text: '$(circle-slash) DSH: 已停止', tooltip: 'DSH One — 服务已停止，点击打开' }
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly sub: vscode.Disposable

  constructor(manager: ServerManager) {
    this.item.command = 'dshOne.open'
    this.sub = manager.onDidChangeState((s) => this.update(s))
    this.update(manager.getStatus())
    this.item.show()
  }

  private update(status: ServerStatus): void {
    const { text, tooltip } = label(status)
    this.item.text = text
    this.item.tooltip = tooltip
  }

  dispose(): void {
    this.sub.dispose()
    this.item.dispose()
  }
}
