import * as http from 'node:http'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { LogSink } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'
import { localBundleRev } from './localBundleRev.ts'
import {
  blockedIdsOf,
  extractBootWire,
  filterWire,
  projectGraphFrame,
  CHAT_BLOCK_LIST,
  CHAT_FRAME_PLUGIN_ID,
  type BlockedPlugin,
  type BootWire,
} from '../ui/assembly/wireFilter.ts'

// serverAuth 的 per-origin 状态是模块级 Map：harness/测试若另起 bundle 实例
// 会读写不到同一份（probe 时踩过)。统一从这里再导出，保证消费方与 mirror
// 共用同一模块实例（扩展宿主单 bundle 本无此问题)。
export { cookieHeader, registerAuth, exchangeToken, probeToken, dshVersion } from './serverAuth.ts'

/**
 * cordis 装配 mirror（#64，blocklist 模式)：loopback 反向代理，仅绑
 * 127.0.0.1 随机端口，随面板关闭。路由全解析：
 * - /plugins-local/??ids：本地 combo。外框插件（@dsh-one/vscode-chat-ui-layout)
 *   直接读盘；**含官方 id 时** = 过滤版 application 批——拉网关原 combo
 *   （探针证实 rev 是内容校验：重拼/错 rev 一律 404，只能拉原 combo；官方按
 *   URL 长度把 application 切成几批时逐批拉），按 `window.__ModuleLoader__.load({`
 *   边界剥掉 BLOCK_LIST 段后伺服；
 * - /plugins-local/events：官方 `/plugins/events` 那条 SSE 的过滤版（页面把自己的
 *   事件流改道到这里，见 serveGraphEvents）——`graph` 帧带的是最新一份完整 roster，
 *   0.1.6-alpha.2 起页面会采纳它，不过滤就会把我们 block 掉的官方插件装回来；
 * - /（可选)：装配页 HTML（options.assemblyPage 提供时；生产由外壳生成 HTML，
 *   实验室按树路由自己伺服页面，都不走这个口）；
 * - 其余一切路径（/api、/assets、/plugins、/provider/status、/plan/status……)
 *   原样反代网关：Origin/Referer 改写为网关权威、cookie 服务侧附加，
 *   /api/remote.mux WS 升级转裸管道——#60/#63 已验证三件套。blocklist 模式
 *   直引网关，不再伺服本地拷贝（vsce 不再打包前端 dist/插件包)。
 *
 * 全响应 ACAO:* + OPTIONS 预检（webview 源是 vscode-webview://，跨源
 * fetch/module preload 需要 CORS)。
 */

export interface AssemblyMirror {
  /** loopback 源（http://127.0.0.1:<port>)，装配页 base href / transport 目标。 */
  readonly origin: string
  dispose(): void
}

/** 一棵树 = 自有外框插件 id + 该树 block list（过滤版整包的缓存键；事件流投影也按它取 block list）。 */
export interface AssemblyTreeCombo {
  /** 该树自有外框插件 id（请求 combo 的 id 列表里带着它——路由与缓存键都靠它）。 */
  framePluginId: string
  /** 该树 block list（决定从官方整包剥哪些段）。 */
  blockList: ReadonlyArray<BlockedPlugin>
}

export interface AssemblyMirrorOptions {
  /**
   * 本地插件根目录：`<pluginsDir>/@dsh-one/vscode-chat-ui-layout/client.js`（自有外框插件
   * bundle，构建期落盘)。官方插件不再落盘——全部经 /plugins 代理直引网关。
   */
  pluginsDir: string
  /**
   * 本 mirror 伺服哪几棵树：共享 mirror（#71 性能——同窗口同网关地址一个
   * loopback 端口，webview 源稳定，跨 tab HTTP 缓存生效）同时伺服 chat/
   * sidebar/settings 三树。每棵树一份过滤版 combo，按 framePluginId 分别
   * 缓存（各树 block list 不同，缓存键互异）。缺省 = 只伺服 chat 树
   * （CHAT_BLOCK_LIST 兼容行为）。
   */
  treeCombos?: ReadonlyArray<AssemblyTreeCombo>
  /** 可选：GET / 返回的装配页 HTML（调试用的单页形态；生产与实验室都不传）。 */
  assemblyPage?: () => string | undefined
}

export function startAssemblyMirror(
  target: () => string | undefined,
  logger: LogSink,
  options: AssemblyMirrorOptions,
): Promise<AssemblyMirror> {
  // 过滤版官方 combo 缓存：按树缓存（key = 该树 framePluginId，#71 共享
  // mirror 多树伺服）。mirror 生命周期内网关插件集不变；失败不缓存（重试）。
  // 事件流路由（下面的 serveGraphEvents）要的是同一棵树的 block list 本身（它跑
  // filterWire），所以这张表存整份清单、combo 路由用时现取 id 表。
  const treeEntries = options.treeCombos ?? [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }]
  const treeBlocks = new Map<string, ReadonlyArray<BlockedPlugin>>(
    treeEntries.map((tree) => [tree.framePluginId, tree.blockList]),
  )
  const treeCombosKeys = new Set(treeBlocks.keys())
  const comboCache = new Map<string, Promise<{ text: string; ids: ReadonlySet<string> }>>()
  const filteredGatewayCombo = (framePluginId: string): Promise<{ text: string; ids: ReadonlySet<string> }> => {
    let pending = comboCache.get(framePluginId)
    if (pending === undefined) {
      pending = fetchFilteredGatewayCombo(target, blockedIdsOf(treeBlocks.get(framePluginId) ?? []), logger)
      comboCache.set(framePluginId, pending)
      pending.catch(() => {
        if (comboCache.get(framePluginId) === pending) comboCache.delete(framePluginId)
      })
    }
    return pending
  }

  return new Promise((resolve, reject) => {
    // combo 请求把整份插件 id 列表放在 URL 里，而官方**只保证每一批自己的 URL**
    // 不超过 3KB（client-modules 的 partitionComboRecords）——我们把几批合成一条
    // 之后，长度是这个总数（实测 61 个插件的 profile ≈ 2.7KB）。node 的默认请求头
    // 上限（16KB）够用，但那是「插件总数」这个新增长维度，留足余量免得哪天 431。
    const server = http.createServer({ maxHeaderSize: 128 * 1024 }, (req, res) => {
      try {
        // 跨源预检：webview 的 fetch（content-type: application/json)会先发 OPTIONS。
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
          })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname === '/' && options.assemblyPage !== undefined) {
          const page = options.assemblyPage()
          if (page !== undefined) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' })
            res.end(page)
            return
          }
        }
        if (url.pathname === '/plugins-local/') {
          void serveCombo(req, res, url, options, filteredGatewayCombo, treeCombosKeys, logger)
          return
        }
        // 事件流（SSE）：官方前端那条 `/plugins/events` 改道走这里，理由是每一帧
        // graph 都要过一遍该树的 blocklist（见 serveGraphEvents 的文件注释）。
        if (url.pathname === '/plugins-local/events') {
          void serveGraphEvents(req, res, url, target, treeBlocks, options.pluginsDir, logger)
          return
        }
        // 其余一切路径原样反代网关（/api、/assets、/plugins、/provider/status、
        // /plan/status……网关顶层路由不止 /api：mirror 是网关的 loopback 镜像，
        // 未知路径照 officialMirror 语义默认透传，带 cookie）。
        proxyRequest(req, res, target, logger)
      } catch (err) {
        logger.error(`assembly mirror handler error: ${String(err)}`)
        res.writeHead(500)
        res.end('assembly mirror error')
      }
    })
    server.on('upgrade', (req, clientSocket, head) => {
      proxyUpgrade(req, clientSocket, head, target, logger)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr !== 'object') {
        reject(new Error('local UI proxy: no loopback address'))
        return
      }
      logger.info(`assembly mirror: http://127.0.0.1:${addr.port}/`)
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        dispose: () => {
          server.close()
          // `close()` 只停止接受新连接，已建立的连接要显式断掉：流式响应
          // （下面的 /plugins/events 那类）不会自己结束，留着就是进程不退出
          // 的原因（#88）。
          server.closeAllConnections()
        },
      })
    })
  })
}

/** 本地插件 id（路径穿越白名单的另一半；官方 id 永不落盘、不经此分支)。 */
const LOCAL_PLUGIN_RE = /^@dsh-one\/[a-z0-9-]+$/
const CLIENT_SUFFIX = '/client.js'

/**
 * 拉官方原 application combo 并剥掉 blockList 段（探针结论：网关 rev 是
 * 内容校验，重拼/单包错 rev 一律 404，唯一可靠来源是原 combo URL)。
 * 按 `window.__ModuleLoader__.load({` 边界切段、读段首 id 判定、拼接保留段。
 */
async function fetchFilteredGatewayCombo(
  target: () => string | undefined,
  blockIds: readonly string[],
  logger: LogSink,
): Promise<{ text: string; ids: ReadonlySet<string> }> {
  const gateway = target()
  if (gateway === undefined) throw new Error('local UI proxy: dsh service is not running')
  const cookie = cookieHeader(gateway)
  const headers: Record<string, string> = cookie !== undefined ? { cookie } : {}
  const indexRes = await fetch(`${gateway}/`, { headers })
  if (!indexRes.ok) throw new Error(`local UI proxy: GET / HTTP ${indexRes.status}`)
  const wire = extractBootWire(await indexRes.text())
  // 官方按 combo URL 的长度上限把 application 阶段切成若干批（#165：干净 profile 上
  // directory-picker-native 独占第二批）。过滤后的 combo 必须覆盖**每一批**的保留段，
  // 否则第二批的官方插件会被当成不存在的「本地插件」而被 404 掉。
  const appBatches = wire.batches.filter((b) => b.phase === 'application')
  if (appBatches.length === 0) throw new Error('local UI proxy: gateway wire has no application batch')
  const segmentRe = /window\.__ModuleLoader__\.load\(\{/g
  const kept: string[] = []
  const dropped: string[] = []
  // 官方整包里实际存在的 id：调用方用它区分「官方插件」与「本地自有插件」——
  // 不能按 `@dsh-one/` 前缀猜：网关里也可能装了同组织的第三方/用户插件
  // （实测：用户自研的 @dsh-one/dsh-llm-provider 出现在网关清单里，按前缀会被
  // 误当本地件去读盘 → ENOENT → 502）。
  const ids = new Set<string>()
  let segmentCount = 0
  for (const app of appBatches) {
    const comboRes = await fetch(`${gateway}${app.url}`, { headers })
    if (!comboRes.ok) throw new Error(`local UI proxy: official combo HTTP ${comboRes.status}`)
    const text = await comboRes.text()
    const marks = [...text.matchAll(segmentRe)]
    segmentCount += marks.length
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length
      const segment = text.slice(start, end)
      const id = /\bid:\s*"([^"]+)"/.exec(segment.slice(0, 300))?.[1]
      if (id !== undefined) ids.add(id)
      if (id !== undefined && blockIds.includes(id)) {
        dropped.push(id)
        continue
      }
      kept.push(segment)
    }
  }
  if (kept.length + dropped.length !== segmentCount) {
    logger.warn(
      `assembly mirror: combo segment strip anomaly (segments ${segmentCount}, kept ${kept.length}, dropped ${dropped.length})`,
    )
  } else {
    logger.info(
      `assembly mirror: filtered combo ready (${String(appBatches.length)} application batch(es), kept ${kept.length} segments, dropped ${dropped.join(', ') || 'none'})`,
    )
  }
  return { text: kept.join(''), ids }
}

/**
 * /plugins-local/??ids&rev=…：本地 combo。官方 id → 过滤版 application combo
 * （整段前置)；本地 id（shell)→ 读盘拼尾。纯拼接即正确（每段都是自注册
 * IIFE，注册顺序无关物化)。
 */
async function serveCombo(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: AssemblyMirrorOptions,
  filteredGatewayCombo: (framePluginId: string) => Promise<{ text: string; ids: ReadonlySet<string> }>,
  treeComboKeys: ReadonlySet<string>,
  logger: LogSink,
): Promise<void> {
  // search = "?<list…>&rev=…"：第一个 '?' 起 query，第二个 '?' 起 combo 列表。
  const query = url.search.slice(1)
  const amp = query.indexOf('&')
  const listPart = amp === -1 ? query : query.slice(0, amp)
  if (req.method !== 'GET' || !listPart.startsWith('?')) {
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  const items = listPart.slice(1).split(',').filter((item) => item !== '')
  if (items.length === 0 || items.some((item) => !item.endsWith(CLIENT_SUFFIX))) {
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  const ids = items.map((item) => item.slice(0, -CLIENT_SUFFIX.length))
  // 树路由 + 缓存键：请求 combo 里的自有外框插件 id 决定用哪份过滤整包。
  const frameId = ids.find((id) => treeComboKeys.has(id)) ?? ''
  const rev = url.searchParams.get('rev') ?? 'noversion'
  try {
    // 分类按**来源**而不是名字前缀（见 fetchFilteredGatewayCombo 的说明）：
    // 官方整包里存在的 id → 由过滤版整包覆盖；不存在的 → 读本地插件目录。
    const official = await filteredGatewayCombo(frameId)
    const gatewayIds = ids.filter((id) => official.ids.has(id))
    const localIds = ids.filter((id) => !official.ids.has(id))
    if (localIds.some((id) => !LOCAL_PLUGIN_RE.test(id))) {
      logger.warn(`assembly mirror: rejected local combo ids ${localIds.join(',')}`)
      res.writeHead(404, { 'access-control-allow-origin': '*' })
      res.end('not found')
      return
    }
    const parts: Buffer[] = []
    if (gatewayIds.length > 0) parts.push(Buffer.from(official.text, 'utf8'))
    for (const id of localIds) {
      const file = await fsp.readFile(path.join(options.pluginsDir, id, 'client.js'))
      parts.push(Buffer.concat([Buffer.from('\n'), file]))
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'access-control-allow-origin': '*',
      // rev = 这份整包的内容版本（页面侧拼的缓存键）：官方那半 = 网关内容校验哈希，
      // 本地那半 = dist/assembly/plugins 的内容哈希（见 wireFilter 的 comboRev）。同
      // URL 内容恒定 → 长缓存（#71——共享 mirror 源稳定后跨 tab 命中 HTTP 缓存，整包
      // 网络字节≈0）。**两份内容都进键**才不会有 #173 那个洞：只按网关版本做键时，
      // 我们重建自己的 bundle 不改 URL、也不改这里的 ETag，webview 吃满 24h immutable
      // 缓存（连条件请求都不发），改了样式 reload 也看不到。
      'cache-control': 'max-age=86400, immutable',
      etag: `"dsh-combo-${rev}-${frameId}"`,
    })
    res.end(Buffer.concat(parts))
  } catch (err) {
    logger.warn(`assembly mirror: combo serving failed: ${err instanceof Error ? err.message : String(err)}`)
    res.writeHead(502, { 'access-control-allow-origin': '*' })
    res.end('assembly mirror combo error')
  }
}

/**
 * 事件流路由：`/plugins-local/events?ids=<frame 插件 id>[,<追加的自有 id>…]`。
 *
 * **为什么要它**（#191）：官方前端启动时会开一条 SSE（`dsh-client-hmr` 的
 * `/plugins/events`），每帧 `type: "graph"` 带的是**最新一份完整 roster**。0.1.6-alpha.1
 * 的客户端半对 graph 帧是「收到就丢」，0.1.6-alpha.2 改成交给条目协调器
 * （`ctx.modules.entries.sync`）按 roster 增删页面上的插件条目。而这份 roster 由网关
 * 生成，**是未过滤的全量清单**：直接采纳 → 我们 block 掉的官方插件被装回来、我们自己
 * 的 frame 插件条目被卸掉（root 槽注册随之撤销）→ 整页白
 * （`renderSlot('root') before any 'root' registration`）。
 *
 * **做法**（与 combo 那一路同一个机制：只在我们自己的转发管道里过滤，网关零改动）：
 * 这条流只由我们伺服的装配页使用（`pageHtml` 把 `/plugins/events` 改道到这里），
 * 每一帧都按该树的 `filterWire` 重新投影一遍——与页面 boot 时拿到的 `__DSH_BOOT__`
 * **同一个函数**，所以「同一份 roster 只有一个算法」。alpha.1 上这些帧本来就被客户端
 * 丢掉，投影等于空转，因此**不需要按版本分叉**。
 *
 * **失败怎么退化**：投影抛错（官方换了帧形状、block list 与清单对不上）时**丢弃这一帧**
 * 并落一条 warn —— 页面保持自己那份 roster，退化成 alpha.1 的行为；反过来放行会立刻
 * 把页面洗白，那是更坏的失败方式。
 *
 * `ids` 由页面给：第一个是 frame 插件 id（决定取哪棵树的 block list），其余是该树追加
 * 的自有插件 id（投影要把它们补回 roster）。为什么不从 mirror 自己那份树表里取追加
 * id：实验室的「官方浏览区对照档」与 sidebar 树**共用同一个 frame 插件 id**（只差装不装
 * 自有工作区树插件），按 framePluginId 查会张冠李戴。
 */
async function serveGraphEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  target: () => string | undefined,
  treeBlocks: ReadonlyMap<string, ReadonlyArray<BlockedPlugin>>,
  pluginsDir: string,
  logger: LogSink,
): Promise<void> {
  const reject = (status: number, body: string): void => {
    res.writeHead(status, { 'access-control-allow-origin': '*' })
    res.end(body)
  }
  const gateway = target()
  if (gateway === undefined) {
    reject(503, 'dsh service is not running')
    return
  }
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter((id) => id !== '')
  const treeBlockList = ids.length === 0 ? undefined : treeBlocks.get(ids[0] ?? '')
  if (req.method !== 'GET' || treeBlockList === undefined || ids.some((id) => !LOCAL_PLUGIN_RE.test(id))) {
    logger.warn(`assembly mirror: rejected graph events request (ids ${ids.join(',') || 'none'})`)
    reject(404, 'not found')
    return
  }
  // 逐帧投影要读明文：让网关别 gzip（网关的压缩中间件按 accept-encoding 决定）。
  // 其余头与 proxyHeaders 同口径（Origin/Referer 改写为网关权威、cookie 服务侧附加），
  // 但这里自己拼一份小的：proxyRequest 那套会把浏览器的 connection/keep-alive 也带上，
  // 经 fetch 转发给上游并不合适。
  const cookie = cookieHeader(gateway)
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  let upstream: Response
  try {
    upstream = await fetch(`${gateway}/plugins/events`, {
      headers: {
        accept: 'text/event-stream',
        'accept-encoding': 'identity',
        origin: gateway,
        referer: gateway,
        ...(cookie === undefined ? {} : { cookie }),
      },
      signal: controller.signal,
    })
  } catch (err) {
    logger.warn(`assembly mirror: graph events upstream failed: ${err instanceof Error ? err.message : String(err)}`)
    reject(502, 'assembly mirror events error')
    return
  }
  if (!upstream.ok || upstream.body === null) {
    logger.warn(`assembly mirror: graph events upstream HTTP ${upstream.status}`)
    reject(502, 'assembly mirror events error')
    return
  }
  // 投影用的本地那半版本与页面 boot 时那份一致（同一个 pluginsDir，同一个函数）。
  const localRev = await localBundleRev(pluginsDir)
  const project = (graph: BootWire): BootWire =>
    filterWire(graph, treeBlockList, ids[0] ?? '', ids.slice(1), localRev, (line) => logger.warn(line))
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  })
  res.flushHeaders()
  const decoder = new TextDecoder()
  const reader = upstream.body.getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index !== -1) {
        const frame = buffer.slice(0, index + 2)
        buffer = buffer.slice(index + 2)
        let out = ''
        try {
          out = projectGraphFrame(frame, project)
        } catch (err) {
          logger.warn(`assembly mirror: dropped a graph event frame: ${err instanceof Error ? err.message : String(err)}`)
        }
        if (out !== '') res.write(out)
        index = buffer.indexOf('\n\n')
      }
    }
    if (buffer !== '') res.write(buffer)
  } catch (err) {
    // 页面/面板关掉是我们自己 abort 的，属正常收尾，不算错。
    if (!controller.signal.aborted) {
      logger.warn(`assembly mirror: graph events stream ended: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  res.end()
}

function proxyHeaders(req: IncomingMessage, target: string): Record<string, string | string[]> {
  const authority = new URL(target).host
  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'origin' || key === 'referer' || key === 'host') continue
    // Fetch Metadata（sec-fetch-*）必须剥掉：它们是浏览器对**页面源→代理**这
    // 一跳的真实断言（Sec-Fetch-Site: cross-site），而代理转发后网关的栅栏
    // 会把它们当成对网关自身的断言 → 403（WS 升级不带这些头，所以流通道一直
    // 正常；浏览器实验室页面与代理同 site 也测不出来——真窗 vscode-webview://
    // → 127.0.0.1 即 cross-site，全部 REST 被栅栏打死，见 #64 定案）。
    if (key.startsWith('sec-fetch-')) continue
    headers[key] = value
  }
  headers.host = authority
  // 浏览器信任栅栏：Origin/Referer 改写为网关自己的权威（#60 已验证)。
  headers.origin = target
  if (req.headers.referer !== undefined) headers.referer = target
  const cookie = cookieHeader(target)
  if (cookie !== undefined) headers.cookie = cookie
  return headers
}

/**
 * 网关资产带内容哈希文件名（index-XXXX.js）——immutable 长缓存（#71）。
 *
 * #173 顺带核过这条是不是同类隐患：不是。网关前端资产（`dsh-web-frontend/dist/assets`）
 * 里每个文件的**名字里就带着内容哈希**（实测 0.1.6-alpha.1：`index-C04Zg7TP.js`、
 * `vendor-CCJJTK99.js`、`fonts/KaTeX_AMS-Regular-BQhdFMY1.woff2`、`langs/c-BIGW1oBm.js`，
 * 86 个文件全是这个形态），内容一变名字就变、HTML/JS 里引用的也是新名字——同名不同内容
 * 不会出现，所以这里钉 7 天是安全的。combo 那条不一样：它的 URL 是固定路径
 * （`/plugins-local/??…`）加查询串，名字不含内容信息，才必须把内容版本放进 rev（#173）。
 */
function withAssetCache(out: Record<string, string | string[]>, pathname: string): void {
  if (pathname.startsWith('/assets/')) out['cache-control'] = 'max-age=604800, immutable'
}

function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: () => string | undefined,
  logger: LogSink,
): void {
  const gateway = target()
  if (gateway === undefined) {
    res.writeHead(503, { 'access-control-allow-origin': '*' })
    res.end('dsh service is not running')
    return
  }
  const url = new URL(req.url ?? '/', gateway)
  const preq = http.request(
    `${gateway}${url.pathname}${url.search}`,
    { method: req.method, headers: proxyHeaders(req, gateway) },
    (pres) => {
      const out: Record<string, string | string[]> = { 'access-control-allow-origin': '*' }
      for (const [key, value] of Object.entries(pres.headers)) {
        if (key === 'set-cookie' || key === 'content-length' || key === 'transfer-encoding' || value === undefined) continue
        out[key] = value
      }
      withAssetCache(out, url.pathname)
      res.writeHead(pres.statusCode ?? 502, out)
      pres.pipe(res)
    },
  )
  preq.on('error', (err: Error) => {
    logger.warn(`assembly mirror: ${req.method} ${url.pathname} failed: ${err.message}`)
    res.writeHead(502, { 'access-control-allow-origin': '*' })
    res.end('assembly mirror proxy error')
  })
  // 下游（浏览器 / VS Code webview）没等响应写完就走了：把上游请求一并收掉。
  // 网关的 `/plugins/events` 是流式响应，永远不会自己结束，不收就会在这个
  // 进程里留下一条 ESTABLISHED 连接——实验室里的表现就是「断言全跑完、报告
  // 也生成了，但进程不退出」（#88）。响应正常写完时（`writableEnded`）不碰
  // 上游，让它照常回连接池复用。
  res.on('close', () => {
    if (!res.writableEnded) preq.destroy()
  })
  req.pipe(preq)
}

function proxyUpgrade(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  target: () => string | undefined,
  logger: LogSink,
): void {
  const gateway = target()
  if (gateway === undefined || !new URL(req.url ?? '/', gateway).pathname.startsWith('/api/')) {
    clientSocket.destroy()
    return
  }
  const preq = http.request(`${gateway}${req.url}`, { headers: proxyHeaders(req, gateway) })
  preq.end()
  preq.on('upgrade', (pres, usocket) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [key, value] of Object.entries(pres.headers)) {
      if (value !== undefined) lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    clientSocket.write(lines.join('\r\n') + '\r\n\r\n')
    usocket.write(head)
    usocket.pipe(clientSocket)
    clientSocket.pipe(usocket)
    const kill = (): void => {
      usocket.destroy()
      clientSocket.destroy()
    }
    usocket.on('error', kill)
    clientSocket.on('error', kill)
  })
  preq.on('response', (pres) => {
    logger.warn(`assembly mirror: ws upgrade rejected (${pres.statusCode})`)
    clientSocket.write(`HTTP/1.1 ${pres.statusCode} Upgrade refused\r\n\r\n`)
    clientSocket.destroy()
  })
  preq.on('error', (err: Error) => {
    logger.warn(`assembly mirror: ws upgrade failed: ${err.message}`)
    clientSocket.destroy()
  })
  clientSocket.on('error', () => preq.destroy())
}
