/**
 * 状态栏 tooltip 的 Markdown 文本（纯函数，无 vscode 依赖，可直接 `node --test`）。
 * 与 chatContract.ts 同一约定：pure 层不 import server 模块，Status 形状在此拷贝。
 */
import type { UpdateVerdict } from './dshUpdate.ts'
import { statusActions } from './statusActions.ts'

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
 * running 态：标题行后追加 `dsh v{version}`（纯文本格式串，无文案故无需 l10n）。
 * version 缺失/unknown 时不显示版本行。spawn 实例版本来自 locate 时的
 * `dsh --version`；adopted（另一窗口 spawn）/external（token 连接）实例的版本
 * 来自 shared 记录或「命令行解析真实入口 → 执行 --version」的探测，两者都不
 * 依赖扩展 PATH 近似（多安装会误导），探测不出才缺省不显示。
 *
 * 第三个参数是更新判定（#86）：只有判定为 `update`（npm latest 更新）时才多一行
 * 版本提示，并把动作里的「检查更新」换成「升级到 v{latest}」。`unknown`
 * （版本缺失 / 网络失败）什么都不显示——检查失败不能变成「已是最新」的暗示。
 *
 * 动作行（#90）：动作清单来自 `src/pure/statusActions.ts`（与点击状态栏弹出的动作面板
 * 同一份表），每行一个链接、行间空一行。**不能再把多个链接拼进同一段落**——那样
 * VS Code 会按气泡宽度随机折行（曾把「Show Logs」拦腰截断），空行分段才是稳定的一行一个。
 */
function actionRows(status: TooltipStatus, t: Translate, update?: UpdateVerdict): string {
  return statusActions(status, t, update)
    .map((action) => `[$(${action.icon}) ${action.label}](command:${action.command})`)
    .join('\n\n')
}

export function tooltipMarkdown(
  status: TooltipStatus,
  t: Translate,
  update?: UpdateVerdict,
): string {
  switch (status.state) {
    case 'running': {
      let md = `**DSH One** — ${status.url}\n`
      if (status.version && status.version !== 'unknown') md += `dsh v${status.version}\n`
      const upgradeTo = update?.state === 'update' ? update.latest : undefined
      if (upgradeTo) md += `${t('A newer dsh is available: v{0}', upgradeTo)}\n`
      md += '\n'
      if (status.external) {
        // 外部启动的认证实例（B 档 token 已连接）：可管理（停止/重启），杀前确认弹窗。
        md += `${t('Connected to an externally started dsh instance (launch token pasted); stopping or restarting it asks for confirmation')}\n\n`
      } else if (status.adopted) {
        // 另一窗口 spawn 的实例：可管理（确认弹窗由命令层负责）——单用户多窗口
        // 场景两个窗口都是同一人的，停止/重启影响同一套 dsh；与外部实例同款入口。
        md += `${t('Reusing a dsh started in another window; stopping or restarting it asks for confirmation and may affect that window')}\n\n`
      }
      return md + actionRows(status, t, update)
    }
    case 'starting':
      return (
        `**DSH One** — ${t('Service is starting…')}\n\n` +
        `${t('The first start may take a while (preparing profiles and dependencies).')}\n\n` +
        actionRows(status, t, update)
      )
    case 'error':
      if (status.reason === 'dshNotFound') {
        return `**DSH One** — ${t('dsh is not installed')}\n\n${actionRows(status, t, update)}`
      }
      if (status.reason === 'authDshNoToken') {
        // 防护（拍板）：认证 dsh 无 token → 报错不另起，tooltip 给 B 档（粘贴 token）
        // 与 A 档（停止/重启）入口，说明为什么没 auto-start。
        return (
          `**DSH One** — ${t('Authenticated dsh instance is already running on port {0}', status.port ?? '?')}\n\n` +
          `${t('This dsh was started outside the extension and needs its launch token to connect. Paste the token printed in its terminal URL after ?token=, or stop the instance to start your own.')}\n\n` +
          actionRows(status, t, update)
        )
      }
      return `**DSH One** — ${t('Service Error')}\n\n${actionRows(status, t, update)}`
    default:
      return `**DSH One** — ${t('Service Stopped')}\n\n${actionRows(status, t, update)}`
  }
}
