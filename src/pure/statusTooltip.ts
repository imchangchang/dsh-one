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
 * version 缺失/unknown 时不显示。spawn 实例版本来自 locate 时的
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
 *
 * 宽度（#136）：气泡宽度 = 最长一行的宽度（上限是 VS Code 的 hover maxWidth，约 500px，
 * 扩展没有入口改它），所以要窄就得把每行写短。两个必须遵守的事实：
 * - 单个 `\n` **不换行**（实测：标题、URL、版本三行会被拼成一行），只有空行 `\n\n`
 *   才分段；
 * - 因此标题、版本、更新提示、说明的每一句各自成段，且可见文字控制在 48 字符以内。
 */
function actionRows(status: TooltipStatus, t: Translate, update?: UpdateVerdict): string {
  return statusActions(status, t, update)
    .map((action) => `[$(${action.icon}) ${action.label}](command:${action.command})`)
    .join('\n\n')
}

/** 把若干行拼成 Markdown（空行分段；空字符串/undefined 跳过，不产生多余空段）。 */
function paragraphs(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => !!line && line.trim() !== '').join('\n\n')
}

export function tooltipMarkdown(
  status: TooltipStatus,
  t: Translate,
  update?: UpdateVerdict,
): string {
  switch (status.state) {
    case 'running': {
      const upgradeTo = update?.state === 'update' ? update.latest : undefined
      const version =
        status.version && status.version !== 'unknown' ? `dsh v${status.version}` : undefined
      // 外部启动的认证实例（B 档 token 已连接）/ 另一窗口 spawn 的实例：都可管理，
      // 停止/重启前有确认弹窗，所以这里说明一句（短句，避免把气泡撑宽）。
      const description = status.external
        ? paragraphs([t('External dsh instance (token connected).'), t('Stop / restart asks for confirmation.')])
        : status.adopted
          ? paragraphs([t('This dsh was started in another window.'), t('Stop / restart asks for confirmation.')])
          : undefined
      return paragraphs([
        `**DSH One** — ${status.url}`,
        version,
        upgradeTo ? t('A newer dsh is available: v{0}', upgradeTo) : undefined,
        description,
        actionRows(status, t, update),
      ])
    }
    case 'starting':
      return paragraphs([
        `**DSH One** — ${t('Service is starting…')}`,
        t('The first start may take a while.'),
        t('It prepares profiles and dependencies.'),
        actionRows(status, t, update),
      ])
    case 'error':
      if (status.reason === 'dshNotFound') {
        return paragraphs([`**DSH One** — ${t('dsh is not installed')}`, actionRows(status, t, update)])
      }
      if (status.reason === 'authDshNoToken') {
        // 防护（拍板）：认证 dsh 无 token → 报错不另起，tooltip 给 B 档（粘贴 token）
        // 与 A 档（停止/重启）入口，说明为什么没 auto-start。说明拆成短句，别撑宽气泡。
        return paragraphs([
          `**DSH One** — ${t('Port {0} is taken by another dsh', status.port ?? '?')}`,
          t('Another authenticated dsh is running there.'),
          t('It was started outside the extension.'),
          t('Paste the ?token= from its terminal URL,'),
          t('or stop it to start your own.'),
          actionRows(status, t, update),
        ])
      }
      return paragraphs([`**DSH One** — ${t('Service Error')}`, actionRows(status, t, update)])
    default:
      return paragraphs([`**DSH One** — ${t('Service Stopped')}`, actionRows(status, t, update)])
  }
}
