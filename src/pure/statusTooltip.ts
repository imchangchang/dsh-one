/**
 * 状态栏 tooltip 的 Markdown 文本（纯函数，无 vscode 依赖，可直接 `node --test`）。
 * 与 chatContract.ts 同一约定：pure 层不 import server 模块，Status 形状在此拷贝。
 */

export interface TooltipStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  url?: string
  adopted?: boolean
  reason?: 'dshNotFound'
  /** `dsh --version` 的结果；'unknown' = 版本解析失败，不显示。 */
  version?: string
}

/** 注入的本地化函数（production 传 vscode.l10n.t；测试用恒等函数）。 */
export type Translate = (message: string, ...args: Array<string | number | boolean>) => string

/**
 * running 态：标题行后追加 `dsh v{version}`（纯文本格式串，无文案故无需 l10n）；
 * version 缺失/unknown（含 adopted 外部实例）时不显示版本行——外部实例
 * 来自哪个安装无法确认，显示会误导。
 */
export function tooltipMarkdown(status: TooltipStatus, t: Translate): string {
  switch (status.state) {
    case 'running': {
      let md = `**DSH One** — ${status.url}\n`
      if (status.version && status.version !== 'unknown') md += `dsh v${status.version}\n`
      md += '\n'
      if (status.adopted) {
        md += `${t('Reusing an externally started instance; the extension will not stop it')}\n\n`
      }
      md += `[$(globe) ${t('Open in Browser')}](command:dshOne.openExternal)`
      if (!status.adopted) {
        md += `　[$(refresh) ${t('Restart Service')}](command:dshOne.restart)　[$(debug-stop) ${t('Stop Service')}](command:dshOne.stop)`
      }
      md += `　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
      return md
    }
    case 'starting':
      return `**DSH One** — ${t('Service is starting…')}\n\n${t('The first start may take a while (preparing profiles and dependencies).')}`
    case 'error':
      if (status.reason === 'dshNotFound') {
        return `**DSH One** — ${t('dsh is not installed')}\n\n[$(cloud-download) ${t('Install dsh')}](command:dshOne.openSessions)　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
      }
      return `**DSH One** — ${t('Service Error')}\n\n[$(refresh) ${t('Retry Starting')}](command:dshOne.start)　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
    default:
      return `**DSH One** — ${t('Service Stopped')}\n\n[$(play) ${t('Start Service')}](command:dshOne.start)　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
  }
}
