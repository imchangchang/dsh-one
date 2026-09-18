/**
 * 会话面读数（#203 的定量观测）：一轮整轮里按时间点记「侧栏树的会话行数量」与
 * `sessionController` 的可用性，用来判断长轮次里的退化是**单调递减**还是**某一步之后归零**。
 *
 * 为什么要有它：现象只在长轮次里出现过（侧栏树的会话行整片消失、控制台上
 * `session/control: active Service "sessionController" is unavailable`），而事后单跑那几项
 * 全是绿的——报告里的分项结论看不出「退化是怎么发生的」，这一层补的就是那个形状。
 *
 * 三个读数，**全是读**：
 * - **网关侧** `session.list`：它一身两职——既是树上会话行的数据源，又是
 *   `sessionController` 服务在不在的探针。这个方法就挂在该服务上（官方
 *   `@deepseek-ai/dsh-api-session-controller` 的 `Remote("list")`，`invocation: {kind:'direct'}`
 *   = 在网关根上下文上取服务），服务不可用时它原样报
 *   `gateway/service-unavailable` + `active Service "sessionController" is unavailable`
 *   ——与现场那条控制台报错同一个出处（`dsh-api-gateway` 的 `prepareInvocation`）。
 * - **页面侧**：树上**真渲染出来**的行数。自有树按自有语义属性数
 *   （`[data-dshone-tree-row=…]`），官方对照档按官方类名后缀数（`_sessionRow` 那一族）。
 * - **控制台**：这一页到读数为目止出现过的「服务不可用」行（由 `harness.ts` 的
 *   `capturePage` 收集）。
 *
 * 目录与用法：只在 `--diag-surface` 打开时被调用（默认跑法一条读数都不记），时间线写进
 * 产物目录的 `session-surface.json` / `session-surface.txt`。见 `verify.ts`。
 */
import type { Page } from 'playwright'
import { listSessions } from '../../src/server/dshRpc.ts'

/** 网关侧读数（`session.list` 一次）。 */
export interface GatewaySurface {
  /** 这次调用成不成功——**这就是 `sessionController` 的可用性读数**（见文件头）。 */
  ok: boolean
  /** 实例里当前有几条会话（`session.list` 的条数）。 */
  sessions: number
  /** 其中空白会话条数（空白会话不上树，单独记，免得把行数的差读成「丢会话」）。 */
  blank: number
  /** 其中正在跑的条数（观测用）。 */
  running: number
  /** 失败时网关原样回的 `code message`，成功时为空串。 */
  detail: string
}

/** 页面侧读数（一页读一次，一次 evaluate 里读全）。 */
export interface PageSurface {
  /** 自有树渲染出来的工作区分组行数。 */
  workspaceRows: number
  /**
   * 自有树渲染出来的会话行数——**这一条就是「会话行数量」**。
   *
   * 口径是**页面开出来时的默认展开态**（首开只展开「当前会话那一组」，其余分组是折叠的，
   * 折叠的分组一行都不进 DOM）：所以正常读数大约是「当前那一组的会话数（含自动落脚的那条
   * 空白会话）」。会话面整片消失时它会掉到 0——与 F-52 那种「5 个分组、每组 rows:0」是
   * 同一件事的两种量法（那一条先点了「展开 / 展开全部」）。
   * 不在这里替套件点展开按钮：读数要只读，且展开态是持久视图态，替别人点会改到现场。
   */
  sessionRows: number
  /** 官方对照档渲染出来的会话行数（官方类名后缀 `_sessionRow`）。 */
  officialRows: number
  /** 页面上带崩溃标记的槽位锚点数（`[data-slot-error]`）。 */
  slotErrors: number
  /** 该页控制台里到读数为目止的「服务不可用」行数。 */
  unavailable: number
}

/** 一条读数（网关侧与页面侧各记各的，同一条里可能只有一边）。 */
export interface SurfaceReading {
  /** 相对整轮开始的秒数。 */
  seconds: number
  /** 这一步是什么（`suite:F-12` / `page:F-12/sidebar`）。 */
  where: string
  gateway?: GatewaySurface
  page?: PageSurface
  /** 页面读数那条的页面地址。 */
  url?: string
}

/** 网关侧读数：`session.list` 一次（读，不改任何东西；15 秒超时由 `callRpc` 兜着）。 */
export async function readGatewaySurface(gateway: string): Promise<GatewaySurface> {
  try {
    const sessions = await listSessions(gateway)
    return {
      ok: true,
      sessions: sessions.length,
      blank: sessions.filter((session) => session.blank).length,
      running: sessions.filter((session) => session.running).length,
      detail: '',
    }
  } catch (err) {
    return {
      ok: false,
      sessions: -1,
      blank: -1,
      running: -1,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 页面侧读数（选择器只用自有语义属性与官方类名后缀，见 README 的写套件约定）。 */
export async function readPageSurface(page: Page, consoleLines: readonly string[]): Promise<PageSurface> {
  const counts = await page.evaluate(() => ({
    workspaceRows: document.querySelectorAll('[data-dshone-tree-row="workspace"]').length,
    sessionRows: document.querySelectorAll('[data-dshone-tree-row="session"]').length,
    officialRows: document.querySelectorAll('[class*="_sessionRow"]').length,
    slotErrors: document.querySelectorAll('[data-slot-error]').length,
  }))
  return { ...counts, unavailable: unavailableLines(consoleLines).length }
}

/** 「服务不可用」那一类控制台行（现场那条 `active Service … is unavailable` 在里面）。 */
export function unavailableLines(lines: readonly string[]): string[] {
  return lines.filter((line) => /is unavailable/.test(line))
}

/** 一条读数压成一行（时间线文本用；网关侧与页面侧各一种形状）。 */
export function readingLine(reading: SurfaceReading): string {
  const head = `${reading.seconds.toFixed(1)}s ${reading.where}`
  if (reading.gateway !== undefined) {
    const g = reading.gateway
    return g.ok
      ? `${head} 网关 session.list 通：会话 ${String(g.sessions)} 条（空白 ${String(g.blank)}、运行中 ${String(g.running)}）`
      : `${head} 网关 session.list **失败**：${g.detail}`
  }
  const p = reading.page
  if (p === undefined) return head
  return `${head} 页面：会话行 ${String(p.sessionRows)}、分组行 ${String(p.workspaceRows)}、官方对照行 ${String(p.officialRows)}、槽位崩溃标记 ${String(p.slotErrors)}、控制台「服务不可用」${String(p.unavailable)}`
}

/**
 * 时间线的汇总（报告里那几条事实行）。
 *
 * 只给「看得出来成因」的量：首末读数、最小值出现在哪一步、有没有归零、网关侧失败过几次
 * ——单调递减与「某一步之后突然归零」在这几条上形状完全不同。
 */
export function surfaceSummary(readings: readonly SurfaceReading[]): string[] {
  const gateways = readings.filter((reading) => reading.gateway !== undefined)
  const pages = readings.filter((reading) => reading.page !== undefined)
  const lines: string[] = []
  const failures = gateways.filter((reading) => reading.gateway?.ok !== true)
  if (gateways.length > 0) {
    const first = gateways[0] as SurfaceReading
    const last = gateways[gateways.length - 1] as SurfaceReading
    lines.push(
      `时间线（网关侧 session.list，共 ${String(gateways.length)} 个读数点）：` +
        `首个读数 ${String(first.gateway?.sessions ?? -1)} 条（${first.where}）、末个读数 ${String(last.gateway?.sessions ?? -1)} 条（${last.where}）`,
    )
    if (failures.length > 0) {
      lines.push(
        `网关侧 session.list 失败过 ${String(failures.length)} 次：` +
          failures.map((reading) => `${reading.where}@${reading.seconds.toFixed(0)}s（${reading.gateway?.detail ?? ''}）`).join('；'),
      )
    } else {
      lines.push('网关侧 session.list 整轮零失败（会话面数据源一直在）')
    }
  }
  if (pages.length > 0) {
    const rows = pages.map((reading) => reading.page?.sessionRows ?? -1)
    const min = Math.min(...rows)
    const at = pages[rows.indexOf(min)] as SurfaceReading
    const zeros = pages.filter((reading) => (reading.page?.sessionRows ?? -1) === 0)
    const first = pages[0] as SurfaceReading
    const last = pages[pages.length - 1] as SurfaceReading
    lines.push(
      `时间线（页面侧会话行，共 ${String(pages.length)} 个读数点）：` +
        `首个 ${String(first.page?.sessionRows ?? -1)} 行（${first.where}）、末个 ${String(last.page?.sessionRows ?? -1)} 行（${last.where}）、最小值 ${String(min)} 行（${at.where}）`,
    )
    lines.push(
      zeros.length === 0
        ? '整轮没有出现过「会话行 0 行」的页面读数'
        : `会话行为 0 的页面读数 ${String(zeros.length)} 次：${zeros.slice(0, 8).map((reading) => `${reading.where}@${reading.seconds.toFixed(0)}s`).join('、')}`,
    )
    const unavailable = pages.reduce((sum, reading) => sum + (reading.page?.unavailable ?? 0), 0)
    lines.push(`页面控制台里「服务不可用」行合计 ${String(unavailable)} 条`)
  }
  if (lines.length === 0) lines.push('这一轮没记到任何会话面读数（诊断开关没开，或一次页面都没开）')
  return lines
}
