/**
 * 宿主能力口的**前端 SDK**（#84）：自有插件调宿主能力的唯一入口。
 *
 * 插件只写 `const caps = hostCapabilities(ctx)` 然后调 `caps.gitShow(...)` /
 * `caps.stateWrite(...)`，**不直接碰 VS Code API、不直接 postMessage、也不直接
 * 拼网关 RPC**——两侧的实现按能力各自配好（见下），所以同一份插件代码在 VS Code
 * 与官方 web 都能跑（AGENTS.md 铁律「能移植的必须移植」）。
 *
 * ## 每个能力的实现在哪一侧
 *
 * | 能力 | VS Code 侧 | 官方 web 侧 |
 * | --- | --- | --- |
 * | `gitShow` | 扩展宿主能力桥（`hostCall('git.show')`，安全口径在宿主侧） | 宿主半插件（网关 RPC） |
 * | `stateRead/Write/Delete` | 扩展宿主能力桥（**代行宿主半的同一份状态存储模块**） | **宿主半插件** |
 * | `saveContent` | 扩展宿主弹保存框写盘 | 宿主半插件写宿主磁盘 |
 * | `downloadGatewayFile` | 扩展宿主经 loopback 代理取内容 + 弹保存框 | 浏览器原生 `fetch` + `a[download]` |
 * | `openExternal` | 扩展宿主 `vscode.env.openExternal` | 页面原生 `window.open` |
 * | `openSessionInNewTab`（+ `editorTabs`） | 扩展宿主开一个 WebviewPanel（#72 多开） | **无**——官方 web 没有编辑器标签页，能力恒缺席 |
 * | `isSessionInPanel` / `openSessionPanel`（#121） | 扩展宿主按面板↔会话的跟踪如实回答 + 把面板亮到该会话 | **false / 静默空操作**——官方 web 没有「宿主面板」这个概念，那一端的「打开会话」就是官方 `sessions.open` |
 * | `onPanelSessions`（#147） | 扩展宿主先回一条快照（`session.panelSessions`），此后每次面板↔会话映射变化都广播 `dshOne.panelSessions` | **永不推送**（订阅返回一个退订函数、立刻回空集）——官方 web 那一端没有「宿主面板」这件事实，集合恒为空 = 不抑制任何提醒 |
 * | `openSettings`（+ `settingsPage`） | 扩展宿主开/聚焦设置页（设置独立成编辑器页，#70） | **无**——官方 web 的设置是官方底部那一行，没有独立设置页；能力恒缺席，侧栏齿轮在那一端不渲染 |
 * | `createWorkspaceDirectory`（+ `workspaceCreate`） | 扩展宿主建目录并注册（`dshOne.workspace.create` 命令：`~/.dsh/workspaces/<名>`） | **无**——官方 web 的「新建目录」归官方 directory-flow 占用者（见 #99 的说明），能力恒缺席 |
 * | `openWorkspaceFolder`（+ `workspaceOpen`） | 扩展宿主 `dshOne.workspace.openFolder` 命令（`vscode.openFolder`，可要求新窗口） | **无**——官方 web 是浏览器里的一页，没有「编辑器窗口」可以放这个文件夹，能力恒缺席 |
 * | `openWorkspaceTerminal`（+ `workspaceTerminal`） | 扩展宿主 `dshOne.workspace.openTerminal` 命令（VS Code 集成终端，cwd = 该文件夹） | **无**——同上，浏览器页里没有集成终端 |
 * | `currentWorkspaceFolders`（+ `loadCurrentFolders`） | 扩展宿主能力桥（`vscode.workspaceFolders` = `vscode.workspace.workspaceFolders` 的 fsPath 列表） | **空表**——浏览器里那一页根本没有「VS Code 打开的文件夹」这个概念（侧栏树的「当前工作区」判定读它，空表 = 没有当前工作区） |
 * | `shellName` | `'vscode'` | `'web'` |
 *
 * 四处刻意的取舍（写清楚免得后来人以为是漏配）：
 * 1. **状态两侧同一份实现与同一个家**（都是宿主半的状态存储模块，都落
 *    `~/.dsh/dsh-one/<键>.json`）：AGENTS.md 铁律「插件状态按官方惯例存储」
 *    ——同一份用户数据不能有两个家，否则必然漂移（#82 要清的就是这个）。
 *    VS Code 侧的桥调用**不是第二份实现**：扩展宿主 import 的是宿主半包里的
 *    `stateStore` 模块本体（见 `src/ui/assembly/hostBridge.ts` 的 `stateCall`），
 *    这么做的原因是宿主半还没进 VS Code 用的那个 profile（#84 的已知遗留①），
 *    走网关会在没装它的实例上 404、插件状态当场失效。
 * 2. **git 在 VS Code 侧仍走扩展宿主**：行为与今天逐字一致（同一份安全口径代码），
 *    官方侧由宿主半同一份安全口径实现，插件看不到差别；迁移 git-card 时不用动
 *    宿主侧（#83 表里 git-card 那一行的前置条件就是本件）。
 * 3. **`downloadGatewayFile` 官方侧走浏览器原生下载**：浏览器本来就能下载，走宿主
 *    反而绕远；宿主半的「写盘」能力（`saveContent`）管的是没有下载 UX 的场景。
 * 4. **`openExternal` 没有宿主半端点**（同 3 的道理，且更硬）：官方 web 的页面就是
 *    用户的浏览器，链接该在**用户眼前**打开；宿主半跑在 dsh 宿主进程里，远端/容器
 *    部署下它开的仍然是服务器那台机器的浏览器（用户什么也看不见）。所以官方侧用
 *    页面原生 `window.open`，协议白名单校核在下面这一处完成（两侧同一份
 *    `parseAllowedUrl`），VS Code 侧再交宿主 `vscode.env.openExternal`（它由客户端
 *    侧执行，远端场景同样正确）。
 * 5. **`openSessionInNewTab` 只是 VS Code 侧能力**：它要的是「编辑器标签页」这个
 *    容器，官方 web 是单页应用、没有对应的官方服务或接缝，宿主半也没有可暴露的
 *    动作（浏览器里开新标签页＝丢掉 dsh 客户端自己的会话状态）。所以这条不登记进
 *    `pure/hostCapabilities.ts` 的线协议契约：契约里的是「两端都该有」的能力，
 *    这条只有一端有，本来该由 `editorTabs` 如实上报缺席。
 *
 * ## 调用形态（走第几层机制）
 * 官方侧走**层 2（官方服务 API）**：`ctx.connection.rpc.call('/api', '<ns>/<方法>',
 * { args })` ——官方 Connection 的公开 RPC 口（类型见 `dsh-client-connection` 的
 * `ClientConnectionRpc.call`），与官方生成版客户端
 * （`dsh-api-gateway/lib/client.js`：`connection.rpc.call("/api", endpoint, { args })`）
 * 逐字同形。参数键必须与宿主半的方法形参名完全一致（官方网关 `assertExactArguments`
 * 校核，多余键直接拒），这条靠本模块与宿主半共用 `src/pure/hostCapabilities.ts`
 * 的同一份契约保证。
 *
 * 每个插件各自打包一份本模块（各插件是独立 bundle，没有共享模块作用域）——与
 * 同目录的 hostClient.ts 同一取舍，不为此单起一个 cordis 服务。
 */
import {
  capabilityEndpoint,
  isCapabilityFailure,
  parseAllowedUrl,
  type HostCapabilityErrorCode,
  type HostCapabilityMethod,
} from '../../../pure/hostCapabilities.ts'
import { parsePanelSessionsMessage } from '../../../pure/sessionPanelRouting.ts'
import type { CommitInfoResult } from '../../../pure/chatContract.ts'
import { hostCall, hostCallAvailable, type HostCallFailure } from './hostClient.ts'

/** 能力失败：`code` 是结构化错误码（消费方按 code 决定文案，不解析 message）。 */
export interface CapabilityFailure extends Error {
  code: HostCapabilityErrorCode
}

/** cordis ctx 在本模块用到的最小面（`ctx.get(name)` 读服务，无需 inject）。 */
export interface CapabilityContext {
  get(name: string): unknown
}

/** 官方 Connection 服务在本模块用到的最小面（公开 RPC 口）。 */
interface ConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>
}

/** 文档里写的「浏览器原生下载」结果的形状：`path` 为 null 表示由浏览器下载。 */
export interface DownloadResult {
  /** 宿主写盘后的绝对路径；浏览器原生下载时为 null（文件在用户的下载目录）。 */
  path: string | null
}

/** 能力口（插件拿到的对象）。 */
export interface HostCapabilities {
  stateRead(key: string): Promise<unknown>
  stateWrite(key: string, value: unknown): Promise<void>
  stateDelete(key: string): Promise<boolean>
  /** 查一条提交；查不到用结果里的 `found: false` 表达（与能力桥同一形状，不抛错）。 */
  gitShow(args: { hash: string; cwd?: string }): Promise<CommitInfoResult>
  saveContent(args: { suggestedName: string; base64: string }): Promise<{ path: string }>
  downloadGatewayFile(args: { path: string; suggestedName: string }): Promise<DownloadResult>
  /**
   * 用系统浏览器（VS Code 侧）或当前浏览器（官方 web 侧）打开一个外链。
   * URL 不合规（非 http/https/mailto）抛 `invalid-args`，两端同一处校核。
   */
  openExternal(url: string): Promise<void>
  /**
   * 这套宿主有没有「编辑器标签页」（#72）：**同步判定**，消费方按它决定入口出不
   * 出现（菜单项不能等一次异步探测）。
   *
   * VS Code 侧 = 页面装了我们注入的宿主能力桥（后端真正是 VS Code 编辑器，有
   * 标签页这个容器）；官方 web 侧恒为 false——官方 web 没有「编辑器标签页」这个
   * 概念，宿主半插件也没有对应 RPC（这不是漏配：同一条能力两端语义不同，缺的
   * 那一端少的就是入口本身，插件其余行为不变）。
   */
  readonly editorTabs: boolean
  /**
   * 在专属于该会话的标签页里打开它（#72 显式多开；单 tab 仍是默认形态）。
   * 宿主没有标签页时一律以 code `unavailable` 拒绝——消费方按 {@link editorTabs}
   * 决定要不要给出这个入口，正常路径不会走到这里。
   */
  openSessionInNewTab(sessionId: string): Promise<void>
  /**
   * 这个会话现在是不是正开在宿主的对话面板里（#121）——侧栏树按它判「点当前会话行」
   * 是就地改名还是按打开处理。
   *
   * **为什么不能只看「侧栏认为的当前会话」**：那个判据来自官方 sessions 服务的状态，
   * 启动时可能是官方恢复的上次会话，与宿主真的开着哪个面板是两件事；两者不同步时，
   * 一个「宿主其实没开」的会话会被当成已打开，用户点它只会进改名、面板永远不出来
   * （#121 报的就是这个现场）。所以判据加这一条真条件。
   *
   * **官方 web 侧恒 false**：那一端没有「宿主面板」这个概念（同一份理由见本文件头
   * 的能力表），消费方按「按打开处理」走官方自己的会话切换。答不出来时（能力桥不认
   * 这条调用等异常路径）同样回 false——「没开」的处置就是按打开处理，与 #121 之前的
   * 点击行为一致，是个安全的降级方向。
   */
  isSessionInPanel(sessionId: string): Promise<boolean>
  /**
   * 把对话面板亮到这个会话（#121）：创建 / 聚焦 / 就地切换（VS Code 侧 = 与侧栏点
   * 会话那条通路同一个函数）。
   *
   * **官方 web 侧静默返回**（不是抛 `unavailable`）：那一端没有宿主面板，「打开一个
   * 会话」就是官方 `sessions.open` 自己那件事，消费方（侧栏树）在那一端本来就会先
   * 走它；这里再抛错只会让每次点当前会话都在控制台留一行噪音，而那一端本来就无事可做。
   */
  openSessionPanel(sessionId: string): Promise<void>
  /**
   * 订阅「宿主的面板里正开着哪些会话」（#147）。订阅后先交付一次**当前值**（宿主侧
   * 读一条快照：侧栏页可能比面板晚起来，只靠推送会漏掉这一刻的事实），此后宿主那边
   * 每次面板↔会话映射变化再交付一次。返回退订函数。
   *
   * **为什么需要这一条**：官方「跑完还没被打开」那颗绿点的武装条件是**这一页的
   * selected 不是它**（`dsh-api-session-controller` 的 `syncCompletedNotifications`）。
   * 官方 web 只有一页、selected 就是屏幕上那一条，判据成立；我们的 shell 有两个
   * webview（侧栏页 + 对话面板页各一份官方 client），宿主把面板切到某条会话不会回写给
   * 侧栏页，于是那条会话跑完时侧栏照旧给它亮一颗「跑完还没被打开」的绿点，而用户正在
   * 看它（#147 报的现场）。侧栏树把这份事实算进渲染判据即可，不必（也不能）去动官方
   * client 的 selected——理由见 `workspaceTree/tree.ts` 的消费点。
   *
   * **官方 web 侧永不推送**（订阅返回的退订函数是空操作，也不发任何调用）：那一端没有
   * 「宿主面板」这件事实（同一份理由见本文件头的能力表），集合恒为空 = 不抑制任何提醒，
   * 行为与今天完全一致。答不出来时（能力桥缺席 / 快照读失败）同样按空集处理——空集
   * 的处置就是「照官方规则渲染」，与这一条之前的行为一致，是个安全的降级方向。
   */
  onPanelSessions(listener: (sessionIds: readonly string[]) => void): () => void
  /**
   * 这套宿主有没有「独立的设置页」（#99 侧栏顶栏齿轮）：**同步判定**，消费方按它
   * 决定齿轮渲不渲染——VS Code 侧设置是我们自己的编辑器页（能力在），官方 web 侧
   * 设置是官方侧栏底部那一行（能力缺席，那一行本来就在，齿轮不该出现）。
   */
  readonly settingsPage: boolean
  /** 打开（或聚焦）设置页。宿主没有独立设置页时以 `unavailable` 拒绝。 */
  openSettings(): Promise<void>
  /**
   * 这套宿主能不能「建一个新工作区目录」（#99 顶栏 ＋ 菜单第二项）：**同步判定**，
   * 消费方按它决定该项出不出现。VS Code 侧由扩展宿主建目录并注册；官方 web 侧
   * 建目录归官方 directory-flow 占用者，能力恒缺席（那一项就不出现）。
   */
  readonly workspaceCreate: boolean
  /** 建一个新工作区目录并注册（VS Code 侧 = `dshOne.workspace.create` 命令）。 */
  createWorkspaceDirectory(): Promise<void>
  /**
   * 这套宿主有没有「编辑器窗口」可以放一个工作区文件夹（#109 工作区行的 hover
   * 「在 VS Code 打开」与右键「在新窗口打开文件夹」）：**同步判定**，消费方按它决定
   * 这两个入口出不出现。VS Code 侧有；官方 web 侧恒无——**不是漏配**：官方 web 是
   * 浏览器里的一页，它自己的「在外部应用里打开」走官方 open-in-app 插件（宿主上装的
   * 应用），跟「把文件夹放进这个编辑器窗口」不是一回事，我们这条能力说的正是后者。
   */
  readonly workspaceOpen: boolean
  /** 在编辑器窗口里打开一个工作区文件夹（`newWindow` 缺省 false = 当前窗口）。 */
  openWorkspaceFolder(path: string, options?: { newWindow?: boolean }): Promise<void>
  /**
   * 这套宿主有没有集成终端（#109 工作区行 hover 的「终端打开」）：**同步判定**。
   * VS Code 侧有；官方 web 侧恒无（浏览器页里没有集成终端，那一端的终端是 dsh 自己的
   * 面板，不归我们这棵树管）。
   */
  readonly workspaceTerminal: boolean
  /** 在一个工作区目录上开集成终端（cwd = 该目录）。 */
  openWorkspaceTerminal(path: string): Promise<void>
  /**
   * **VS Code 当前打开的文件夹**路径表（#112）：侧栏树判定「当前工作区」用它——
   * 工作区的 `path` 命中其中任一项，那一组就是当前（蓝色徽标 + 排最前）。
   *
   * VS Code 侧 = `vscode.workspace.workspaceFolders` 的 fsPath；**官方 web 侧空表**
   * ——浏览器里那一页没有「VS Code 打开的文件夹」这个概念，空表就是如实回答；空表与
   * 「这个窗口没开任何文件夹」在消费方是同一件事：没有当前工作区（不显示徽标、不置顶）。
   */
  currentWorkspaceFolders(): Promise<readonly string[]>
  /**
   * 这套宿主是什么（#109 当前工作区行的标识胶囊）：VS Code 侧 `'vscode'`，其余
   * （官方 web 等）`'web'`——用来给「当前工作区」那枚胶囊写它所在的容器名，不再像
   * 旧侧栏那样把 `vscode` 写死在渲染里（那样官方 web 上会挂出一个不对的名字）。
   */
  readonly shellName: string
}

function fail(code: HostCapabilityErrorCode, message: string): CapabilityFailure {
  const error = new Error(message) as CapabilityFailure
  error.code = code
  return error
}

/** 我们自己造的失败（用于区分「载体抛错」与「能力失败」）。 */
function isCapabilityFailureError(value: unknown): value is CapabilityFailure {
  return value instanceof Error && typeof (value as CapabilityFailure).code === 'string'
}

/** 从 cordis ctx 取官方 Connection 的 RPC 口；缺席时给 `unavailable`。 */
function connectionRpc(ctx: CapabilityContext | undefined): ConnectionRpc {
  const connection = ctx?.get('connection') as { rpc?: ConnectionRpc } | undefined
  const rpc = connection?.rpc
  if (rpc === undefined || typeof rpc.call !== 'function') {
    throw fail('unavailable', 'this shell provides no official Connection service')
  }
  return rpc
}

/**
 * 调宿主半的一次能力（官方侧通路）。返回宿主半的载荷（已确认 `ok: true`）。
 *
 * 载体（Connection）在非 2xx 时抛错：**HTTP 404 = 端点无人认领**，也就是宿主半
 * 没装进这个 dsh 实例——归类 `unavailable`，让消费方走降级而不是报「失败」。
 */
async function capabilityCall(
  ctx: CapabilityContext | undefined,
  method: HostCapabilityMethod,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rpc = connectionRpc(ctx)
  const endpoint = capabilityEndpoint(method)
  let result: Awaited<ReturnType<ConnectionRpc['call']>>
  try {
    result = await rpc.call('/api', endpoint, { args })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/HTTP 404/.test(message)) {
      throw fail('unavailable', `the host half does not serve ${endpoint} in this dsh instance`)
    }
    throw fail('failed', `${endpoint} transport failure: ${message}`)
  }
  if (!result.ok) throw fail('failed', `${endpoint} failed: ${result.error.code}: ${result.error.message}`)
  const payload = result.value
  if (isCapabilityFailure(payload)) throw fail(payload.error.code, payload.error.message)
  if (typeof payload !== 'object' || payload === null || (payload as { ok?: unknown }).ok !== true) {
    throw fail('failed', `${endpoint} returned an unexpected shape`)
  }
  return payload as Record<string, unknown>
}

/** VS Code 侧能力桥调用（把桥的错误码原样透出，消费方两端看到同一套 code）。 */
async function bridgeCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const data = await hostCall<unknown>(name, args)
    if (typeof data === 'object' && data !== null) return data as Record<string, unknown>
    return {}
  } catch (err) {
    const code = (err as HostCallFailure).code
    const message = err instanceof Error ? err.message : String(err)
    throw fail((code ?? 'failed') as HostCapabilityErrorCode, message)
  }
}

/**
 * 读回执里的会话 id 表（#147 的快照读）。形状不认识就当空表——空集 = 不抑制任何提醒，
 * 与能力缺席同一个降级方向。
 */
function panelSessionsOf(data: Record<string, unknown>): readonly string[] {
  const ids = data.sessionIds
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id !== '')
}

/** 浏览器原生下载（官方 web 侧 `downloadGatewayFile` 的实现）。 */
async function browserDownload(path: string, suggestedName: string): Promise<DownloadResult> {
  const response = await fetch(path)
  if (!response.ok) throw fail('failed', `HTTP ${response.status} while fetching ${path}`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // 立刻 revoke 会让部分浏览器来不及取内容；下一轮宏任务回收。
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return { path: null }
}

/**
 * 造一个能力口。同一插件进程内可以反复造（无状态，全部状态在宿主侧）。
 * @param ctx - 插件 apply 拿到的 cordis ctx（读官方 Connection 服务用）。
 */
export function hostCapabilities(ctx?: CapabilityContext): HostCapabilities {
  // 每调用一次判一次（不缓存）：页面side SDK 的安装时机取决于外壳注入顺序，直接
  // 判「现在有没有」比在构造时刻定生死稳。
  const viaBridge = (): boolean => hostCallAvailable()
  return {
    async stateRead(key) {
      // 两侧同一份实现（宿主半的状态存储模块）：VS Code 侧走能力桥（扩展宿主代行
      // 同一个 store 模块，见 hostBridge 的 stateCall 说明），官方侧走宿主半的 RPC。
      if (viaBridge()) {
        const data = await bridgeCall('state.read', { key })
        return data.value ?? null
      }
      const payload = await capabilityCall(ctx, 'stateRead', { key })
      return payload.value ?? null
    },
    async stateWrite(key, value) {
      if (viaBridge()) {
        await bridgeCall('state.write', { key, value })
        return
      }
      await capabilityCall(ctx, 'stateWrite', { key, value })
    },
    async stateDelete(key) {
      if (viaBridge()) {
        const data = await bridgeCall('state.delete', { key })
        return data.deleted === true
      }
      const payload = await capabilityCall(ctx, 'stateDelete', { key })
      return payload.deleted === true
    },
    async gitShow(args) {
      if (viaBridge()) {
        return (await bridgeCall('git.show', { hash: args.hash, cwd: args.cwd })) as unknown as CommitInfoResult
      }
      return (await capabilityCall(ctx, 'gitShow', { hash: args.hash, cwd: args.cwd })) as unknown as CommitInfoResult
    },
    async saveContent(args) {
      if (viaBridge()) {
        const data = await bridgeCall('file.save', { suggestedName: args.suggestedName, base64: args.base64 })
        return { path: String(data.path ?? '') }
      }
      const payload = await capabilityCall(ctx, 'saveContent', args)
      return { path: String(payload.path ?? '') }
    },
    async downloadGatewayFile(args) {
      if (viaBridge()) {
        const data = await bridgeCall('file.download', { path: args.path, suggestedName: args.suggestedName })
        return { path: String(data.path ?? '') }
      }
      return await browserDownload(args.path, args.suggestedName)
    },
    async openExternal(url) {
      // 校核先做、只做一处：两侧都只可能拿到 http/https/mailto，错误码也一致。
      const allowed = parseAllowedUrl(url)
      if (allowed === null) throw fail('invalid-args', 'expected a http/https/mailto url')
      if (viaBridge()) {
        await bridgeCall('vscode.openExternal', { url: allowed })
        return
      }
      if (typeof window === 'undefined' || typeof window.open !== 'function') {
        throw fail('unavailable', 'this shell provides no way to open an external link')
      }
      // 官方 web 侧：页面就是用户的浏览器，直接开新标签（见文件头第 4 条取舍）。
      window.open(allowed, '_blank', 'noopener,noreferrer')
    },
    // 读时判定（不是构造时定值）：路由键在调用瞬间定生死，能力有没有也照同一
    // 口径——页面侧 SDK 若在建好能力口之后才装，这里照样能如实上报。
    get editorTabs() {
      return viaBridge()
    },
    async openSessionInNewTab(sessionId) {
      if (viaBridge()) {
        await bridgeCall('session.openInNewTab', { sessionId })
        return
      }
      throw fail('unavailable', 'this shell has no editor tabs; the host half serves no session tab action')
    },
    // #121：会话行点击的两条。没有桥 = 官方 web 一侧（或页面还没装上桥）：那一端没有
    // 「宿主面板」这个概念，查询如实回 false（= 一律按打开处理），动作静默返回
    //（那边的「打开」由官方 sessions.open 负责，消费方已经先走过它了）。
    async isSessionInPanel(sessionId) {
      if (!viaBridge()) return false
      try {
        const data = await bridgeCall('session.inPanel', { sessionId })
        return data.open === true
      } catch (err) {
        // 答不出来一律当「没开」：处置是按打开处理（安全的降级方向，见接口说明）。
        console.warn('[dsh-one] session panel state unavailable:', err)
        return false
      }
    },
    async openSessionPanel(sessionId) {
      if (!viaBridge()) return
      await bridgeCall('session.openPanel', { sessionId })
    },
    // #147：宿主面板里开着哪些会话。两条路合在一个订阅里交付：①先挂 window 上的
    // 广播监听（面板↔会话映射每次变化宿主都会推一条），②再读一次快照（页面起来之前
    // 就开着的面板，只靠推送会漏）。读回来的那一刻若已经收到过推送，就以推送为准——
    // 快照是更早的事实，别把它盖回新值上。
    onPanelSessions(listener) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
      let pushed = false
      const handler = (event: MessageEvent): void => {
        const ids = parsePanelSessionsMessage(event.data)
        if (ids === undefined) return
        pushed = true
        listener(ids)
      }
      window.addEventListener('message', handler)
      if (viaBridge()) {
        void bridgeCall('session.panelSessions', {}).then(
          (data) => {
            if (!pushed) listener(panelSessionsOf(data))
          },
          (reason: unknown) => {
            // 快照读不到就按空集（= 不抑制任何提醒，照官方规则渲染），日志留痕。
            if (!pushed) listener([])
            console.warn('[dsh-one] panel sessions unavailable:', reason)
          },
        )
      }
      return () => window.removeEventListener('message', handler)
    },
    get settingsPage() {
      return viaBridge()
    },
    async openSettings() {
      if (viaBridge()) {
        await bridgeCall('vscode.openSettings', {})
        return
      }
      throw fail('unavailable', 'this shell has no separate settings page; the official settings row owns settings here')
    },
    get workspaceCreate() {
      return viaBridge()
    },
    async createWorkspaceDirectory() {
      if (viaBridge()) {
        await bridgeCall('vscode.workspaceCreate', {})
        return
      }
      throw fail('unavailable', 'this shell cannot create a workspace directory; the official directory flow owns creation here')
    },
    // #109：工作区行的两个宿主动作（在编辑器里打开文件夹 / 开集成终端）。与
    // editorTabs 同一形态——两侧语义不同，没有的那一端少的就是入口本身。
    get workspaceOpen() {
      return viaBridge()
    },
    async openWorkspaceFolder(path, options) {
      if (!viaBridge()) {
        throw fail('unavailable', 'this shell has no editor window; the official web page opens folders elsewhere')
      }
      await bridgeCall('vscode.openFolder', { path, newWindow: options?.newWindow === true })
    },
    get workspaceTerminal() {
      return viaBridge()
    },
    async openWorkspaceTerminal(path) {
      if (!viaBridge()) {
        throw fail('unavailable', 'this shell has no integrated terminal; dsh web owns its own terminal panel')
      }
      await bridgeCall('vscode.openTerminal', { path })
    },
    // #112：当前 VS Code 打开的文件夹。**没有桥 = 官方 web 一侧**（或页面还没装上桥）：
    // 这一端没有「VS Code 打开的文件夹」这个概念，如实回空表——调用方（侧栏树）按
    // 「没有当前工作区」渲染（不显示徽标、不置顶），与「VS Code 空窗口」同一个形态。
    // 与上面几条 workspace* 能力不同，这里不抛 `unavailable`：文件夹表是个**只读查询**，
    // 空表本身就是正确答案，抛错只会逼每个调用方再写一遍降级。
    async currentWorkspaceFolders() {
      if (!viaBridge()) return []
      const data = await bridgeCall('vscode.workspaceFolders', {})
      const paths = data.paths
      if (!Array.isArray(paths)) return []
      return paths.filter((path): path is string => typeof path === 'string' && path !== '')
    },
    get shellName() {
      return viaBridge() ? 'vscode' : 'web'
    },
  }
}
