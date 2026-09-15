import * as http from 'node:http'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'
import { blockedIdsOf, extractBootWire, CHAT_BLOCK_LIST, SHELL_PLUGIN_ID, type BlockedPlugin } from '../ui/assembly/wireFilter.ts'

// serverAuth 的 per-origin 状态是模块级 Map：harness/测试若另起 bundle 实例
// 会读写不到同一份（probe 时踩过)。统一从这里再导出，保证消费方与 mirror
// 共用同一模块实例（扩展宿主单 bundle 本无此问题)。
export { cookieHeader, registerAuth, exchangeToken, probeToken, dshVersion } from './serverAuth.ts'

/**
 * cordis 装配 mirror（#64，blocklist 模式)：loopback 反向代理，仅绑
 * 127.0.0.1 随机端口，随面板关闭。路由全解析：
 * - /plugins-local/??ids：本地 combo。shell 插件（@dsh-one/vscode-shell)
 *   直接读盘；**含官方 id 时** = 过滤版 application 批——拉网关原 combo
 *   （探针证实 rev 是内容校验：重拼/错 rev 一律 404，只能拉原 combo)，按
 *   `window.__ModuleLoader__.load({` 边界剥掉 BLOCK_LIST 段后伺服；
 * - /（可选)：装配页 HTML（lab harness 传 assemblyPage 时；webview 形态由
 *   外壳生成 HTML，不走 mirror)；
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

/** 一棵树 = 自有 shell 插件 id + 该树 block list（过滤版整包的缓存键）。 */
export interface AssemblyTreeCombo {
  /** 该树自有 frame 插件 id（请求 combo 的 id 列表里带着它——路由与缓存键都靠它）。 */
  shellPluginId: string
  /** 该树 block list（决定从官方整包剥哪些段）。 */
  blockList: ReadonlyArray<BlockedPlugin>
}

export interface AssemblyMirrorOptions {
  /**
   * 本地插件根目录：`<pluginsDir>/@dsh-one/vscode-shell/client.js`（自有 shell
   * bundle，构建期落盘)。官方插件不再落盘——全部经 /plugins 代理直引网关。
   */
  pluginsDir: string
  /**
   * 本 mirror 伺服哪几棵树：共享 mirror（#71 性能——同窗口同网关地址一个
   * loopback 端口，webview 源稳定，跨 tab HTTP 缓存生效）同时伺服 chat/
   * sidebar/settings 三树。每棵树一份过滤版 combo，按 shellPluginId 分别
   * 缓存（各树 block list 不同，缓存键互异）。缺省 = 只伺服 chat 树
   * （CHAT_BLOCK_LIST 兼容行为）。
   */
  treeCombos?: ReadonlyArray<AssemblyTreeCombo>
  /** 可选：GET / 返回的装配页 HTML（lab harness 传；webview 形态由外壳生成）。 */
  assemblyPage?: () => string | undefined
}

export function startAssemblyMirror(
  target: () => string | undefined,
  logger: Logger,
  options: AssemblyMirrorOptions,
): Promise<AssemblyMirror> {
  // 过滤版官方 combo 缓存：按树缓存（key = 该树 shellPluginId，#71 共享
  // mirror 多树伺服）。mirror 生命周期内网关插件集不变；失败不缓存（重试）。
  const treeCombos = new Map<string, readonly string[]>(
    (options.treeCombos ?? [{ shellPluginId: SHELL_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }]).map((tree) => [
      tree.shellPluginId,
      blockedIdsOf(tree.blockList),
    ]),
  )
  const treeCombosKeys = new Set(treeCombos.keys())
  const comboCache = new Map<string, Promise<{ text: string; ids: ReadonlySet<string> }>>()
  const filteredGatewayCombo = (shellPluginId: string): Promise<{ text: string; ids: ReadonlySet<string> }> => {
    let pending = comboCache.get(shellPluginId)
    if (pending === undefined) {
      pending = fetchFilteredGatewayCombo(target, treeCombos.get(shellPluginId) ?? [], logger)
      comboCache.set(shellPluginId, pending)
      pending.catch(() => {
        if (comboCache.get(shellPluginId) === pending) comboCache.delete(shellPluginId)
      })
    }
    return pending
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
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
        reject(new Error('assembly mirror: no loopback address'))
        return
      }
      logger.info(`assembly mirror: http://127.0.0.1:${addr.port}/`)
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        dispose: () => server.close(),
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
  logger: Logger,
): Promise<{ text: string; ids: ReadonlySet<string> }> {
  const gateway = target()
  if (gateway === undefined) throw new Error('assembly mirror: dsh service is not running')
  const cookie = cookieHeader(gateway)
  const headers: Record<string, string> = cookie !== undefined ? { cookie } : {}
  const indexRes = await fetch(`${gateway}/`, { headers })
  if (!indexRes.ok) throw new Error(`assembly mirror: GET / HTTP ${indexRes.status}`)
  const wire = extractBootWire(await indexRes.text())
  const app = wire.batches.find((b) => b.phase === 'application')
  if (app === undefined) throw new Error('assembly mirror: gateway wire has no application batch')
  const comboRes = await fetch(`${gateway}${app.url}`, { headers })
  if (!comboRes.ok) throw new Error(`assembly mirror: official combo HTTP ${comboRes.status}`)
  const text = await comboRes.text()
  const segmentRe = /window\.__ModuleLoader__\.load\(\{/g
  const marks = [...text.matchAll(segmentRe)]
  const kept: string[] = []
  const dropped: string[] = []
  // 官方整包里实际存在的 id：调用方用它区分「官方插件」与「本地自有插件」——
  // 不能按 `@dsh-one/` 前缀猜：网关里也可能装了同组织的第三方/用户插件
  // （实测：用户自研的 @dsh-one/dsh-llm-provider 出现在网关清单里，按前缀会被
  // 误当本地件去读盘 → ENOENT → 502）。
  const ids = new Set<string>()
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
  if (kept.length + dropped.length !== marks.length) {
    logger.warn(
      `assembly mirror: combo segment strip anomaly (segments ${marks.length}, kept ${kept.length}, dropped ${dropped.length})`,
    )
  } else {
    logger.info(
      `assembly mirror: filtered combo ready (kept ${kept.length} segments, dropped ${dropped.join(', ') || 'none'})`,
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
  filteredGatewayCombo: (shellPluginId: string) => Promise<{ text: string; ids: ReadonlySet<string> }>,
  treeComboKeys: ReadonlySet<string>,
  logger: Logger,
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
  // 树路由 + 缓存键：请求 combo 里的自有 shell id 决定用哪份过滤整包。
  const shellId = ids.find((id) => treeComboKeys.has(id)) ?? ''
  const rev = url.searchParams.get('rev') ?? 'noversion'
  try {
    // 分类按**来源**而不是名字前缀（见 fetchFilteredGatewayCombo 的说明）：
    // 官方整包里存在的 id → 由过滤版整包覆盖；不存在的 → 读本地插件目录。
    const official = await filteredGatewayCombo(shellId)
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
      // rev = 网关内容校验哈希：同 rev 内容恒定，长缓存（#71——共享 mirror
      // 源稳定后跨 tab 命中 HTTP 缓存，整包网络字节≈0）。
      'cache-control': 'max-age=86400, immutable',
      etag: `"dsh-combo-${rev}-${shellId}"`,
    })
    res.end(Buffer.concat(parts))
  } catch (err) {
    logger.warn(`assembly mirror: combo serving failed: ${err instanceof Error ? err.message : String(err)}`)
    res.writeHead(502, { 'access-control-allow-origin': '*' })
    res.end('assembly mirror combo error')
  }
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

/** 网关资产带内容哈希文件名（index-XXXX.js）——immutable 长缓存（#71）。 */
function withAssetCache(out: Record<string, string | string[]>, pathname: string): void {
  if (pathname.startsWith('/assets/')) out['cache-control'] = 'max-age=604800, immutable'
}

function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: () => string | undefined,
  logger: Logger,
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
  req.pipe(preq)
}

function proxyUpgrade(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  target: () => string | undefined,
  logger: Logger,
): void {
  const gateway = target()
  if (gateway === undefined || !new URL(req.url ?? '/', gateway).pathname.startsWith('/api/')) {
    clientSocket.destroy()
    return
  }
  const preq = http.request(`${gateway}${req.url}`, { headers: proxyHeaders(req, gateway) })
  preq.end()
  preq.on('upgrade', (pres, usocket, uhead) => {
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
