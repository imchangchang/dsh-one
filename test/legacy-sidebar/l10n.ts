/**
 * 旧侧栏那条链上的译文取值：key = 英文默认串，译文取自仓库里真的
 * `l10n/bundle.l10n.zh-cn.json`（**不另抄一份**）。
 *
 * 为什么用 zh-cn：中文串普遍更长，行的宽度、省略与截断都按它看最准；现装配侧走的也是
 * 官方中文词典，两侧语言一致才谈得上「并排看」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BUNDLE = fileURLToPath(new URL('../../l10n/bundle.l10n.zh-cn.json', import.meta.url))

let table: Record<string, string> | undefined

/** 译文表（读不到就是空表，调用方回落 key —— 与真宿主在没有译文时的行为一致）。 */
export function bundle(): Record<string, string> {
  if (table === undefined) {
    try {
      table = JSON.parse(readFileSync(BUNDLE, 'utf8')) as Record<string, string>
    } catch {
      table = {}
    }
  }
  return table
}

/** 旧侧栏纯逻辑要的 `L10nFn` 形状（`vscode.l10n.t` 的同款：key + `{0}` 占位）。 */
export function vscodeL10nT(template: string, ...args: Array<string | number>): string {
  const text = bundle()[template] ?? template
  return text.replace(/\{(\d+)\}/g, (all, index: string) => {
    const value = args[Number(index)]
    return value === undefined ? all : String(value)
  })
}
