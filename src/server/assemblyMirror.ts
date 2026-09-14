import * as http from 'node:http'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'
import { BLOCKED_IDS, extractBootWire } from '../ui/assembly/wireFilter.ts'

// serverAuth 的 per-origin 状态是模块级 Map：harness/测试若另起 bundle 实例
// 会读写不到同一份（probe 时踩过)。统一从这里再导出，保证消费方与 mirror
// 共用同一模块实例（扩展宿主单 bundle 本无此问题)。
export { cookieHeader, registerAuth, exchangeToken, probeToken, dshVersion } from './serverAuth.ts'

/**
 * cordis 装配 mirror（#64，blocklist 模式)：loopback 反向代理，仅绑
 * 127.0.0.1 随机端口，随面板关闭。路由全解析：
 * - /api/*：反代网关（Origin/Referer 改写为网关权威、cookie 服务侧附加，
 *   /api/remote.mux WS 升级转裸管道)——#60/#63 已验证三件套；
 * - /assets/*、/plugins/*：反代网关静态资产与插件包（带 cookie)——blocklist
 *   模式直引网关，不再伺服本地拷贝（vsce 不再打包前端 dist/插件包)；
 * - /plugins-local/??ids：本地 combo。shell 插件（@dsh-one/vscode-shell)
 *   直接读盘；**含官方 id 时**= 过滤版 application 批——拉网关原 combo
 *   （探针证实 rev 是内容校验：重拼/错 rev 一律 404，只能拉原 combo)，按
 *   `window.__ModuleLoader__.load({` 边界剥掉 BLOCK_LIST 段后伺服；
 * - /（可选)：装配页 HTML（lab harness 用；webview 形态由外壳生成)。
 *
 * 全响应 ACAO:* + OPTIONS 预检（webview 源是 vscode-webview://，跨源
 * fetch/module preload 需要 CORS)。
 */

export interface AssemblyMirror {
  /** loopback 源（http://127.0.0.1:<port>)，装配页 base href / transport 目标。 */
  readonly origin: string
  dispose(): void
}

export interface AssemblyMirrorOptions {
  /**
   * 本地插件根目录：`<pluginsDir>/@dsh-one/vscode-shell/client.js`（自有 shell
   * bundle，构建期落盘)。官方插件不再落盘——全部经 /plugins 代理直引网关。
   */
  pluginsDir: string
  /** 可选：GET / 返回的装配页 HTML（lab harness 传；webview 形态不需要)。 */
  assemblyPage?: () => string | undefined
}

export function startAssemblyMirror(
  target: () => string | undefined,
  logger: Logger,
  options: AssemblyMirrorOptions,
): Promise<AssemblyMirror> {
  // 过滤版官方 combo 缓存：mirror 生命周期（= 面板生命周期)内网关插件集
  // 不变；首次 /plugins-local 带官方 id 的请求触发拉取。
  let filteredComboPromise: Promise<string> | null = null
  const filteredGatewayCombo = (): Promise<string> => {
    filteredComboPromise ??= fetchFilteredGatewayCombo(target, logger)
    // 失败不缓存（下次重试)。
    filteredComboPromise.catch(() => {
      filteredComboPromise = null
    })
    return filteredComboPromise
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
          void serveCombo(req, res, url, options, filteredGatewayCombo, logger)
          return
        }
        // 网关静态资产与插件包：原样反代（entry.url/bootstrap 批都是网关
        // /plugins URL，base href 下落到本 mirror 同源)。带 cookie。
        if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/plugins/')) {
          proxyRequest(req, res, target, logger)
          return
        }
        if (url.pathname.startsWith('/api/')) {
          proxyRequest(req, res, target, logger)
          return
        }
        res.writeHead(404, { 'access-control-allow-origin': '*' })
        res.end('not found')
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
 * 拉官方原 application combo 并剥掉 BLOCK_LIST 段（探针结论：网关 rev 是
 * 内容校验，重拼/单包错 rev 一律 404，唯一可靠来源是原 combo URL)。
 * 按 `window.__ModuleLoader__.load({` 边界切段、读段首 id 判定、拼接保留段。
 */
async function fetchFilteredGatewayCombo(
  target: () => string | undefined,
  logger: Logger,
): Promise<string> {
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
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const segment = text.slice(start, end)
    const id = /\bid:\s*"([^"]+)"/.exec(segment.slice(0, 300))?.[1]
    if (id !== undefined && BLOCKED_IDS.includes(id)) {
      dropped.push(id)
      continue
    }
    kept.push(segment)
  }
  if (kept.length + dropped.length !== marks.length || dropped.length !== BLOCKED_IDS.length) {
    logger.warn(
      `assembly mirror: combo segment strip anomaly (segments ${marks.length}, kept ${kept.length}, dropped ${dropped.length}, expected ${BLOCKED_IDS.length})`,
    )
  } else {
    logger.info(`assembly mirror: filtered combo ready (kept ${kept.length} segments, dropped ${dropped.join(', ')})`)
  }
  return kept.join('')
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
  filteredGatewayCombo: () => Promise<string>,
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
  const gatewayIds = ids.filter((id) => !id.startsWith('@dsh-one/'))
  const localIds = ids.filter((id) => id.startsWith('@dsh-one/'))
  if (localIds.some((id) => !LOCAL_PLUGIN_RE.test(id))) {
    logger.warn(`assembly mirror: rejected local combo ids ${localIds.join(',')}`)
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  try {
    const parts: Buffer[] = []
    if (gatewayIds.length > 0) {
      const filtered = await filteredGatewayCombo()
      parts.push(Buffer.from(filtered, 'utf8'))
    }
    for (const id of localIds) {
      const file = await fsp.readFile(path.join(options.pluginsDir, id, 'client.js'))
      parts.push(Buffer.concat([Buffer.from('\n'), file]))
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
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
