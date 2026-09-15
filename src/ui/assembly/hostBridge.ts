/**
 * 宿主能力桥（#65 批 1）——装配页里的自有插件向扩展宿主请求「只有宿主能做的事」
 * （git 二进制、VS Code API），走一条请求-响应消息通道：
 *
 *   页面 → 宿主：{ type: 'dshOne.hostCall', call: '<白名单名>', args: <对象>, id: <调用方生成> }
 *   宿主 → 页面：{ type: 'dshOne.hostResult', id: <回声>, ok: true, data } 或
 *                { type: 'dshOne.hostResult', id: <回声>, ok: false, error: { code, message } }
 *
 * 走第几层机制：这条桥是 dsh-one 自有外壳与自有插件之间的通道，不触碰任何官方
 * 组件（官方机制层 1-3 都不涉及宿主能力；官方也没有「插件向宿主取 git 数据」
 * 的接缝）。通道复用既有统一获取点 `__DSH_ONE_VSCODE__`（probe.ts 首调
 * acquireVsCodeApi 后挂的共享实例，webview 全页只允许 acquire 一次）。
 *
 * 安全（这是外部输入进入宿主的唯一入口，按白名单 + 参数校核 + 结构化错误收口）：
 * - **白名单**：call 名不在 HOST_CALLS 表里一律 unknown-call，绝不动态转发；
 * - **参数校核**：每个调用自校验参数形状（git hash 正则、URL 协议白名单、
 *   cwd 归属），不合法即 invalid-args 且不执行任何外部命令；
 * - **不拼 shell**：git 一律 execFile（argv 数组），不做字符串拼接——参数校核
 *   是第一道防线，argv 传递本身也杜绝了 shell 注入；
 * - **路径限域**：调用方给的 cwd 只允许落在 VS Code 工作区目录或 ~/.dsh 内
 *   （realpath 后的包含判定，防 ../ 逃逸与符号链接逃逸）；
 * - **结构化错误**：回执只有 { code, message }，message 不含命令行原文。
 */
import * as vscode from 'vscode'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../../log.ts'
import { runGitShow } from '../../pure/gitShowCommand.ts'
import {
  asRecord,
  isHostCallError,
  parseAllowedUrl,
  parseGitShowArgs,
  resolveAllowedDir,
  type HostCallError,
} from '../../pure/hostCalls.ts'
import type { CommitInfoResult } from '../../pure/chatContract.ts'

export { isHostCallError } from '../../pure/hostCalls.ts'
export type { HostCallErrorCode, HostCallError } from '../../pure/hostCalls.ts'

/** 调用名白名单（新增能力必须同时登记参数校核与实现）。 */
export const HOST_CALLS = {
  'git.show': 'One commit (hash + author + message + shortstat + GitHub link) from the git CLI.',
  'vscode.openExternal': 'Open a http/https/mailto URL with the system browser.',
  'vscode.openInBuiltinBrowser': 'Open a http/https URL in the VS Code built-in Simple Browser.',
} as const

export type HostCallName = keyof typeof HOST_CALLS

/** 页面→宿主的能力调用消息。 */
export interface HostCallMessage {
  type: 'dshOne.hostCall'
  call: string
  args: unknown
  id: string
}

/** 宿主→页面的回执消息。 */
export interface HostCallResult {
  type: 'dshOne.hostResult'
  id: string
  ok: boolean
  data?: unknown
  error?: HostCallError
}

/** 宿主能力桥依赖（工作区根、git 可执行文件路径、日志）。 */
export interface HostBridgeDeps {
  /** 允许 git 执行的工作目录来源（VS Code 工作区目录）。 */
  workspaceFolders: () => readonly string[]
  /** dsh 配置目录（~/.dsh）——路径限域的另一半。 */
  dshHome: string
  /** git 可执行文件（测试可注入假路径）。 */
  gitPath?: string
  /** 命令超时（毫秒）。 */
  timeoutMs?: number
}

/** git.show 的实现：路径限域 → git CLI 查提交（实现体见 pure/gitShowCommand.ts）。 */
async function gitShow(args: { hash: string; cwd?: string }, deps: HostBridgeDeps): Promise<CommitInfoResult | HostCallError> {
  const folders = deps.workspaceFolders()
  const wanted = args.cwd ?? folders[0]
  if (wanted === undefined) return { code: 'no-workspace', message: 'no workspace folder is open' }
  const dir = await resolveAllowedDir(wanted, [...folders, deps.dshHome])
  if (dir === null) {
    return { code: 'invalid-args', message: 'cwd is outside the workspace folders and ~/.dsh' }
  }
  const info = await runGitShow(args.hash, dir, {
    ...(deps.gitPath === undefined ? {} : { gitPath: deps.gitPath }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  })
  if (info === undefined) return { code: 'git-missing', message: 'the git executable could not be started' }
  return info
}

/**
 * 执行一次能力调用（白名单 → 参数校核 → 实现）。便于单测的纯入口：任何异常
 * 都由调用方收成 { code: 'failed' } 回执，绝不把堆栈抛回页面。
 */
export async function runHostCall(
  call: string,
  args: unknown,
  deps: HostBridgeDeps,
): Promise<CommitInfoResult | null | HostCallError> {
  if (!(call in HOST_CALLS)) {
    return { code: 'unknown-call', message: `unknown host call: ${call}` }
  }
  if (call === 'git.show') {
    const parsed = parseGitShowArgs(args)
    return isHostCallError(parsed) ? parsed : await gitShow(parsed, deps)
  }
  const url = parseAllowedUrl(asRecord(args)?.url)
  if (url === null) {
    return { code: 'invalid-args', message: 'expected a http/https/mailto url' }
  }
  if (call === 'vscode.openExternal') {
    await vscode.env.openExternal(vscode.Uri.parse(url))
    return null
  }
  // vscode.openInBuiltinBrowser：VS Code 内置 Simple Browser（命令面板同款命令）。
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', url)
  } catch {
    return { code: 'unsupported', message: 'the VS Code built-in browser is unavailable' }
  }
  return null
}

/** 默认依赖（生产）：工作区目录 + ~/.dsh。 */
export function defaultHostBridgeDeps(): HostBridgeDeps {
  return {
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    dshHome: path.join(os.homedir(), '.dsh'),
  }
}

/**
 * 把能力桥挂到一条装配 webview 上：收 dshOne.hostCall，跑白名单调用，回
 * dshOne.hostResult。三棵树（chat/侧栏/设置）都挂同一份（能力是通用基础设施，
 * 后续多项复用）。返回 Disposable。
 */
export function subscribeHostCalls(
  webview: vscode.Webview,
  logger: Logger,
  deps: HostBridgeDeps = defaultHostBridgeDeps(),
): vscode.Disposable {
  return webview.onDidReceiveMessage((msg: unknown) => {
    const record = asRecord(msg)
    if (record === undefined || record.type !== 'dshOne.hostCall') return
    const id = record.id
    const call = record.call
    // id/call 形状不对就静默丢弃（无法可靠回执，且不是本桥的正常流量）。
    if (typeof id !== 'string' || id === '' || typeof call !== 'string') return
    void runHostCall(call, record.args, deps)
      .then((result) => {
        if (isHostCallError(result)) {
          logger.warn(`host call ${call} rejected: ${result.code}`)
          void webview.postMessage({ type: 'dshOne.hostResult', id, ok: false, error: result } satisfies HostCallResult)
          return
        }
        void webview.postMessage({ type: 'dshOne.hostResult', id, ok: true, data: result } satisfies HostCallResult)
      })
      .catch((err: unknown) => {
        void webview.postMessage({
          type: 'dshOne.hostResult',
          id,
          ok: false,
          error: { code: 'failed', message: err instanceof Error ? err.message : String(err) },
        } satisfies HostCallResult)
      })
  })
}
