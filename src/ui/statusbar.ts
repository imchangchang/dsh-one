import * as vscode from 'vscode'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import type { DshUpdate } from '../server/dshUpdate.ts'
import { tooltipMarkdown, type TooltipStatus } from '../pure/statusTooltip.ts'
import { decideUpdate } from '../pure/dshUpdate.ts'

/**
 * 单块状态栏：$(dsh-fish) 图标 + 状态文字。动作有两个面、同一份动作表
 * （`src/pure/statusActions.ts`）：
 * - 悬停 tooltip：贴着状态栏弹出，链接一行一个（被动查看）；
 * - 点击整块：打开动作面板（QuickPick），一个动作一行（主动操作）。
 * 点击不再直接跳浏览器——「打开浏览器」只是面板里的第一行（#90）。
 *
 * 注：git 状态栏那种「多段紧凑分组」是 VS Code 内部 addEntry 的
 * compact priority，扩展 API 的 priority 只接受 number（1.135 ext
 * host 会丢弃非数字），逐块高亮和块间距扩展都改不了，所以不做分段。
 */
/** 未安装 dsh 不是错误：用户可能只是暂时没装，属于符合预期的正常状态。 */
function isDshNotFound(status: ServerStatus): boolean {
  return status.state === 'error' && status.reason === 'dshNotFound'
}

function text(status: ServerStatus): string {
  switch (status.state) {
    case 'running':
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Running')} :${status.port ?? '?'}`
    case 'starting':
      return `$(dsh-fish) DSH: ${vscode.l10n.t('Starting…')}`
    case 'error':
      // 未安装 dsh 用「未安装」而非红色 Error：是待办提示，不是错误。
      if (isDshNotFound(status)) return `$(dsh-fish) DSH: ${vscode.l10n.t('Not installed')}`
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
      if (isDshNotFound(status)) return new vscode.ThemeColor('charts.yellow')
      return new vscode.ThemeColor('charts.red')
    default:
      return new vscode.ThemeColor('disabledForeground')
  }
}

/**
 * 悬停 tooltip：动作都在这里（command 链接可点击）。Markdown 文本由
 * src/pure/statusTooltip.ts 生成（纯函数，单测覆盖逐态内容）。
 *
 * 更新判定在这里现算：npm latest 由 DshUpdate 持有（后台检查一次 + 「检查更新」
 * 命令刷新），当前版本取状态里的 `dsh --version` ——所以服务重启换版本后，
 * tooltip 不用等下一次网络检查就能对上。
 */
function tooltip(status: ServerStatus, update: DshUpdate): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true)
  md.isTrusted = true
  const verdict = decideUpdate(status.version, update.latest())
  md.appendMarkdown(
    tooltipMarkdown(status, (message, ...args) => vscode.l10n.t(message, ...args), verdict),
  )
  return md
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  private readonly sub: vscode.Disposable
  private readonly updateSub: vscode.Disposable

  constructor(
    private readonly manager: ServerManager,
    private readonly updateChecker: DshUpdate,
  ) {
    // 点击 = 打开动作面板（#90）。面板按当前状态给动作，所以所有状态都指向同一个命令
    // （包括未安装 dsh——那时面板里的第一行是「安装 dsh」，点击语义反而更直白）。
    this.item.command = 'dshOne.statusPanel'
    this.item.name = 'DSH One'
    this.sub = manager.onDidChangeState((s) => this.render(s))
    // 更新检查是异步的：查完（或失败）重画一次 tooltip。
    this.updateSub = updateChecker.onDidChange(() => this.render(manager.getStatus()))
    this.render(manager.getStatus())
    this.item.show()
  }

  private render(status: ServerStatus): void {
    this.item.text = text(status)
    // lanAddress = 转发器正在监听的局域网地址（ undefined = 局域网不可达/未知）。
    const tooltipStatus: TooltipStatus = { ...status, lanIp: this.manager.lanAddress }
    this.item.tooltip = tooltip(tooltipStatus, this.updateChecker)
    this.item.color = color(status)
  }

  dispose(): void {
    this.sub.dispose()
    this.updateSub.dispose()
    this.item.dispose()
  }
}
