/**
 * 同一原因的失败日志限频（#229）。
 *
 * 为什么要有它：dsh 服务停摆那 40 秒里，装配页对同一个接口无退避重试（实测 ≈280 次/秒），
 * 每一次失败都写一行日志，结果 2 MB 的宿主日志文件被**同一条**错误刷穿、翻转两轮，别的问题
 * 线索全被冲掉（用户最先看到的就是「侧栏一直报错」）。所以「同一原因」的错误必须限频记录：
 * 第一次照原样记一条，之后只在时间窗到期时补一条带重复次数的汇总行；这个原因恢复时再补一条
 * 收尾行（重复次数随之结清）。
 *
 * 两个消费方（同一份判据，两处实现）：
 * - **镜像侧**（`server/assemblyMirror.ts`，Node）：直接用这里的 {@link createFailureLog}；
 * - **页面侧**（`ui/assembly/pageHtml.ts` 的传输脚本，内联 JS，import 不了 TS）：
 *   用 {@link failureLogJs} 拿到同一套算法的源码文本，塞进那段内联脚本。
 *   `test/assemblyTransportThrottle.test.ts` 把两半放在同一串事件序列上逐行比对，漂了就红。
 *
 * 为什么不做成「一条日志最多 N 条」这种硬上限：那会把**新的**原因也一起吞掉。这里按
 * **原因**（键）+ **时间窗**计数，不同原因各自有自己的一条与计数，新问题照样第一时间出现。
 */

/** 汇总窗口的缺省长度（毫秒）：同一原因在这个时长内的重复不再逐条记。 */
export const FAILURE_LOG_WINDOW_MS = 10_000

export interface FailureLogOptions {
  /** 汇总窗口（毫秒，缺省 {@link FAILURE_LOG_WINDOW_MS}）。 */
  windowMs?: number
  /** 取当前时刻（单测注入假钟用；缺省 `Date.now`）。 */
  now?: () => number
}

/**
 * 同一原因的失败日志限频器。
 *
 * 语义（页面侧那份与它逐字一致）：
 * - `failed(reason, message)`：这个原因**第一次**出现 → 返回 `message` 原文（照原样记）；
 *   窗口内的重复 → 返回 `undefined`（只累加计数，不记）；窗口到期后的第一条 →
 *   返回 `message + " (same cause repeated N times)"`，N = 到这个原因**第一次**出现之后
 *   累计重复了几次（含被压掉的那些）。
 * - `recovered(reason, message)`：这个原因恢复 → 返回 `message + " (recovered after N repeats)"`
 *   并把这个原因的计数清掉（下次再坏从头算）；没记过这个原因 → `undefined`（不记）。
 *
 * 键（`reason`）由调用方定：调用方要「同一目标」就传目标标识，要「同一错误」就把错误文本
 * 一起拼进去。
 */
export interface FailureLog {
  failed(reason: string, message: string): string | undefined
  recovered(reason: string, message: string): string | undefined
}

interface FailureEntry {
  /** 这个原因一共出现几次（含第一次）。 */
  count: number
  /** 上一次真的记下日志的时刻。 */
  at: number
  /** 这个原因最近一次的原文（窗口到期时拿它拼汇总行）。 */
  message: string
}

export function createFailureLog(options: FailureLogOptions = {}): FailureLog {
  const windowMs = options.windowMs ?? FAILURE_LOG_WINDOW_MS
  const now = options.now ?? Date.now
  const entries = new Map<string, FailureEntry>()
  return {
    failed(reason, message) {
      const at = now()
      const entry = entries.get(reason)
      if (entry === undefined) {
        entries.set(reason, { count: 1, at, message })
        return message
      }
      entry.count += 1
      entry.message = message
      if (at - entry.at < windowMs) return undefined
      entry.at = at
      return `${message} (same cause repeated ${String(entry.count - 1)} times)`
    },
    recovered(reason, message) {
      const entry = entries.get(reason)
      if (entry === undefined) return undefined
      entries.delete(reason)
      if (entry.count === 1) return message
      return `${message} (recovered after ${String(entry.count - 1)} repeats)`
    },
  }
}

/**
 * 页面侧那份实现的源码文本（内联进传输脚本；import 不了 TS，只能给源码）。
 *
 * 与 {@link createFailureLog} 是同一套算法、同一套措辞——两半由
 * `test/assemblyTransportThrottle.test.ts` 在同一串事件序列上逐行比对，谁改了不跟另一半说就红。
 * 生成的是 `createFailureLog(windowMs)` 这个工厂本身（页面脚本自己调它）。
 *
 * 为什么手写 JS 而不是 `createFailureLog.toString()`：本仓库页面内联脚本一律是手写的模板串
 * （`probe.ts` / `selfHeal.ts` / `hostSdk.ts` / `failureNotice.ts` 都是这个形状），
 * `.toString()` 依赖打包器不重命名、不内联，读起来也不像这个仓库的代码。
 */
export function failureLogJs(): string {
  return `function createFailureLog(windowMs) {
  var entries = new Map()
  return {
    failed: function (reason, message) {
      var at = Date.now()
      var entry = entries.get(reason)
      if (entry === undefined) {
        entries.set(reason, { count: 1, at: at, message: message })
        return message
      }
      entry.count += 1
      entry.message = message
      if (at - entry.at < windowMs) return undefined
      entry.at = at
      return message + " (same cause repeated " + String(entry.count - 1) + " times)"
    },
    recovered: function (reason, message) {
      var entry = entries.get(reason)
      if (entry === undefined) return undefined
      entries.delete(reason)
      if (entry.count === 1) return message
      return message + " (recovered after " + String(entry.count - 1) + " repeats)"
    },
  }
}`
}
