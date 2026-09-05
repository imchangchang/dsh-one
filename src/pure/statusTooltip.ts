/**
 * 状态栏 tooltip 的 Markdown 文本（纯函数，无 vscode 依赖，可直接 `node --test`）。
 * 与 chatContract.ts 同一约定：pure 层不 import server 模块，Status 形状在此拷贝。
 */

export interface TooltipStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  url?: string
  /** 另一窗口 spawn 的实例（adopted，绝不 kill，无管理入口）。 */
  adopted?: boolean
  /** 外部启动的认证 dsh（token 粘贴连接 / 防护错误态）：可管理但需确认弹窗。 */
  external?: boolean
  /** 防护错误态的目标端口（管理命令定位用）。 */
  port?: number
  reason?: 'dshNotFound' | 'authDshNoToken'
  /** `dsh --version` 的结果；'unknown' = 版本解析失败，不显示。 */
  version?: string
}

/** 注入的本地化函数（production 传 vscode.l10n.t；测试用恒等函数）。 */
export type Translate = (message: string, ...args: Array<string | number | boolean>) => string

/**
 * running 态：标题行后追加 `dsh v{version}`（纯文本格式串，无文案故无需 l10n）；
 * version 缺失/unknown（含 adopted 外部实例）时不显示版本行——外部实例
 * 来自哪个安装无法确认，显示会误导。外部连接的认证实例（external）同样无版本。
 */
export function tooltipMarkdown(status: TooltipStatus, t: Translate): string {
  switch (status.state) {
    case 'running': {
      let md = `**DSH One** — ${status.url}\n`
      if (status.version && status.version !== 'unknown') md += `dsh v${status.version}\n`
      md += '\n'
      if (status.external) {
        // 外部启动的认证实例（B 档 token 已连接）：可管理（停止/重启），杀前确认弹窗。
        md += `${t('Connected to an externally started dsh instance (launch token pasted); stopping or restarting it asks for confirmation')}\n\n`
        md += `[$(globe) ${t('Open in Browser')}](command:dshOne.openExternal)`
        md += `　[$(refresh) ${t('Restart External Instance')}](command:dshOne.external.restart)`
        md += `　[$(debug-stop) ${t('Stop External Instance')}](command:dshOne.external.stop)`
      } else if (status.adopted) {
        // 另一窗口 spawn 的实例：只复用、提供不了 kill 权（原行为不变）。
        md += `${t('Reusing an externally started instance; the extension will not stop it')}\n\n`
        md += `[$(globe) ${t('Open in Browser')}](command:dshOne.openExternal)`
      } else {
        md += `[$(globe) ${t('Open in Browser')}](command:dshOne.openExternal)`
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
      if (status.reason === 'authDshNoToken') {
        // 防护（拍板）：认证 dsh 无 token → 报错不另起，tooltip 给 B 档（粘贴 token）
        // 与 A 档（停止/重启）入口，说明为什么没 auto-start。
        return (
          `**DSH One** — ${t('Authenticated dsh instance is already running on port {0}', status.port ?? '?')}\n\n` +
          `${t('This dsh was started outside the extension and needs its launch token to connect. Paste the token printed in its terminal URL after ?token=, or stop the instance to start your own.')}\n\n` +
          `[$(key) ${t('Paste Launch Token')}](command:dshOne.external.pasteToken)　` +
          `[$(copy) ${t('Copy URL Template')}](command:dshOne.external.copyTokenTemplate)　` +
          `[$(debug-stop) ${t('Stop External Instance')}](command:dshOne.external.stop)　` +
          `[$(refresh) ${t('Restart Service')}](command:dshOne.external.restart)　` +
          `[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
        )
      }
      return `**DSH One** — ${t('Service Error')}\n\n[$(refresh) ${t('Retry Starting')}](command:dshOne.start)　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
    default:
      return `**DSH One** — ${t('Service Stopped')}\n\n[$(play) ${t('Start Service')}](command:dshOne.start)　[$(output) ${t('Show Logs')}](command:dshOne.showLogs)`
  }
}
