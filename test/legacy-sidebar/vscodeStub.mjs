/**
 * 假的 `vscode` 模块（旧侧栏渲染对照用）。
 *
 * `src/ui/sessionsView.ts` 顶上 `import * as vscode from 'vscode'`，而 `vscode` 只在真
 * 扩展宿主里存在。`vscodeLoader.mjs` 把裸模块名 `vscode` 解析到这里，于是 harness 能
 * 直接调**真实宿主代码**（`SessionsViewProvider.resolveWebviewView`）产出旧侧栏那一页
 * HTML —— HTML 与 `SESSIONS_STYLE` 都来自仓库里的那份代码，harness 不另抄一份。
 *
 * 页面侧只需要两样真值：
 * - `Uri.joinPath` 让 `loadWebviewL10n` 读到仓库真的 `l10n/bundle.l10n.zh-cn.json`；
 * - `env.language` 决定注入哪一份译文（缺省 zh-cn：中文串更长，排版按它看）。
 *
 * 其余接口按「点了不报错」处理：动作消息可以落空，但宿主侧不得抛异常。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ZH_BUNDLE = fileURLToPath(new URL('../../l10n/bundle.l10n.zh-cn.json', import.meta.url))

let zhTable
function zh() {
  if (zhTable === undefined) zhTable = JSON.parse(readFileSync(ZH_BUNDLE, 'utf8'))
  return zhTable
}

export const env = {
  language: process.env.LEGACY_LOCALE ?? 'zh-cn',
  clipboard: { writeText: async () => undefined },
  openExternal: async () => true,
}

export const l10n = {
  /** 与真宿主一致：取译文，取不到就返回 key；`{0}` 占位按参数替换。 */
  t(key, ...args) {
    const text = env.language === 'zh-cn' ? (zh()[key] ?? key) : key
    return String(text).replace(/\{(\d+)\}/g, (all, index) =>
      args[Number(index)] === undefined ? all : String(args[Number(index)]),
    )
  },
}

/** 只支持 harness 用到的那几条：`joinPath`（读 l10n）与 `file`（复制路径那一路）。 */
function uriOf(fsPath) {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath}`,
  }
}

export const Uri = {
  file: (fsPath) => uriOf(fsPath),
  joinPath: (base, ...parts) => uriOf([base?.fsPath ?? '', ...parts].join('/').replace(/\/+/g, '/')),
  parse: (text) => uriOf(String(text).replace(/^file:\/\//, '')),
}

export const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => ({ dispose() {} }),
}

export const window = {
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showInputBox: async () => undefined,
  showErrorMessage: async () => undefined,
}

export const workspace = {}

export class EventEmitter {
  constructor() {
    this.listeners = []
    this.event = (listener) => {
      this.listeners.push(listener)
      return { dispose: () => {} }
    }
  }
  fire(value) {
    for (const listener of this.listeners) listener(value)
  }
  dispose() {}
}

export const WebviewViewProvider = undefined
export const Disposable = undefined
