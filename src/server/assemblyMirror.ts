import * as http from 'node:http'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { LogSink } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'
import { localBundleRev } from './localBundleRev.ts'
import { createFailureLog } from '../pure/logThrottle.ts'
import {
  alignRosterRevs,
  blockedIdsOf,
  extractBootWire,
  filterWire,
  parseRosterRevs,
  projectGraphFrame,
  CHAT_BLOCK_LIST,
  CHAT_FRAME_PLUGIN_ID,
  ROSTER_REVS_PARAM,
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

/**
 * 镜像这一侧的失败日志（#229）：失败行按「同一目标」限频记，恢复行补一条收尾。
 *
 * 为什么镜像也要做：网关不可达时页面把请求转发进来的速率就是失败日志的速率——现场那 460 条
 * `assembly mirror: POST /api/commands/list failed: connect ECONNREFUSED 127.0.0.1:3080`
 * 全是这一处打的（`proxyRequest` 的上游错误 + `proxyUpgrade` 的 WS 升级失败），
 * 2 MB 的宿主日志同样被它刷穿。限频只改**记什么**、不改请求处理：镜像照旧原样转发、
 * 照旧回 502，所以「网关回来后页面照常」这条不受影响（限流那一半在我们这一侧的页面传输里）。
 */
interface MirrorFailureLog {
  failed(reason: string, message: string): void
  recovered(reason: string, message: string): void
}

function mirrorFailureLog(logger: LogSink): MirrorFailureLog {
  const failures = createFailureLog()
  return {
    failed: (reason, message) => {
      const line = failures.failed(reason, message)
      if (line !== undefined) logger.warn(line)
    },
    recovered: (reason, message) => {
      const line = failures.recovered(reason, message)
      if (line !== undefined) logger.info(line)
    },
  }
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
  /**
   * 实验开关（#237）：true = 恢复**改前**那套本地件分类——段首 id 只认双引号，
   * 「不在读到的整包里、名字又不像 `@dsh-one/*`」的 id 判成不认识的本地件并让**整份
   * 请求**回 404（而不是只丢那一条）。
   *
   * 用途只有一处：实验室夹具的**负向对照**——同一个「profile 里装了第三方插件」的
   * 现场，装上这个开关就该红（页面起不来），证明那条夹具真的抓得住这个 bug，而不是
   * 因为别的原因碰巧绿。生产恒缺省（改后的口径见 serveCombo 的注释）。
   */
  legacyLocalClassification?: boolean
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
  // 这一台 mirror 一份失败日志限频（键里带方法与路径，天然按目标分开）。
  const mirrorFailures = mirrorFailureLog(logger)
  const comboCache = new Map<string, Promise<{ text: string; ids: ReadonlySet<string> }>>()
  const filteredGatewayCombo = (framePluginId: string): Promise<{ text: string; ids: ReadonlySet<string> }> => {
    let pending = comboCache.get(framePluginId)
    if (pending === undefined) {
      pending = fetchFilteredGatewayCombo(
        target,
        blockedIdsOf(treeBlocks.get(framePluginId) ?? []),
        logger,
        options.legacyLocalClassification === true,
      )
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
        proxyRequest(req, res, target, logger, mirrorFailures)
      } catch (err) {
        logger.error(`assembly mirror handler error: ${String(err)}`)
        res.writeHead(500)
        res.end('assembly mirror error')
      }
    })
    server.on('upgrade', (req, clientSocket, head) => {
      proxyUpgrade(req, clientSocket, head, target, logger, mirrorFailures)
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

/**
 * 我方案件的 id 形态（`@dsh-one/<小写连字符名>`）。**只用来决定「要不要去读盘」**，
 * 不再用来判「这一条是不是我们的」（#237）——判据是来源：我们伺服的是
 * `pluginsDir/<id>/client.js` 那份**本机产物**，见 serveCombo。它同时是路径穿越的
 * 白名单（`..` 这类名字连读盘这一步都进不去）。
 */
const LOCAL_PLUGIN_RE = /^@dsh-one\/[a-z0-9-]+$/
const CLIENT_SUFFIX = '/client.js'

/** 段的起点：官方自注册 IIFE 的头部（切段用；允许 `load( {` 这类空白）。 */
const SEGMENT_START_RE = /window\.__ModuleLoader__\.load\(\s*\{/g

/**
 * 段首那次注册调用里的 id。三种引号都要认：官方与自有产物写双引号，第三方打包器
 * （实测 `@changfenhuang/dsh-genui` 0.11.0 的 lib/client.js，由 tsdown/esbuild 一类
 * 产出）写成模板字面量 `id:\`@changfenhuang/dsh-genui\``——只认双引号时这条 id 进不了
 * 「网关整包里有哪些 id」那张表，于是它被判成「本机插件」，进而让**整个请求**被拒
 * （#237 现场）。
 */
const SEGMENT_ID_RE = /window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/

/** #237 之前那份只认双引号、不容空白的 id 正则（只有实验室夹具的负向对照用它）。 */
const SEGMENT_ID_RE_LEGACY = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/

/**
 * 只在段首这一小段里找 id：再往后是 factory 体，被压过的代码里到处都是 `id:` 属性。
 * 300 个字符够官方与第三方两种写法的注册头（`{id:…,factory:…}`）用。
 */
const SEGMENT_ID_SCAN = 300

/**
 * 把一份整包按 `window.__ModuleLoader__.load({` 边界切成段，并读出每段开头的 id
 * （读不出来时 `id` 为 `undefined`，调用方据此记一条诊断——那条段的归属我们看不见）。
 *
 * 导出是给 `node --test` 用的：切段与认 id 这件事实在太久没被单独测过，正是 #237 的
 * 漏点（第三方产物换一种引号就漏一条）。
 */
export function splitComboSegments(
  text: string,
  idPattern: RegExp = SEGMENT_ID_RE,
): { segment: string; id: string | undefined }[] {
  const marks = [...text.matchAll(SEGMENT_START_RE)]
  const out: { segment: string; id: string | undefined }[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const segment = text.slice(start, end)
    const match = idPattern.exec(segment.slice(0, SEGMENT_ID_SCAN))
    out.push({ segment, id: match?.[1] ?? match?.[2] ?? match?.[3] })
  }
  return out
}

/**
 * 读我们自己那份插件产物；没有这个文件时返回 `null`（调用方按「我们不伺服这一条」处理）。
 *
 * 为什么不用「文件在不在」之外的判据：**来源**就是它——我们伺服的是本机
 * `pluginsDir/<id>/client.js`；目录里没有的，就不是我们的（#237）。
 */
async function readLocalBundle(pluginsDir: string, id: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(path.join(pluginsDir, id, 'client.js'))
  } catch {
    return null
  }
}

/**
 * 拉官方原 application combo 并剥掉 blockList 段（探针结论：网关 rev 是
 * 内容校验，重拼/单包错 rev 一律 404，唯一可靠来源是原 combo URL)。
 * 按 `window.__ModuleLoader__.load({` 边界切段、读段首 id 判定、拼接保留段。
 *
 * `legacyIds`（只有实验室夹具的负向对照传 true）恢复 #237 之前那份只认双引号的 id
 * 提取，用来在同一个现场上证明「夹具真的抓得住这个 bug」。
 */
async function fetchFilteredGatewayCombo(
  target: () => string | undefined,
  blockIds: readonly string[],
  logger: LogSink,
  legacyIds = false,
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
  const kept: string[] = []
  const dropped: string[] = []
  // 官方整包里实际存在的 id：调用方用它判断「网关那份是否已经带着这一条」——
  // 不能按 `@dsh-one/` 前缀猜：网关里也可能装了同组织的第三方/用户插件
  // （实测：用户自研的 @dsh-one/dsh-llm-provider 出现在网关清单里，按前缀会被
  // 误当本地件去读盘 → ENOENT → 502）。
  const ids = new Set<string>()
  let segmentCount = 0
  let unidentified = 0
  const idPattern = legacyIds ? SEGMENT_ID_RE_LEGACY : SEGMENT_ID_RE
  for (const app of appBatches) {
    // 批的 URL 按**相对**方式解析，不能字符串拼 `gateway + url`（#232）：官方给的是
    // 路径而不是绝对地址，且写法随版本变——0.1.6-alpha.2 是 `/plugins/??…`（带前导斜杠，
    // 拼接恰好成立），0.1.7-alpha.2 起是 `plugins/??…`（不带前导斜杠），拼接会得到
    // `http://127.0.0.1:61091plugins/??…` 这种解析不了的地址，整页的整包全废。
    const comboRes = await fetch(new URL(app.url, gateway).toString(), { headers })
    if (!comboRes.ok) throw new Error(`local UI proxy: official combo HTTP ${comboRes.status}`)
    const text = await comboRes.text()
    for (const { segment, id } of splitComboSegments(text, idPattern)) {
      segmentCount += 1
      if (id === undefined) {
        unidentified += 1
      } else {
        ids.add(id)
        if (blockIds.includes(id)) {
          dropped.push(id)
          continue
        }
      }
      kept.push(segment)
    }
  }
  if (unidentified > 0) {
    // 认不出 id 的段落在「网关整包里有哪些 id」那张表里没有名字，于是它会被当成
    // 「本机插件」去读盘——#237 就是这一处漏出来的（第三方产物换了种引号）。
    // 单独记一条，别再让它静默。
    logger.warn(
      `assembly mirror: ${String(unidentified)} of ${String(segmentCount)} combo segment(s) had no segment-head id within ${String(SEGMENT_ID_SCAN)} chars (their ids are invisible to the local/official split, see #237)`,
    )
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
 * /plugins-local/??ids&rev=…：本地 combo。网关那份（过滤版 application combo，含第三方
 * 插件的段）整段前置；**我们自己落盘的那些**（`pluginsDir/<id>/client.js`）读盘拼尾。
 * 纯拼接即正确（每段都是自注册 IIFE，注册顺序无关物化)。
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
    // 分类按**来源**（#237）：能伺服的是**我们自己落盘的那份产物**
    // （`pluginsDir/<id>/client.js` 存在），除此之外的一切——官方件、**第三方件**——
    // 一律按网关那份原样走（网关整包里就带着它们的段）。名字形态（LOCAL_PLUGIN_RE）
    // 只决定「要不要去读盘」，不决定「这一条是不是我们的」：第三方插件的 id 天然不
    // 匹配它。
    //
    // **任何单点不认识都不许让整批失败**（这条是 #237 一半的现场）：从前这里对
    // 「不在读到的整包里、名字又不像自有件」的 id 直接回 404，那个用户装了第三方插件
    // 之后，这一页的**整批**模块一条都拿不到——连官方件一起 `import failed`，整页
    // 起不来。现在单点不认识的后果只有它自己那一条：我们不伺服它，剩下的照旧全发出去。
    const official = await filteredGatewayCombo(frameId)
    const legacy = options.legacyLocalClassification === true
    const parts: Buffer[] = []
    const localFiles: Buffer[] = []
    let localCount = 0
    const leftToGateway: string[] = []
    for (const id of ids) {
      // 网关那份已经带着它（官方件，或者用户把我们自己的包装进了 profile——#165）
      // 就不再读盘：同一个 id 两份段会让客户端当场抛 duplicate factory registration。
      if (official.ids.has(id)) continue
      if (!LOCAL_PLUGIN_RE.test(id)) {
        if (legacy) {
          // #237 之前的老行为（只有负向对照走这里）：判成「本地件」却不认识名字 → 整份回 404。
          logger.warn(`assembly mirror: rejected local combo ids ${ids.filter((x) => !official.ids.has(x)).join(',')}`)
          res.writeHead(404, { 'access-control-allow-origin': '*' })
          res.end('not found')
          return
        }
        leftToGateway.push(id)
        continue
      }
      // 老行为下读不到就整份 502（外层 catch）；新口径下只丢那一条。
      const file = legacy
        ? await fsp.readFile(path.join(options.pluginsDir, id, 'client.js'))
        : await readLocalBundle(options.pluginsDir, id)
      if (file === null) {
        leftToGateway.push(id)
        continue
      }
      localCount += 1
      localFiles.push(Buffer.concat([Buffer.from('\n'), file]))
    }
    // 请求里只要有一条不是我们自己伺服的就带上网关那份——它带的不只是被点名的那些
    // 段，而是过滤后的**全部**保留段（官方按 URL 长度分批，这里逐批都拉过了）。
    if (ids.length > localCount) parts.push(Buffer.from(official.text, 'utf8'))
    parts.push(...localFiles)
    if (leftToGateway.length > 0) {
      // 单点不认识的落地方式：它由网关那份带着走；网关也没有时，只有那一条起不来
      // （它自己报 import failed），其余照常。
      logger.warn(
        `assembly mirror: combo ids not served from ${options.pluginsDir} and not seen in the gateway combo (left to the gateway's own combo): ${leftToGateway.join(', ')}`,
      )
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
 *
 * `revs` 也由页面给（#230）：这一页 boot 那份清单的 `id → rev`。投影因此是两步——
 * 先按该树 block list 过一遍（`filterWire`），再把每条的 `rev` 对齐到这份基线
 * （`alignRosterRevs`）。网关一重启，官方推来的 roster 里每条的 rev 都是新的每进程随机值，
 * 不对齐就会被客户端读成「每一条都变了」（先拆后建 → 会话 scope 的对接件被撤销 → 官方
 * 渲染器抛装配错 → 整页白）。基线为什么由页面带、为什么不放在 mirror 里头取一份：见
 * `wireFilter.ts` 的 `alignRosterRevs` 与 `ROSTER_REVS_PARAM`。缺这条参数 = 只过滤、
 * 不对齐，与它出现之前的行为逐字相同（alpha.1 上这条流本来就是空转）。
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
  // 追加的自有插件 id（第一个之后的那些）里混进一条我们认不出的名字时**只丢那一条**，
  // 不再让整条流回 404（#237 同一口径）：这条流一停，页面的名册就停在 boot 那一刻那份
  // （退化成 0.1.6-alpha.1 的行为），比少补回一条条目严重得多。第一个 id 不是
  // 「认不出的名字」那类问题——它决定取哪棵树的 block list，查不到就没法投影。
  const extraIds = ids.slice(1).filter((id) => LOCAL_PLUGIN_RE.test(id))
  if (req.method !== 'GET' || treeBlockList === undefined || ids[0] === undefined) {
    logger.warn(`assembly mirror: rejected graph events request (ids ${ids.join(',') || 'none'})`)
    reject(404, 'not found')
    return
  }
  if (extraIds.length !== ids.length - 1) {
    logger.warn(
      `assembly mirror: graph events request named ids that are not local plugin ids (kept the rest): ${ids.slice(1).filter((id) => !LOCAL_PLUGIN_RE.test(id)).join(',')}`,
    )
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
  // 这一页 boot 那一刻那份清单的 `id → rev`（#230）：页面把它编在 `revs` 查询参数里带过来
  // （见 wireFilter 的 ROSTER_REVS_PARAM 与 pageHtml 的 transportJs）。**基线必须跟着连接
  // 走、不能由 mirror 自己取一份**：同一台 mirror 上重启前后各开一个页面，两页的基线不同。
  // 没带 / 解析不出来（老页面、别的调用方）= 只过滤、不对齐，与这条参数出现之前逐字相同。
  const baseline = parseRosterRevs(url.searchParams.get(ROSTER_REVS_PARAM) ?? '')
  const project = (graph: BootWire): BootWire => {
    const filtered = filterWire(graph, treeBlockList, ids[0] ?? '', extraIds, localRev, (line) => logger.warn(line))
    return baseline.size === 0 ? filtered : alignRosterRevs(filtered, baseline)
  }
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
  failures: MirrorFailureLog,
): void {
  const gateway = target()
  if (gateway === undefined) {
    res.writeHead(503, { 'access-control-allow-origin': '*' })
    res.end('dsh service is not running')
    return
  }
  const url = new URL(req.url ?? '/', gateway)
  // 同一目标的键（#229）：方法与路径——失败日志按它限频，成功时按它补「恢复」行。
  const method = (req.method ?? 'GET').toUpperCase()
  const targetKey = `${method} ${url.pathname}`
  const preq = http.request(
    `${gateway}${url.pathname}${url.search}`,
    { method: req.method, headers: proxyHeaders(req, gateway) },
    (pres) => {
      failures.recovered(targetKey, `assembly mirror: ${targetKey} recovered`)
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
    failures.failed(targetKey, `assembly mirror: ${targetKey} failed: ${err.message}`)
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
  failures: MirrorFailureLog,
): void {
  const gateway = target()
  if (gateway === undefined || !new URL(req.url ?? '/', gateway).pathname.startsWith('/api/')) {
    clientSocket.destroy()
    return
  }
  // WS 升级这一路的失败日志同样按目标限频（#229 现场里 `ws upgrade failed: connect
  // ECONNREFUSED` 也是逐条打出来的）；`logger` 只留给 `ws upgrade rejected`（那是一份
  // 明确的协议拒绝，不是在重试循环里刷的那种）。
  const targetKey = `ws ${new URL(req.url ?? '/', gateway).pathname}`
  const preq = http.request(`${gateway}${req.url}`, { headers: proxyHeaders(req, gateway) })
  preq.end()
  preq.on('upgrade', (pres, usocket) => {
    failures.recovered(targetKey, `assembly mirror: ${targetKey} recovered`)
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
    failures.failed(targetKey, `assembly mirror: ws upgrade failed: ${err.message}`)
    clientSocket.destroy()
  })
  clientSocket.on('error', () => preq.destroy())
}
