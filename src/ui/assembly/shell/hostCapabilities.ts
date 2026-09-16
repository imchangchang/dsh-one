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
 * | `openSettings`（+ `settingsPage`） | 扩展宿主开/聚焦设置页（设置独立成编辑器页，#70） | **无**——官方 web 的设置是官方底部那一行，没有独立设置页；能力恒缺席，侧栏齿轮在那一端不渲染 |
 * | `createWorkspaceDirectory`（+ `workspaceCreate`） | 扩展宿主建目录并注册（`dshOne.workspace.create` 命令：`~/.dsh/workspaces/<名>`） | **无**——官方 web 的「新建目录」归官方 directory-flow 占用者（见 #99 的说明），能力恒缺席 |
 * | `openWorkspaceFolder`（+ `workspaceOpen`） | 扩展宿主 `dshOne.workspace.openFolder` 命令（`vscode.openFolder`，可要求新窗口） | **无**——官方 web 是浏览器里的一页，没有「编辑器窗口」可以放这个文件夹，能力恒缺席 |
 * | `openWorkspaceTerminal`（+ `workspaceTerminal`） | 扩展宿主 `dshOne.workspace.openTerminal` 命令（VS Code 集成终端，cwd = 该文件夹） | **无**——同上，浏览器页里没有集成终端 |
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
    get shellName() {
      return viaBridge() ? 'vscode' : 'web'
    },
  }
}
