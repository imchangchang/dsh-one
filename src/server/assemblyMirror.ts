import * as http from 'node:http'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'

// serverAuth 的 per-origin 状态是模块级 Map：harness/测试若另起 bundle 实例
// 会读写不到同一份（probe 时踩过）。统一从这里再导出，保证消费方与 mirror
// 共用同一模块实例（扩展宿主单 bundle 本无此问题）。
export { cookieHeader, registerAuth, exchangeToken, probeToken, dshVersion } from './serverAuth.ts'

/**
 * cordis 装配 mirror（#64 M1）：loopback 反向代理 + 自托管静态资产的组合体，
 * 仅绑 127.0.0.1 随机端口，随面板关闭。沿用 #60/#63 已验证的三件套：
 * - /api 反代：Origin/Referer 改写为网关权威，鉴权 cookie 服务侧附加
 *   （cookieHeader，见 serverAuth.ts），/api/remote.mux WS 升级转裸管道；
 * - /assets/*：伺服打包进来的官方前端 dist（dist/assembly/frontend/assets）；
 * - /plugins-local/??ids：20 个自托管包的 lib/client.js 按官方 combo 形态拼接
 *   （dist/assembly/plugins/<name>/client.js）。
 *
 * 与 officialMirror 的差异：不做任何 index.html 注入（装配页由外壳生成，
 * 见 ui/assembly/pageHtml.ts）；全部响应带 ACAO:*（webview 源是
 * vscode-webview://，跨源 fetch/module preload 需要 CORS）并应答 OPTIONS
 * 预检；可选 / 装配页路由（webview 不需要，lab harness 用它在普通浏览器
 * 里开同一页）。
 */

export interface AssemblyMirror {
  /** loopback 源（http://127.0.0.1:<port>），装配页 base href / transport 目标。 */
  readonly origin: string
  dispose(): void
}

export interface AssemblyMirrorOptions {
  /** 前端资产目录（.../frontend/assets，含哈希 js/css/fonts/langs）。 */
  assetsDir: string
  /** 插件目录：`<pluginsDir>/<name>/client.js`（name = 包 id 去 @deepseek-ai/ 前缀）。 */
  pluginsDir: string
  /** 可选：GET / 返回的装配页 HTML（lab harness 传；webview 形态不需要）。 */
  assemblyPage?: () => string | undefined
}

/** 自托管包 id 白名单（也是路径穿越防线：id 只许 @deepseek-ai/dsh-<kebab>）。 */
const PLUGIN_ID_RE = /^@deepseek-ai\/dsh-[a-z0-9-]+$/
const CLIENT_SUFFIX = '/client.js'

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
}

export function startAssemblyMirror(
  target: () => string | undefined,
  logger: Logger,
  options: AssemblyMirrorOptions,
): Promise<AssemblyMirror> {
  const fileCache = new Map<string, Promise<Buffer>>()
  const readCached = (file: string): Promise<Buffer> => {
    let cached = fileCache.get(file)
    if (cached === undefined) {
      cached = fsp.readFile(file)
      fileCache.set(file, cached)
      cached.catch(() => fileCache.delete(file))
    }
    return cached
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        // 跨源预检：webview 的 fetch（content-type: application/json）会先发 OPTIONS。
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
        if (url.pathname.startsWith('/assets/')) {
          void serveAssets(req, res, url, options, readCached, logger)
          return
        }
        if (url.pathname === '/plugins-local/') {
          void serveCombo(req, res, url, options, readCached, logger)
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

/** /assets/<file>：前端 dist 资产，路径穿越拦截（不解析 ..、只允许白名单扩展名）。 */
async function serveAssets(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: AssemblyMirrorOptions,
  readCached: (file: string) => Promise<Buffer>,
  logger: Logger,
): Promise<void> {
  const rel = url.pathname.slice('/assets/'.length)
  if (req.method !== 'GET' || rel === '' || rel.includes('..') || rel.startsWith('/')) {
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  const ext = path.extname(rel).toLowerCase()
  const type = CONTENT_TYPES[ext]
  if (type === undefined) {
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  try {
    const body = await readCached(path.join(options.assetsDir, rel))
    res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(body)
  } catch {
    logger.warn(`assembly mirror: missing asset ${rel}`)
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
  }
}

/**
 * /plugins-local/??<id1>/client.js,<id2>/client.js&rev=…：官方 combo 形态的本地
 * 版——按序拼接各包 client.js（每段都是 `__ModuleLoader__.load({id,factory})`
 * 自注册 IIFE，纯拼接即正确）。
 */
async function serveCombo(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: AssemblyMirrorOptions,
  readCached: (file: string) => Promise<Buffer>,
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
  if (ids.some((id) => !PLUGIN_ID_RE.test(id))) {
    logger.warn(`assembly mirror: rejected combo ids ${ids.join(',')}`)
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
    return
  }
  try {
    const parts = await Promise.all(
      ids.map((id) => readCached(path.join(options.pluginsDir, id.slice('@deepseek-ai/'.length), 'client.js'))),
    )
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    })
    res.end(Buffer.concat(parts.map((part, i) => (i === 0 ? part : Buffer.concat([Buffer.from('\n'), part])))))
  } catch {
    logger.warn(`assembly mirror: missing plugin in combo ${ids.join(',')}`)
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
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
  // 浏览器信任栅栏：Origin/Referer 改写为网关自己的权威（#60 已验证）。
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
