/**
 * 官方 AppFrame 原型的实验室服务器（#89）：`labServer.ts` 的原型版——同样的真实模块
 * （pageHtml / wireFilter / assemblyMirror），差别只在**树定义换成原型三棵树**
 * （不 block 官方 ui-layout + 一个原型形态插件）。
 *
 * 为什么另起一份而不是给 labServer 加参数：`suites.ts` / `labServer.ts` 正被其它并行
 * 分支改（#81/#82/#87），原型按任务要求单独建文件，避免互相踩。
 *
 * 路由：`/`（首页） `/proto-chat` `/proto-sidebar` `/proto-settings`；
 * 其余路径（/plugins-local/??…、/api/…、/assets/…）原样转给 mirror。
 * 形态档用 URL 参数 `?shape=`（各原型插件自己的词表，见 plugins/）。
 */
import * as http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { assemblyPageHtml } from '../../../../src/ui/assembly/pageHtml.ts'
import {
  cookieHeader,
  exchangeToken,
  startAssemblyMirror,
  type AssemblyMirror,
} from '../../../../src/server/assemblyMirror.ts'
import { registerVersion } from '../../../../src/server/serverAuth.ts'
import { localBundleRev } from '../../../../src/server/localBundleRev.ts'
import { defaultOwnedPath, readOwnedRecord } from '../../../../src/server/ownedRecord.ts'
import { extractBootWire, extractFrontendAssets, filterWire } from '../../../../src/ui/assembly/wireFilter.ts'
import { compare as compareSemver, parse as parseSemver } from '../../../../src/pure/semver.ts'
import type { LogSink } from '../../../../src/log.ts'
import { localPluginIdsOf } from '../../../../src/ui/assembly/trees.ts'
import { PROTO_ROUTES, type ProtoTreeRoute } from './trees.ts'

/** 版本门区间（与 ui/assemblyView.ts 同口径）。 */
const PREREQ_MIN = '0.1.2-rc.1'
const PREREQ_MAX = '0.2.0'

export interface ProtoServerOptions {
  gateway: string
  token?: string
  log: LogSink
  /** 原型插件 bundle 目录（build.ts 的产物）。 */
  pluginsDir: string
  /** 0 = 随机端口。 */
  port?: number
}

export interface ProtoServer {
  readonly origin: string
  readonly mirrorOrigin: string
  readonly gateway: string
  readonly dshVersion?: string
  readonly routes: ReadonlyArray<ProtoTreeRoute>
  dispose(): void
}

function inPrereqRange(version: string | undefined): boolean {
  if (version === undefined) return false
  return parseSemver(version) !== null && compareSemver(version, PREREQ_MIN) >= 0 && compareSemver(version, PREREQ_MAX) < 0
}

export async function startProtoServer(options: ProtoServerOptions): Promise<ProtoServer> {
  const { gateway, log } = options
  const record = await readOwnedRecord(defaultOwnedPath())
  const explicit = options.token
  const port = Number(new URL(gateway).port || 80)
  const token = explicit !== undefined && explicit !== '' ? explicit : record !== null && record.port === port ? record.token : undefined
  if (token === undefined) {
    throw new Error(`proto lab: no launch token for ${gateway} — pass --token / LAB_TOKEN, or check ~/.dsh/dsh-owned.json`)
  }
  await exchangeToken(gateway, token, log)
  const dshVersion = record !== null && record.port === port ? record.version : undefined
  if (dshVersion !== undefined) registerVersion(gateway, dshVersion)

  let gatewayHtml: Promise<string> | undefined
  const gatewayIndex = (): Promise<string> => {
    gatewayHtml ??= (async () => {
      const cookie = cookieHeader(gateway)
      const res = await fetch(`${gateway}/`, { headers: cookie === undefined ? {} : { cookie } })
      if (!res.ok) throw new Error(`proto lab: gateway GET / HTTP ${res.status}`)
      return res.text()
    })()
    return gatewayHtml
  }

  const mirror: AssemblyMirror = await startAssemblyMirror(() => gateway, log, {
    pluginsDir: options.pluginsDir,
    treeCombos: PROTO_ROUTES.map((route) => ({ framePluginId: route.tree.framePluginId, blockList: route.tree.blockList })),
  })

  const pageFor = async (route: ProtoTreeRoute, query: URLSearchParams): Promise<string> => {
    const html = await gatewayIndex()
    const wire = filterWire(
      extractBootWire(html),
      route.tree.blockList,
      route.tree.framePluginId,
      route.tree.extraPluginIds,
      await localBundleRev(options.pluginsDir),
      (line) => log.warn(line),
    )
    const assets = extractFrontendAssets(html)
    const theme = query.get('theme') === 'light' ? 'light' : 'dark'
    const sessionId = query.get('session')
    return assemblyPageHtml({
      mirrorOrigin: mirror.origin,
      cspNonce: `proto-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      assets,
      bootWire: wire,
      bootstrapUrl: wire.batches[0].url,
      theme,
      banner: inPrereqRange(dshVersion)
        ? undefined
        : dshVersion === undefined
          ? `dsh version unknown (expects ${PREREQ_MIN} <= version < ${PREREQ_MAX})`
          : `dsh ${dshVersion} may not match this assembly (expects ${PREREQ_MIN} <= version < ${PREREQ_MAX})`,
      ...(sessionId === null || sessionId === '' ? {} : { bootSessionId: sessionId }),
      localPluginIds: localPluginIdsOf(route.tree),
    })
  }

  const server = http.createServer((req, res) => {
    void handle(req, res)
  })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = PROTO_ROUTES.find((candidate) => url.pathname === `/${candidate.route}`)
      if (route !== undefined) {
        const page = await pageFor(route, url.searchParams)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(page)
        return
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(indexPage(origin()))
        return
      }
      if (url.pathname === '/official') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(await gatewayIndex())
        return
      }
      proxyToMirror(req, res, mirror.origin)
    } catch (err) {
      log.error(`proto lab ${req.url ?? ''} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String(err instanceof Error ? err.message : err))
    }
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    proxyUpgrade(req, socket, mirror.origin)
  })

  const origin = (): string => `http://127.0.0.1:${boundPort}`
  let boundPort = 0

  const indexPage = (self: string): string => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" /><title>官方 AppFrame 原型（#89）</title>
<style>body{font:14px/1.6 system-ui,-apple-system,sans-serif;max-width:860px;margin:32px auto;padding:0 16px}code{background:#eee;padding:1px 4px;border-radius:3px}li{margin:10px 0}.note{color:#555;font-size:13px}</style>
</head><body>
<h1>官方 AppFrame 原型（#89）</h1>
<p>三棵树都让官方 <code>@deepseek-ai/dsh-client-ui-layout</code> 渲染 root（生产三棵树 block 它），
形态适配只做 CSS / 内联轨道改写。数据面是本机真实 dsh 网关 <code>${gateway}</code>（只读）。</p>
<ul>
${PROTO_ROUTES.map((route) => `<li><a href="${self}/${route.route}">/${route.route}</a> — ${route.title}<br/><span class="note">${route.note}</span></li>`).join('\n')}
<li><a href="${self}/official">/official</a> — 网关原始 GUI（官方原样对照）</li>
</ul>
<p class="note">形态档：<code>?shape=</code>（chat：<code>js</code> 内联轨道改写 / <code>css0</code> 纯 CSS 硬写轨宽 / <code>raw</code> 官方原样；
sidebar：<code>fill</code> 单列铺满 / <code>raw</code>；settings：<code>page</code> 设置页当 keyed main / <code>raw</code>）。
另有 <code>?theme=light</code>、<code>?session=&lt;id&gt;</code>。</p>
</body></html>
`

  boundPort = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address !== 'object') {
        reject(new Error('proto lab: no loopback address'))
        return
      }
      resolve(address.port)
    })
  })
  log.info(`proto lab ready: ${origin()}/ (mirror ${mirror.origin}, gateway ${gateway})`)

  return {
    origin: origin(),
    mirrorOrigin: mirror.origin,
    gateway,
    ...(dshVersion === undefined ? {} : { dshVersion }),
    routes: PROTO_ROUTES,
    dispose: () => {
      server.close()
      mirror.dispose()
    },
  }
}

function proxyToMirror(req: IncomingMessage, res: ServerResponse, mirrorOrigin: string): void {
  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host') continue
    headers[key] = value
  }
  const preq = http.request(`${mirrorOrigin}${req.url ?? '/'}`, { method: req.method, headers }, (pres) => {
    const out: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(pres.headers)) {
      if (value === undefined || key === 'transfer-encoding') continue
      out[key] = value
    }
    res.writeHead(pres.statusCode ?? 502, out)
    pres.pipe(res)
  })
  preq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('proto lab: mirror proxy error')
  })
  req.pipe(preq)
}

function proxyUpgrade(req: IncomingMessage, clientSocket: Duplex, mirrorOrigin: string): void {
  const preq = http.request(`${mirrorOrigin}${req.url ?? '/'}`, { headers: req.headers })
  preq.end()
  preq.on('upgrade', (pres, upstream, upstreamHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [key, value] of Object.entries(pres.headers)) {
      if (value !== undefined) lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    clientSocket.write(lines.join('\r\n') + '\r\n\r\n')
    upstream.write(upstreamHead)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
    const kill = (): void => {
      upstream.destroy()
      clientSocket.destroy()
    }
    upstream.on('error', kill)
    clientSocket.on('error', kill)
  })
  preq.on('response', () => clientSocket.destroy())
  preq.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => preq.destroy())
}
