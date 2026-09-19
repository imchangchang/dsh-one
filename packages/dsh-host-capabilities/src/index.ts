/**
 * `@dsh-one/dsh-host-capabilities` **宿主半**（#84）：跑在 dsh 宿主进程里的官方格式
 * 插件，把「官方 web 侧也要能用」的能力与状态提供给前端插件。
 *
 * ## 它是什么、凭什么两端都能用
 * dsh 的插件包可以同时有**宿主半**（包主入口，在 dsh 宿主进程里跑）与**客户端半**
 * （`exports['./client']`，在页面里跑）。宿主半拥有的能力经官方 api-gateway 暴露成
 * Remote 端点，页面里的插件用官方 Connection 的 RPC 口调用；页面完全不知道对面是
 * 谁——这就是「插件可移植」的关键路径（AGENTS.md 铁律「能移植的必须移植」）。
 *
 * 本包**只有宿主半**（没有客户端半）：前端调用它的那层薄 SDK 在
 * `packages/dsh-plugin-kit/src/hostCapabilities.ts`，由消费方插件各自打包（各插件是独立
 * bundle，没有共享模块作用域）。所以本包不声明 `dsh.client`，也就不进浏览器插件名册。
 *
 * ## 走第几层机制（AGENTS.md「官方机制优先」）
 * **层 2（官方服务 API）**，两处都用官方文档化的作者接口（出处
 * `@deepseek-ai/dsh-typert-protocol` 的 README「Exposing a Host method」）：
 * - `@Remote('方法名')` 装饰器标记要暴露的方法；
 * - `bindTypertRemote(service, 服务名)` 声明这条服务绑定到哪个线命名空间。
 * 服务本身用 `ctx.provide(名字, 实例)` 注册（cordis 公开 API：由当前 fiber 拥有、
 * fiber 卸载自动撤销），**刻意不继承官方的 `TypertRemoteService` 基类**——那会要求
 * 我们的包把 `@deepseek-ai/cordis` 也装进来，于是 dsh 宿主进程里出现第二份 cordis
 * 实例（`Service` 基类靠自己的 symbols 做注册与追踪，两份实例的 symbols 不同源），
 * 为一个基类引入这种不确定性不划算。SRC 发现路径只要求「实例上有个 `typertRemote`
 * 绑定 + 原型上有版本化标记」，这两样都由官方协议包提供。
 *
 * 本包的 `package.json` 同时把 `@deepseek-ai/cordis` 声明成依赖（代码里并不 import 它）：
 * 协议包把 cordis 当 peerDependency，而 profile 的 pnpm 配置是 `autoInstallPeers: false`，
 * 不显式声明就会在安装后解析不到那个 import。
 *
 * 端点全名 = `<服务名>/<方法名>`（如 `dshOneHostCapabilities/stateRead`）。**没有生成
 * typert 描述文件**：官方网关对未登记端点走 SRC 回退（`dsh-api-gateway/lib/index.js`
 * 的 `resolveSrcDescriptor`，按方法形参名取值）。这条路要求**方法的形参名保持不变**
 * ——构建时不许压缩/改名（本仓库 esbuild 不压缩；`test/hostCapabilities.test.ts`
 * 有一条断言盯着这件事）。
 *
 * ## 参数与错误口径
 * 参数键必须与方法形参名一致（网关 `assertExactArguments` 校核多余键，直接拒）；
 * 校核与错误形状的唯一定义在 `src/pure/hostCapabilities.ts`（与前端 SDK 共用同一份）。
 * 失败一律**返回** `{ ok: false, error: { code, message } }` 而不抛——SRC 模式下抛出
 * 的异常会被网关折叠成 `gateway/internal`，业务 code 过不了线（#84 实测）。
 */
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'

import {
  failure,
  HOST_CAPABILITY_SERVICE,
  parseBase64,
  parseStateKey,
  parseStateValue,
  parseSuggestedName,
  type HostCapabilityAck,
  type HostCapabilityResult,
} from '../../../src/pure/hostCapabilities.ts'
import { isHostCallError, parseGitShowArgs } from '../../../src/pure/hostCalls.ts'
import { gitShowInHost } from './gitShow.ts'
import { defaultSaveLocation, saveContentFile, type SaveLocation } from './saveContent.ts'
import { deleteState, dshHomeDir, readState, writeState } from './stateStore.ts'

/** 插件名（loader 行的 id 与 `dsh plugin` 看到的包名一致）。 */
export const name = 'dsh-one-host-capabilities'

/** 插件配置（profile 的 patch 行可选给；测试与特殊部署用）。 */
export interface Config {
  /** 状态与导出的家目录（缺省 `DSH_HOME` 或 `~/.dsh`）。 */
  home?: string
  /** 落盘位置（缺省 `~/Downloads` → `<home>/exports`）。 */
  saveLocation?: SaveLocation
  /** git 可执行文件（缺省走 PATH）。 */
  gitPath?: string
  /** 单次 git 查询预算（毫秒）。 */
  gitBudgetMs?: number
}

/** 本插件用到的 ctx 最小面（避免为了类型引入第二份 cordis）。 */
export interface HostHalfCtx {
  provide(name: string, value: unknown): unknown
  get(name: string): unknown
}

/** 宿主半的运行时依赖（注册期从 ctx 上解析；测试可注入假件）。 */
export interface HostHalfDeps {
  /** dsh 注册的工作区根（`gitShow` 的允许根）。 */
  allowedRoots: () => Promise<readonly string[]>
  /** 诊断日志（宿主半自己的日志，会话里看不到）。 */
  log: (line: string) => void
}

/** 宿主能力服务：一个方法一个 Remote 端点。 */
export class HostCapabilitiesService {
  /** 官方协议要求的可见绑定（网关 SRC 发现据此认领端点）。 */
  readonly typertRemote: unknown

  private readonly config: Config
  private readonly deps: HostHalfDeps

  constructor(serviceKey: string, config: Config, deps: HostHalfDeps) {
    this.typertRemote = bindTypertRemote(this, serviceKey)
    this.config = config
    this.deps = deps
  }

  private home(): string {
    return this.config.home ?? dshHomeDir()
  }

  /** 读一个状态键；没有这个键时 `value` 为 null。 */
  @Remote('stateRead')
  async stateRead(key: string): Promise<HostCapabilityResult<{ value: unknown }>> {
    const parsed = parseStateKey(key)
    if (typeof parsed !== 'string') return failure(parsed.code, parsed.message)
    return { ok: true, value: await readState(parsed, this.home()) }
  }

  /** 写一个状态键（值必须是能过线的 JSON）。 */
  @Remote('stateWrite')
  async stateWrite(key: string, value: unknown): Promise<HostCapabilityAck> {
    const parsedKey = parseStateKey(key)
    if (typeof parsedKey !== 'string') return failure(parsedKey.code, parsedKey.message)
    const parsedValue = parseStateValue(value)
    if (typeof parsedValue !== 'string') return failure(parsedValue.code, parsedValue.message)
    await writeState(parsedKey, parsedValue, this.home())
    return { ok: true }
  }

  /** 删一个状态键；`deleted` 表示这次是否真删掉了东西。 */
  @Remote('stateDelete')
  async stateDelete(key: string): Promise<HostCapabilityResult<{ deleted: boolean }>> {
    const parsed = parseStateKey(key)
    if (typeof parsed !== 'string') return failure(parsed.code, parsed.message)
    return { ok: true, deleted: await deleteState(parsed, this.home()) }
  }

  /** 查一条提交（只读 git；安全口径与宿主调用通道同一份代码）。 */
  @Remote('gitShow')
  async gitShow(hash: string, cwd: string): Promise<HostCapabilityResult<Record<string, unknown>>> {
    const parsed = parseGitShowArgs(cwd === undefined ? { hash } : { hash, cwd })
    if (isHostCallError(parsed)) return failure(parsed.code, parsed.message)
    const result = await gitShowInHost(
      parsed,
      {
        allowedRoots: this.deps.allowedRoots,
        home: this.home(),
        ...(this.config.gitPath === undefined ? {} : { gitPath: this.config.gitPath }),
        ...(this.config.gitBudgetMs === undefined ? {} : { budgetMs: this.config.gitBudgetMs }),
      },
      this.deps.log,
    )
    if (result === null) return failure('not-found', `no repository in the queried roots holds ${hash}`)
    if (isHostCallError(result)) return failure(result.code, result.message)
    return { ok: true, ...result }
  }

  /** 把一段内容写到宿主磁盘，返回绝对路径。 */
  @Remote('saveContent')
  async saveContent(suggestedName: string, base64: string): Promise<HostCapabilityResult<{ path: string }>> {
    const parsedName = parseSuggestedName(suggestedName)
    if (typeof parsedName !== 'string') return failure(parsedName.code, parsedName.message)
    const parsedBody = parseBase64(base64)
    if (typeof parsedBody !== 'string') return failure(parsedBody.code, parsedBody.message)
    const location = this.config.saveLocation ?? defaultSaveLocation(this.home())
    return { ok: true, path: await saveContentFile(parsedName, parsedBody, location) }
  }
}

/** 从宿主 ctx 解析依赖（工作区注册表可选：没有注册表时允许根只剩 dsh 家目录）。 */
export function hostHalfDeps(ctx: HostHalfCtx): HostHalfDeps {
  const logger = ctx.get('logger') as { info?(message: string): void } | undefined
  return {
    allowedRoots: async () => {
      const registry = ctx.get('workspaceRegistry') as { list?: () => Array<{ path?: unknown }> } | undefined
      const rows = registry?.list?.() ?? []
      return rows.map((row) => row.path).filter((entry): entry is string => typeof entry === 'string')
    },
    log: (line) => logger?.info?.(line),
  }
}

/**
 * cordis 插件入口：注册宿主能力服务（fiber 卸载时 cordis 自动撤销注册）。
 * @param ctx - 宿主上下文。
 * @param config - 可选的落点 / 家目录 / git 覆盖。
 */
export function apply(ctx: HostHalfCtx, config?: Config): void {
  const deps = hostHalfDeps(ctx)
  ctx.provide(HOST_CAPABILITY_SERVICE, new HostCapabilitiesService(HOST_CAPABILITY_SERVICE, config ?? {}, deps))
  // 启动留一条痕迹（宿主日志）：部署排障时「插件到底装上没」是最先要回答的问题。
  deps.log(`[dsh-one-host-capabilities] host half ready (service ${HOST_CAPABILITY_SERVICE})`)
}
