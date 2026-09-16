/**
 * 宿主能力桥（#65 批 1；#84 起同时是「宿主能力口」在 VS Code 侧的实现）——装配页里
 * 的自有插件向扩展宿主请求「只有宿主能做的事」（git 二进制、VS Code API、文件保存
 * 对话框），走一条请求-响应消息通道：
 *
 *   页面 → 宿主：{ type: 'dshOne.hostCall', call: '<白名单名>', args: <对象>, id: <调用方生成> }
 *   宿主 → 页面：{ type: 'dshOne.hostResult', id: <回声>, ok: true, data } 或
 *                { type: 'dshOne.hostResult', id: <回声>, ok: false, error: { code, message } }
 *
 * 前端插件不直接走这条通道，而是调**能力口**（`src/ui/assembly/shell/hostCapabilities.ts`）：
 * 能力口在 VS Code 侧把调用落到本桥的白名单调用上，在官方 web 侧落到宿主半插件的
 * 网关 RPC 上——插件代码两端一样（#84）。所以下面每个 `call` 名字都对应能力口里的
 * 一个方法，两边同名同参数。
 *
 * 走第几层机制：这条桥是 dsh-one 自有外壳与自有插件之间的通道，不触碰任何官方
 * 组件（官方机制层 1-3 都不涉及宿主能力；官方也没有「插件向宿主取 git 数据」
 * 的接缝）。通道复用既有统一获取点 `__DSH_ONE_VSCODE__`（probe.ts 首调
 * acquireVsCodeApi 后挂的共享实例，webview 全页只允许 acquire 一次）。
 *
 * 安全（这是外部输入进入宿主的唯一入口，按白名单 + 参数校核 + 结构化错误收口）：
 * - **白名单**：call 名不在 HOST_CALLS 表里一律 unknown-call，绝不动态转发；
 * - **参数校核**：每个调用自校验参数形状（git hash 正则、URL 协议白名单、
 *   cwd 归属、下载路径必须本站绝对路径），不合法即 invalid-args 且不执行任何外部命令；
 * - **不拼 shell**：git 一律 execFile（argv 数组），不做字符串拼接——参数校核
 *   是第一道防线，argv 传递本身也杜绝了 shell 注入；
 * - **路径限域**：调用方给的 cwd 只允许落在三类允许根内——VS Code 工作区目录、
 *   ~/.dsh、以及网关 `workspace/list` 注册的 dsh 工作区路径（宿主取一次并缓存，
 *   见 hostWorkspaceRoots.ts）；判定一律走 realpath 后的包含关系，防 ../ 逃逸与
 *   符号链接逃逸。cwd 越界时**回落** VS Code 工作区目录（拿不到会话工作区也要能
 *   查，不是放宽信任：越界路径绝不被采用）；
 * - **结构化错误**：回执只有 { code, message }，message 不含命令行原文。
 */
import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../../log.ts'
import { queryCommitInWorkspace } from '../../pure/gitWorkspaceQuery.ts'
import {
  asRecord,
  isHostCallError,
  parseAllowedUrl,
  parseGitShowArgs,
  resolveQueryDir,
  type HostCallError,
} from '../../pure/hostCalls.ts'
import type { DownloadArgs, HostCapabilityError, SaveFileArgs } from '../../pure/hostCapabilities.ts'
import { parseStateKey, parseStateValue } from '../../pure/hostCapabilities.ts'
import { deleteState, readState, writeState } from '../../../packages/dsh-host-capabilities/src/stateStore.ts'
import { performGatewayDownload, performSaveContent } from '../../pure/hostDownload.ts'
import type { CommitInfoResult } from '../../pure/chatContract.ts'
import type { GitWorkspaceQueryResult } from '../../pure/gitWorkspaceQuery.ts'

export { isHostCallError } from '../../pure/hostCalls.ts'
export type { HostCallErrorCode, HostCallError } from '../../pure/hostCalls.ts'

/**
 * 调用名白名单（新增能力必须同时登记参数校核与实现；**失去全部消费者的调用
 * 就地删除**——`vscode.openInBuiltinBrowser` 随右键菜单收缩一并移除，见 #65）。
 * 名字与能力口的方法一一对应（见 `src/ui/assembly/shell/hostCapabilities.ts` 的能力表）。
 */
export const HOST_CALLS = {
  'git.show': 'One commit (hash + author + message + shortstat + GitHub link) from the git CLI.',
  'vscode.openExternal': 'Open a http/https/mailto URL with the system browser (git card "Open on GitHub").',
  'file.download': 'Fetch content from the connected dsh gateway by path and save it where the user chooses.',
  'file.save': 'Write base64 content to a file where the user chooses.',
  'state.read': 'Read one plugin state value (the host half\'s own state store, ~/.dsh/dsh-one/<key>.json).',
  'state.write': 'Write one plugin state value (same store, atomic write).',
  'state.delete': 'Delete one plugin state value (same store).',
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

/** 宿主能力桥依赖（工作区根、git 可执行文件路径、日志、落盘三件套）。 */
export interface HostBridgeDeps {
  /** 允许 git 执行的工作目录来源（VS Code 工作区目录）。 */
  workspaceFolders: () => readonly string[]
  /** dsh 配置目录（~/.dsh）——路径限域的另一半。 */
  dshHome: string
  /**
   * 追加的允许根（网关注册的 dsh 工作区路径，见 hostWorkspaceRoots.ts）。
   * 缺省无追加；取不到时实现方返回空表，不影响其余允许根。
   */
  extraAllowedRoots?: () => Promise<readonly string[]>
  /** git 可执行文件（测试可注入假路径）。 */
  gitPath?: string
  /** 命令超时（毫秒）。 */
  timeoutMs?: number
  /** 诊断日志（写输出面板；git 查询的扫描/超时留痕用）。 */
  log?: (line: string) => void
  /**
   * 网关内容来源（loopback mirror 的源；`file.download` 用）。取不到（服务没跑、
   * 面板已关）时该调用回 `unsupported`——不静默拿别的地址去取。
   */
  gatewayOrigin?: () => string | undefined
  /** 选择保存位置（缺省弹 VS Code 保存对话框；测试注入假件）。返回 null = 用户取消。 */
  chooseSavePath?: (suggestedName: string) => Promise<string | null>
  /** 落盘（缺省 fs.writeFile；测试注入假件）。 */
  writeBytes?: (target: string, data: Uint8Array) => Promise<void>
  /** 用户提示（缺省 VS Code 消息框；测试注入假件）。 */
  notify?: (level: 'info' | 'error', message: string) => void
  /** 取网关内容（缺省 fetch；测试注入假件）。 */
  fetchGateway?: (url: string, init?: { method: string }) => Promise<Response>
}

/**
 * git.show 的实现：路径限域 → 在工作区里找这条提交。
 *
 * 「找」包含两级候选根：先查会话工作区根（快路径），落空再**有界发现**工作区内的
 * 子目录仓库逐个查（工作区根不是 git 仓库、仓库在子目录里时是唯一能命中的路径，
 * 见 pure/gitWorkspaceQuery.ts）。子目录天然落在允许根之内，realpath 包含判定
 * 已在 resolveQueryDir 里做过，所以发现动作不需要新的授权。
 */
async function gitShow(args: { hash: string; cwd?: string }, deps: HostBridgeDeps): Promise<GitWorkspaceQueryResult | HostCallError> {
  const folders = deps.workspaceFolders()
  const extra = deps.extraAllowedRoots === undefined ? [] : await deps.extraAllowedRoots()
  const allowedRoots = [...folders, deps.dshHome, ...extra]
  const resolved = await resolveQueryDir(args.cwd, folders[0], allowedRoots)
  if (resolved === null) {
    return { code: 'no-workspace', message: 'no usable directory: the session workspace and the VS Code workspace folders are both unavailable' }
  }
  // 会话工作区被拒/缺失时回落 VS Code 工作区：写一条日志（真窗里靠它定位「为什么
  // 查的是别的目录」——#65 返修 3 的现场就是这么被埋住的）。
  if (!resolved.usedRequested && args.cwd !== undefined && args.cwd !== '') {
    deps.log?.(`[assembly] git.show: session workspace ${args.cwd} not in the allowed roots; falling back to ${resolved.dir}`)
  }
  const info = await queryCommitInWorkspace(args.hash, resolved.dir, {
    ...(deps.gitPath === undefined ? {} : { gitPath: deps.gitPath }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  })
  if (info === undefined) return { code: 'git-missing', message: 'the git executable could not be started' }
  return info
}

/**
 * `file.download`：把网关某条路径的内容交给用户（VS Code 里 = 保存对话框 + 写盘）。
 *
 * 为什么不让页面自己下载：webview 的源是 `vscode-webview://`，裸 fetch 非 http 源
 * 直接失败，`a[download]` 也被禁；能取到网关内容的只有宿主（经 loopback mirror，
 * 鉴权 cookie 在代理侧加）。所以这条能力的语义是「取内容 + 交给用户」，不是「给我字节」。
 *
 * 流程与安全检查在 `src/pure/hostDownload.ts`（纯逻辑，可单测）；这里只提供 VS Code
 * 的三件套（取内容 / 保存框 / 写盘）与用户提示。
 */
async function fileDownload(args: DownloadArgs, deps: HostBridgeDeps): Promise<{ path: string } | HostCapabilityError> {
  const result = await performGatewayDownload(args, {
    ...(deps.gatewayOrigin === undefined ? {} : { gatewayOrigin: deps.gatewayOrigin }),
    ...(deps.fetchGateway === undefined ? {} : { fetchImpl: deps.fetchGateway }),
    chooseSavePath: deps.chooseSavePath ?? defaultChooseSavePath,
    writeBytes: deps.writeBytes ?? defaultWriteBytes,
  })
  notifyResult(result, deps)
  return result
}

/** `file.save`：把页面给的 base64 内容落到用户选的位置。 */
async function fileSave(args: SaveFileArgs, deps: HostBridgeDeps): Promise<{ path: string } | HostCapabilityError> {
  const result = await performSaveContent(args, {
    chooseSavePath: deps.chooseSavePath ?? defaultChooseSavePath,
    writeBytes: deps.writeBytes ?? defaultWriteBytes,
  })
  notifyResult(result, deps)
  return result
}

/**
 * 用户提示：成功报落点，失败报原因，**取消不报**（用户自己按的取消）。
 * 文案沿用既有导出那几条 l10n key，不新增词条。
 */
function notifyResult(result: { path: string } | HostCapabilityError, deps: HostBridgeDeps): void {
  const notify = deps.notify ?? defaultNotify
  if ('path' in result) {
    notify('info', vscode.l10n.t('Session log exported to {0}', result.path))
    return
  }
  if (result.code === 'cancelled') return
  notify('error', vscode.l10n.t('Session export failed: {0}', result.message))
}

/** 默认保存位置选择：VS Code 保存对话框（默认落在 ~/Downloads）。 */
async function defaultChooseSavePath(suggestedName: string): Promise<string | null> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', suggestedName)),
    saveLabel: vscode.l10n.t('Export session log'),
  })
  return target === undefined ? null : target.fsPath
}

/** 默认落盘。 */
async function defaultWriteBytes(target: string, data: Uint8Array): Promise<void> {
  await fs.writeFile(target, data)
}

/** 默认提示（与既有导出提示同一条 l10n key）。 */
function defaultNotify(level: 'info' | 'error', message: string): void {
  if (level === 'info') void vscode.window.showInformationMessage(message)
  else void vscode.window.showErrorMessage(message)
}

/**
 * 执行一次能力调用（白名单 → 参数校核 → 实现）。便于单测的纯入口：任何异常
 * 都由调用方收成 { code: 'failed' } 回执，绝不把堆栈抛回页面。
 */
export async function runHostCall(
  call: string,
  args: unknown,
  deps: HostBridgeDeps,
): Promise<CommitInfoResult | { path: string } | { value?: unknown; deleted?: boolean } | null | HostCapabilityError> {
  if (!(call in HOST_CALLS)) {
    return { code: 'unknown-call', message: `unknown host call: ${call}` }
  }
  if (call === 'git.show') {
    const parsed = parseGitShowArgs(args)
    return isHostCallError(parsed) ? parsed : await gitShow(parsed, deps)
  }
  if (call === 'file.download') {
    return await fileDownload(args as DownloadArgs, deps)
  }
  if (call === 'file.save') {
    return await fileSave(args as SaveFileArgs, deps)
  }
  if (call === 'state.read' || call === 'state.write' || call === 'state.delete') {
    return await stateCall(call, args, deps)
  }
  const url = parseAllowedUrl(asRecord(args)?.url)
  if (url === null) {
    return { code: 'invalid-args', message: 'expected a http/https/mailto url' }
  }
  // 只剩 vscode.openExternal 一项（url 已在上面校核过协议）
  await vscode.env.openExternal(vscode.Uri.parse(url))
  return null
}

/**
 * `state.read` / `state.write` / `state.delete`（#82）：插件的持久状态。
 *
 * **实现就是宿主半那一份**：直接 import
 * `packages/dsh-host-capabilities/src/stateStore.ts`——官方 web 侧跑的是宿主半的
 * `stateRead/stateWrite/stateDelete`，VS Code 侧跑的是同一个模块的同一组函数，
 * 所以「同一份用户数据只有一个家、一套代码」（AGENTS.md 铁律「插件状态按官方惯例
 * 存储」）在两端都成立：家是 `~/.dsh/dsh-one/<键>.json`（宿主半定义的路径与原子写），
 * 代码是宿主半包里的那一份。
 *
 * 为什么 VS Code 侧不干脆走网关 RPC 让宿主半自己处理（那样调用方只有一条路径）：
 * 宿主半目前还没进 VS Code 用的那个 profile（#84 的已知遗留①），走网关会在没装
 * 它的实例上直接 404，插件状态当场失效。这里让扩展宿主**代行同一个实现**，行为与
 * 官方侧逐字一致、且不依赖 profile 里有没有那个包；等宿主半随扩展分发落地后，
 * 这条分支可以退化成纯转发（或整个删掉），插件侧一行都不用改。
 *
 * 安全：键的形状由 `parseStateKey` 收口（只允许 `[a-z0-9._-]`，禁 `..`），
 * 那是唯一决定文件名的输入；值必须能 JSON 序列化（`parseStateValue`）。
 */
async function stateCall(
  call: 'state.read' | 'state.write' | 'state.delete',
  args: unknown,
  deps: HostBridgeDeps,
): Promise<{ value?: unknown; deleted?: boolean } | HostCapabilityError> {
  const record = asRecord(args)
  if (record === undefined) return { code: 'invalid-args', message: 'expected an object argument' }
  const key = parseStateKey(record.key)
  if (typeof key !== 'string') return key
  const home = deps.dshHome
  try {
    if (call === 'state.read') return { value: await readState(key, home) }
    if (call === 'state.delete') return { deleted: await deleteState(key, home) }
    const serialized = parseStateValue(record.value)
    if (typeof serialized !== 'string') return serialized
    await writeState(key, serialized, home)
    return {}
  } catch (err) {
    return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 默认依赖（生产）：工作区目录 + ~/.dsh（追加允许根由调用方给，见 assemblyView）。
 */
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
