/**
 * 隔离实例网关输出的**失败诊断**（#231）：从它的 stdout / stderr 里把真正的异常挑出来。
 *
 * ## 为什么要有它（#231 的现场）
 *
 * 门禁「在指定版本的 dsh 上跑实验室」（`scripts/verify-lab-version.mjs`）最要紧的失败现场
 * 就是「网关一起来就崩」——实测混装的候选树（`dsh` 是 alpha.1、子包装成 alpha.2）上
 * `dsh web` 一启动就 `SyntaxError: … '@deepseek-ai/dsh-app-boot' does not provide an
 * export named 'watchUserPatches'`。而 `labGateway` 原来只留 **8 KB** 尾巴、报错时再取最后
 * 5~6 行拼成一行——网关启动先打的是插件装载那一长串日志，真正的异常被 8 KB 窗口挤了出去，
 * 现场只看到「没起来」，看不出为什么。
 *
 * ## 三件事
 *
 * - {@link appendGatewayOutput}：滚动窗口从 8 KB 放大到 {@link GATEWAY_OUTPUT_WINDOW_CHARS}，
 *   够装下一整段启动日志；
 * - {@link extractErrorLines}：按错误签名把异常行筛出来——不管它落在窗口的哪一段上都带得出来
 *   （窗口再大也总有个上限，这一条才是「一定看得见」的保证）；
 * - {@link gatewayFailureDetail} + {@link writeGatewayOutput}：报错里给出筛出来的异常、
 *   输出末尾与**完整输出的落盘路径**。
 *
 * 这一层只做「让人看得见」，不判任何断言：判据仍在套件与门禁侧。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** 网关输出的滚动窗口（字符数）。8 KB 装不下启动日志，实测就是这个尺寸把异常挤掉的。 */
export const GATEWAY_OUTPUT_WINDOW_CHARS = 512_000

/**
 * 错误签名：命中即认为这一行（以及它后面几行）是「真正的异常」的一部分。
 *
 * 宁可多筛几条也不漏：这一层只是给人看的排查材料，把 `level=error` 这类无关行带进来
 * 无伤大雅，漏掉真正的 `SyntaxError` 才是 #231 的病因。
 */
const ERROR_SIGNATURE =
  /SyntaxError|TypeError|ReferenceError|RangeError|Uncaught|Unhandled|Traceback|does not provide an export|Cannot find module|ERR_[A-Z]+|EADDRINUSE|EACCES|NODE_OPTIONS|FATAL/i

/** 每次读进来一段输出：只留最后 `limit` 个字符（滚动窗口）。 */
export function appendGatewayOutput(previous: string, chunk: string, limit = GATEWAY_OUTPUT_WINDOW_CHARS): string {
  return (previous + chunk).slice(-limit)
}

/**
 * 从整段输出里筛出「真正的异常」：命中签名的行 + 紧随其后的几行（栈帧 / 上下文）。
 * 按出现顺序给，最多 `limit` 行。
 */
export function extractErrorLines(output: string, limit = 24): string[] {
  const lines = output.split('\n')
  const picked: string[] = []
  for (let index = 0; index < lines.length && picked.length < limit; index += 1) {
    if (!ERROR_SIGNATURE.test(lines[index] ?? '')) continue
    for (let offset = 0; offset < 4 && picked.length < limit; offset += 1) {
      const line = lines[index + offset]
      if (line === undefined) break
      picked.push(line)
    }
    index += 3
  }
  return picked
}

/** 网关输出的兜底落盘路径（没有给 `logPath` 时用它；同一端口覆盖同一个文件）。 */
export function defaultFailureLogPath(port: number): string {
  return path.join(os.tmpdir(), `dsh-lab-gateway-${String(port)}.log`)
}

/** 把整段输出落一份盘；写不了就返回 undefined（这一层不该让收尾再抛一次）。 */
export function writeGatewayOutput(output: string, target: string): string | undefined {
  try {
    fs.writeFileSync(target, output, 'utf8')
    return target
  } catch {
    return undefined
  }
}

/**
 * 报错里那段说明：**真正的异常**在前（筛出来的）、输出末尾在后、完整输出路径垫底。
 * 网关没起来 / 半路退出时都用它，失败现场不必再去猜。
 */
export function gatewayFailureDetail(
  output: string,
  options: { logPath?: string; errorLines?: number; tailLines?: number } = {},
): string {
  const text = output.trim()
  if (text === '') return '网关没有任何输出。'
  const errors = extractErrorLines(output, options.errorLines ?? 24)
  const tail = text.split('\n').slice(-(options.tailLines ?? 8))
  const parts = [
    errors.length === 0
      ? '真正的异常：筛不出错误签名，见下面的输出末尾与完整输出。'
      : `真正的异常（筛出来的 ${String(errors.length)} 行）：\n${errors.join('\n')}`,
    `输出末尾 ${String(tail.length)} 行：\n${tail.join('\n')}`,
  ]
  if (options.logPath !== undefined) parts.push(`完整输出：${options.logPath}`)
  return parts.join('\n')
}
