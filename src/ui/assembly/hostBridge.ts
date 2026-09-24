/**
 * 宿主调用通道（#65 批 1；#84 起同时是「宿主能力口」在 VS Code 侧的实现）——装配页里
 * 的自有插件向扩展宿主请求「只有宿主能做的事」（git 二进制、VS Code API、文件保存
 * 对话框），走一条请求-响应消息通道：
 *
 *   页面 → 宿主：{ type: 'dshOne.hostCall', call: '<白名单名>', args: <对象>, id: <调用方生成> }
 *   宿主 → 页面：{ type: 'dshOne.hostResult', id: <回声>, ok: true, data } 或
 *                { type: 'dshOne.hostResult', id: <回声>, ok: false, error: { code, message } }
 *
 * 前端插件不直接走这条通道，而是调**能力口**（`packages/dsh-plugin-kit/src/hostCapabilities.ts`）：
 * 能力口在 VS Code 侧把调用落到本通道的白名单调用上，在官方 web 侧落到宿主半插件的
 * 网关 RPC 上——插件代码两端一样（#84）。所以下面每个 `call` 名字都对应能力口里的
 * 一个方法，两边同名同参数。
 *
 * 走第几层机制：这一条是 dsh-one 自有外壳与自有插件之间的通道，不触碰任何官方
 * 组件（官方机制层 1-3 都不涉及宿主能力；官方也没有「插件向宿主取 git 数据」
 * 的 seam）。通道复用既有统一获取点 `__DSH_ONE_VSCODE__`（probe.ts 首调
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
  parseNoArgs,
  parseOpenFolderArgs,
  parseOpenTerminalArgs,
  parseSessionInPanelArgs,
  parseSessionNewInWorkspaceArgs,
  parseSessionOpenPanelArgs,
  parseSessionTabArgs,
  resolveQueryDir,
  type HostCallError,
} from '../../pure/hostCalls.ts'
import type { DownloadArgs, HostCapabilityError, SaveFileArgs } from '../../pure/hostCapabilities.ts'
import type { OpenFolderArgs, OpenTerminalArgs } from '../../pure/hostCalls.ts'
import { runStateCall } from '../../pure/hostStateCalls.ts'
import { performGatewayDownload, performSaveContent } from '../../pure/hostDownload.ts'
import type { CommitInfoResult } from '../../pure/chatContract.ts'
import type { GitWorkspaceQueryResult } from '../../pure/gitWorkspaceQuery.ts'

export { isHostCallError } from '../../pure/hostCalls.ts'
export type { HostCallErrorCode, HostCallError } from '../../pure/hostCalls.ts'

/**
 * 调用名白名单（新增能力必须同时登记参数校核与实现；**失去全部消费者的调用
 * 就地删除**——`vscode.openInBuiltinBrowser` 随右键菜单收缩一并移除，见 #65）。
 * 名字与能力口的方法一一对应（见 `packages/dsh-plugin-kit/src/hostCapabilities.ts` 的能力表）。
 */
export const HOST_CALLS = {
  'git.show': 'One commit (hash + author + message + shortstat + GitHub link) from the git CLI.',
  'vscode.openExternal': 'Open a http/https/mailto URL with the system browser (git card "Open on GitHub").',
  'file.download': 'Fetch content from the connected dsh gateway by path and save it where the user chooses.',
  'file.save': 'Write base64 content to a file where the user chooses.',
  'state.read': 'Read one plugin state value (the host half\'s own state store, ~/.dsh/dsh-one/<key>.json).',
  'state.write': 'Write one plugin state value (same store, atomic write).',
  'state.delete': 'Delete one plugin state value (same store).',
  'session.openInNewTab': 'Open one session in its own editor tab (explicit multi-open; the chat panel stays a singleton).',
  'session.inPanel': 'Whether one session is currently shown by this host\'s chat panel (the sidebar row\'s rename-vs-open decision, #121).',
  'session.panelSessions': 'Which sessions this host\'s chat panels are currently showing (the sidebar\'s "finished but not opened" status dot, #147).',
  'session.openPanel': 'Show one session in this host\'s chat panel (create / reveal / switch in place; #121).',
  'session.newInWorkspace': 'Create a new session in one workspace and open it (the sidebar + menu after adding a workspace, #176).',
  'vscode.openSettings': 'Open (or focus) the dsh-one settings editor page (the sidebar toolbar gear, #99).',
  'vscode.openPlugins': "Open (or focus) the official Plugins panel as its own dsh-one editor page (the sidebar's Plugins row, #247).",
  'vscode.workspaceCreate': 'Create a workspace directory (~/.dsh/workspaces/<name>) and register it (the sidebar + menu, #99; returns the registered workspace id, #176).',
  'vscode.workspaceFolders': 'List the folders this VS Code window has open (the sidebar tree\'s current-workspace badge and pinning, #112).',
  'vscode.openFolder': 'Open one workspace folder in the editor window (the sidebar workspace row, #109; optionally in a new window).',
  'vscode.openTerminal': 'Open an integrated terminal at one workspace folder (the sidebar workspace row, #109).',
} as const

/** 宿主→页面的回执消息。 */
export interface HostCallResult {
  type: 'dshOne.hostResult'
  id: string
  ok: boolean
  data?: unknown
  error?: HostCallError
}

/** 宿主调用通道依赖（工作区根、git 可执行文件路径、日志、落盘三件套）。 */
export interface HostBridgeDeps {
  /**
   * VS Code 当前打开的文件夹（`vscode.workspace.workspaceFolders` 的 fsPath 列表）。
   * 两个用途：① 允许 git 执行的工作目录来源；② `vscode.workspaceFolders` 调用把它
   * 原样回给页面（侧栏树的「当前工作区」判定，#112）。
   */
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
  /**
   * 「在新标签页打开」（#72 多开通道）：为某会话开一个独立面板。装配视图提供
   * 实现（面板与共享 mirror 的生命周期都在那里）；缺省无实现 = `unsupported`
   * ——官方 web 形态的侧栏树本来也不会显示这个菜单项（见能力口的 `editorTabs`）。
   */
  openSessionInNewTab?: (sessionId: string) => void
  /**
   * 这个会话现在是不是正开在宿主的面板里（#121）：侧栏树据此判「点当前会话行 = 就地
   * 改名还是按打开处理」。装配视图提供实现（面板与会话的跟踪都在那里）；缺省无实现
   * = `unsupported`——调用方（侧栏树）把答不出来一律当「没开」，处置就是按打开处理。
   */
  sessionInPanel?: (sessionId: string) => boolean
  /**
   * 把对话面板亮到这个会话（#121）：创建 / 聚焦 / 就地切换，语义与侧栏点会话那条
   * 通路（`dshOne.sessionSelected` → `openSessionChat`）完全一样。装配视图提供实现；
   * 缺省无实现 = `unsupported`。
   *
   * 为什么必须有这一条：会话已经是官方那条打开入口的「当前」时，再打开它不会让值变，
   * 选择桥（sessionBridgePlugin）也就不会上报，光靠那条路面板永远不出来——用户报的
   * 「启动后点当前会话，右边对话区一直不出来」正是这个现场。
   */
  openSessionPanel?: (sessionId: string) => void
  /**
   * 面板里现在开着哪些会话（#147）：侧栏树渲染「跑完还没被打开」那颗绿点时要把这份
   * 事实算进判据。装配视图提供实现（面板↔会话的跟踪都在那里）；缺省无实现 =
   * `unsupported`——调用方按空表处理（不抑制任何提醒），与官方 web 侧同一个降级方向。
   *
   * 为什么不能只靠推送：侧栏页可能比面板晚起来（页面重挂、视图重建），那一刻的事实
   * 用一条主动查询取回来，才不会漏；之后的变化由 `dshOne.panelSessions` 广播继续推
   * （见 `pure/sessionPanelRouting.ts` 的 `PANEL_SESSIONS_MESSAGE`）。
   */
  panelSessions?: () => readonly string[]
  /**
   * 打开（或聚焦）设置页（#99 顶栏齿轮）。装配视图提供实现（设置页的注册与
   * 生命周期都在那里）；缺省无实现 = `unsupported`。
   */
  openSettings?: () => void
  /**
   * 打开（或聚焦）插件页（#247 官方「插件」全局面板）。装配视图提供实现（插件页的
   * 注册与生命周期都在那里）；缺省无实现 = `unsupported`——调用方（侧栏树的
   * layout 服务）在那一端本来就不会走到这条路（官方 web 由官方外框自己渲染那一页）。
   */
  openPlugins?: () => void
  /**
   * 建一个新工作区目录并注册（#99 顶栏 ＋ 菜单第二项）。装配视图提供实现
   * （转发到既有 `dshOne.workspace.create` 命令，宿主原生输入框 + 建目录 + 注册）；
   * 缺省无实现 = `unsupported`。
   *
   * **返回值就是那条命令的返回值**（`WorkspaceView`；#176 起不再丢掉）：调用方
   * 从这里取新工作区的 id 与名字，`undefined` = 用户取消（不是失败，命令自己会
   * 在失败时弹错误提示）。
   */
  createWorkspaceDirectory?: () => Promise<unknown>
  /**
   * 在这个工作区里新建一条会话并打开（#176：侧栏 ＋ 菜单添加/创建完工作区之后）。
   * 装配视图提供实现（转发到既有 `dshOne.session.new` 命令——原来的 `workspace.add` /
   * `workspace.create` 语义不动，老侧栏「只添加不建会话」的行为照旧）；缺省无实现
   * = `unsupported`，而能力口在官方 web 侧如实上报「没有这条」，那一端就不开会话。
   */
  newSessionInWorkspace?: (workspaceId: string) => void
  /**
   * 在编辑器窗口里打开一个工作区文件夹（#109 工作区行：hover 的「在 VS Code 打开」
   * 用 `newWindow: false`，右键的「在新窗口打开文件夹」用 `true`）。装配视图提供
   * 实现（转发到既有 `dshOne.workspace.openFolder` 命令）；缺省无实现 = `unsupported`
   * ——官方 web 形态的侧栏树本来也不会显示这两个入口（见能力口的 `workspaceOpen`）。
   */
  openFolder?: (args: OpenFolderArgs) => Promise<unknown> | void
  /**
   * 在一个工作区目录上开集成终端（#109 工作区行 hover 的「终端打开」）。装配视图
   * 提供实现（转发到既有 `dshOne.workspace.openTerminal` 命令）；缺省无实现 =
   * `unsupported`。
   */
  openTerminal?: (args: OpenTerminalArgs) => void
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
): Promise<
  | CommitInfoResult
  | { path: string }
  | { value?: unknown; deleted?: boolean }
  | { paths: readonly string[] }
  | { sessionIds: readonly string[] }
  | { open: boolean }
  | { workspaceId: string | null; title?: string }
  | null
  | HostCapabilityError
> {
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
  if (call === 'session.openInNewTab') {
    const parsed = parseSessionTabArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.openSessionInNewTab === undefined) {
      return { code: 'unsupported', message: 'this host has no editor tabs to open a session in' }
    }
    deps.openSessionInNewTab(parsed.sessionId)
    return null
  }
  // #121：会话行点击的两条——「这个会话开在面板里吗」（改名判据的真条件）与
  // 「把面板亮到这个会话」（已开面板不会跟着官方那条打开入口走，得单独请宿主亮一下）。
  if (call === 'session.inPanel') {
    const parsed = parseSessionInPanelArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.sessionInPanel === undefined) {
      return { code: 'unsupported', message: 'this host has no chat panel to track a session in' }
    }
    return { open: deps.sessionInPanel(parsed.sessionId) }
  }
  if (call === 'session.openPanel') {
    const parsed = parseSessionOpenPanelArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.openSessionPanel === undefined) {
      return { code: 'unsupported', message: 'this host has no chat panel to open a session in' }
    }
    // 不开 await：开面板要等网关与页面起来（秒级），页面侧这是「发出去就完事」的动作。
    deps.openSessionPanel(parsed.sessionId)
    return null
  }
  // #147：面板里现在开着哪些会话（侧栏树渲染「跑完还没被打开」那颗绿点时要吃这份
  // 事实）。无参调用，回执形状 `{ sessionIds: string[] }`——空表是正常回执（一条都
  // 没开），与「能力不存在」在页面侧同义：都不抑制任何提醒。
  if (call === 'session.panelSessions') {
    const rejected = parseNoArgs(call, args)
    if (rejected !== undefined) return rejected
    if (deps.panelSessions === undefined) {
      return { code: 'unsupported', message: 'this host has no chat panel to track sessions in' }
    }
    return { sessionIds: deps.panelSessions().filter((id) => id !== '') }
  }
  if (call === 'vscode.openSettings') {
    // 无参调用：多带参数说明调用方与契约不同步，直接拒（同其余能力的口径）。
    const rejected = parseNoArgs(call, args)
    if (rejected !== undefined) return rejected
    if (deps.openSettings === undefined) {
      return { code: 'unsupported', message: 'this host serves no separate settings page' }
    }
    deps.openSettings()
    return null
  }
  // #247：官方那个「插件」全局面板在 VS Code 侧的独立编辑器页（侧栏那一行点击的落点，
  // 见 sidebarLayoutPlugin 的 openPanel 处置）。与 openSettings 同一形态与同一套口径。
  if (call === 'vscode.openPlugins') {
    const rejected = parseNoArgs(call, args)
    if (rejected !== undefined) return rejected
    if (deps.openPlugins === undefined) {
      return { code: 'unsupported', message: 'this host serves no separate plugins page' }
    }
    deps.openPlugins()
    return null
  }
  if (call === 'vscode.workspaceCreate') {
    const rejected = parseNoArgs(call, args)
    if (rejected !== undefined) return rejected
    if (deps.createWorkspaceDirectory === undefined) {
      return { code: 'unsupported', message: 'this host cannot create a workspace directory' }
    }
    // #176：命令的返回值（新注册的 workspace）从此**原样带给页面**——页面要靠它
    // 打开该工作区的新会话、并在被分组过滤挡住时点名提示。原来那一版把它丢了。
    return newWorkspaceOf(await deps.createWorkspaceDirectory())
  }
  // #176：添加/创建工作区之后，在这个工作区里开一条新会话并打开它。走的是既有的
  // `dshOne.session.new` 命令（建会话 + 开对话页），不动 `workspace.add/create` 的
  // 语义——老侧栏「只添加、不建会话」的既有行为一字未改。
  if (call === 'session.newInWorkspace') {
    const parsed = parseSessionNewInWorkspaceArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.newSessionInWorkspace === undefined) {
      return { code: 'unsupported', message: 'this host cannot start a session in a workspace' }
    }
    deps.newSessionInWorkspace(parsed.workspaceId)
    return null
  }
  // #112：VS Code 当前打开的文件夹路径表——侧栏树的「当前工作区」（蓝色徽标 + 置顶）
  // 按它判定。无参调用，回执形状 `{ paths: string[] }`。
  if (call === 'vscode.workspaceFolders') {
    const rejected = parseNoArgs(call, args)
    if (rejected !== undefined) return rejected
    // 空表是**正常回执**（这个窗口没开任何文件夹），与「能力不存在」在页面侧同义：
    // 都是「没有当前工作区」——页面不区分，也不必区分。
    return { paths: deps.workspaceFolders().filter((folder) => folder !== '') }
  }
  // #109：工作区行的两个宿主动作。缺实现（官方 web 形态）回 `unsupported`——那一端
  // 的侧栏树靠能力口的 `workspaceOpen` / `workspaceTerminal` 判定，入口本来就不渲染。
  if (call === 'vscode.openFolder') {
    const parsed = parseOpenFolderArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.openFolder === undefined) {
      return { code: 'unsupported', message: 'this host has no editor window to open a folder in' }
    }
    await deps.openFolder(parsed)
    return null
  }
  if (call === 'vscode.openTerminal') {
    const parsed = parseOpenTerminalArgs(args)
    if (isHostCallError(parsed)) return parsed
    if (deps.openTerminal === undefined) {
      return { code: 'unsupported', message: 'this host has no integrated terminal' }
    }
    deps.openTerminal(parsed)
    return null
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
 * 从「建目录并注册」那条命令的返回值里取新工作区（#176）。
 *
 * 命令给的是 `WorkspaceView`（`ensureWorkspace` 的产物，`dshRpc.ts`），所以这里
 * 读 `workspaceId` 与 `title`；`workspaceId` 取不到（用户取消、或将来形状变了）
 * 就回 `{ workspaceId: null }`——调用方按「这次没有新工作区」处置，不报错。
 */
function newWorkspaceOf(value: unknown): { workspaceId: string | null; title?: string } {
  const record = asRecord(value)
  const workspaceId = record?.workspaceId
  if (typeof workspaceId !== 'string' || workspaceId === '') return { workspaceId: null }
  const title = record?.title
  return typeof title === 'string' && title !== '' ? { workspaceId, title } : { workspaceId }
}

/**
 * `state.read` / `state.write` / `state.delete`（#82）：插件的持久状态。
 *
 * **实现就是宿主半那一份**：逻辑在 `src/pure/hostStateCalls.ts`，它直接调用
 * `packages/dsh-host-capabilities/src/stateStore.ts` 的函数——官方 web 侧跑的是宿主半
 * 的同一组函数，所以「同一份用户数据只有一个家、一套代码」（AGENTS.md 铁律「插件状态
 * 按官方惯例存储」）在两端都成立：家是 `~/.dsh/dsh-one/<键>.json`（宿主半定义的路径与
 * 原子写），代码是宿主半包里的那一份。
 *
 * 为什么 VS Code 侧不干脆走网关 RPC 让宿主半自己处理（那样调用方只有一条路径）：
 * 宿主半目前还没进 VS Code 用的那个 profile（#84 的已知遗留①），走网关会在没装
 * 它的实例上直接 404，插件状态当场失效。这里让扩展宿主**代行同一个实现**，行为与
 * 官方侧逐字一致、且不依赖 profile 里有没有那个包；等宿主半随扩展分发落地后，
 * 这条分支可以退化成纯转发（或整个删掉），插件侧一行都不用改。
 */
async function stateCall(
  call: 'state.read' | 'state.write' | 'state.delete',
  args: unknown,
  deps: HostBridgeDeps,
): Promise<{ value?: unknown; deleted?: boolean } | HostCapabilityError> {
  return await runStateCall(call, args, deps.dshHome)
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
 * 把宿主调用通道挂到一条装配 webview 上：收 dshOne.hostCall，跑白名单调用，回
 * dshOne.hostResult。四棵树（chat/侧栏/设置/插件页）都挂同一份（能力是通用基础设施，
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
    // id/call 形状不对就静默丢弃（无法可靠回执，且不是本通道的正常流量）。
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
