import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

function text(status: ServerStatus): string {
  // 前导 $(dsh-fish) 是扩展贡献的自定义字体图标（contributes.icons，
  // 字体由 assets/icon.svg 经 fantasticon 生成）；状态靠颜色 + 文字区分。
  switch (status.state) {
    case 'running':
      return `$(dsh-fish) DSH: 运行中 :${status.port ?? '?'}`
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

/** 主状态块的 tooltip（command 链接可点击）；动作按钮有自己的 tooltip。 */
function mainTooltip(status: ServerStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true)
  md.isTrusted = true
  switch (status.state) {
    case 'running':
      md.appendMarkdown(`**DSH One** — ${status.url}\n\n`)
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
 * 状态栏由四个相邻 item 组成一个服务组：主状态块（$(zap) 图标 +
 * 状态文字，点击打开/启动）+ 浏览器/重启/停止三个图标按钮。运行时
 * 四个 item 共用 charts.green 强调一体性。VS Code 状态栏不支持自定义
 * 图标（只有内置 codicon）与自定义背景色（只有 error/warning 两色），
 * 所以「框」用同色 + 紧邻排版近似。按钮仅在运行中的自有实例时可见。
 */
export class StatusBar implements vscode.Disposable {
  private readonly main = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly openBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9)
  private readonly restartBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8)
  private readonly stopBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 7)
  private readonly sub: vscode.Disposable

  constructor(manager: ServerManager) {
    this.main.command = 'dshOne.openExternal'
    this.openBtn.text = '$(globe)'
    this.openBtn.tooltip = 'DSH One — 在浏览器中打开'
    this.openBtn.command = 'dshOne.openExternal'
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
    const running = status.state === 'running'
    const owned = running && !status.adopted
    // 与主块同色，视觉上四个 item 是一个组
    const green = new vscode.ThemeColor('charts.green')
    this.openBtn.color = green
    this.restartBtn.color = green
    this.stopBtn.color = green
    if (running) this.openBtn.show()
    else this.openBtn.hide()
    if (owned) {
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
    this.openBtn.dispose()
    this.restartBtn.dispose()
    this.stopBtn.dispose()
  }
}
