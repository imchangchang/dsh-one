/**
 * 宿主调用通道与宿主能力口**共用的错误词汇表**（#84 从 hostCalls.ts 拆出来）。
 *
 * 拆出来的原因很实际：`hostCalls.ts` 做目录限域时 import 了 `node:fs/promises`，
 * 而能力口的**前端 SDK 要打进浏览器 bundle**——前端 bundle 里出现 node 内建模块
 * 会直接构建失败。错误码与判定是两侧都要的那部分，单独放这里就不牵出 node。
 *
 * 口径只有一处：宿主侧（能力桥/宿主半）产生码，前端按码决定提示文案，不解析 message。
 */

/** 结构化错误码（页面按 code 决定提示文案，不解析 message）。 */
export type HostCallErrorCode =
  | 'unknown-call'
  | 'invalid-args'
  | 'no-workspace'
  | 'not-found'
  /** 目标能力的外部程序起不来（目前仅 git：未安装或不可执行）。 */
  | 'git-missing'
  | 'failed'
  | 'unsupported'

/** 宿主回执的错误体。 */
export interface HostCallError {
  code: HostCallErrorCode
  message: string
}

/** 结构化错误判定（区分「回执数据」与「回执错误」）。 */
export function isHostCallError(value: unknown): value is HostCallError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HostCallError).code === 'string' &&
    typeof (value as HostCallError).message === 'string'
  )
}

/** 参数读取辅助：只接受普通对象。 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
