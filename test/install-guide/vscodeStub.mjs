/**
 * 假的 `vscode` 模块（安装引导页冒烟用）。
 *
 * `src/ui/installGuide.ts` 顶部 `import * as vscode from 'vscode'`，而 `vscode` 只在
 * 真扩展宿主里存在。`vscodeLoader.mjs` 把裸模块名 `vscode` 解析到这里，于是冒烟脚本
 * 能直接渲染**真实宿主代码**产出的页面（文案也是真的：无译文时 `l10n.t` 返回 key 本身，
 * 与真宿主在没有译文时的行为一致）。
 *
 * `SMOKE_LOCALE=zh-cn` 时改用 `l10n/bundle.l10n.zh-cn.json` 的译文渲染——中文串普遍更长，
 * 排版有没有被撑坏要按它看。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ZH_BUNDLE = fileURLToPath(new URL('../../l10n/bundle.l10n.zh-cn.json', import.meta.url))

let zhTable
function zh() {
  if (zhTable === undefined) zhTable = JSON.parse(readFileSync(ZH_BUNDLE, 'utf8'))
  return zhTable
}

export const l10n = {
  /** 与真宿主一致：取译文，取不到就返回 key；`{0}` 占位按参数替换。 */
  t(key, ...args) {
    const text = process.env.SMOKE_LOCALE === 'zh-cn' ? (zh()[key] ?? key) : key
    return String(text).replace(/\{(\d+)\}/g, (all, index) =>
      args[Number(index)] === undefined ? all : String(args[Number(index)]),
    )
  },
}

/** 下面几件只是让模块能加载：冒烟只渲染 `installGuideHtml`，不创建面板。 */
export const ViewColumn = { Active: -1 }
export const window = {}
export const env = { language: process.env.SMOKE_LOCALE === 'zh-cn' ? 'zh-cn' : 'en' }
export const commands = {}
export const Uri = {}
