/**
 * 装配实验室服务器（#78）。
 *
 * 它做的事：在普通 Node 里按**仓库真实模块**造出装配页，供浏览器验证（Playwright）
 * 或人开窗直接看：
 * - 装配页 HTML = `src/ui/assembly/pageHtml.ts`（与 VS Code webview 里那份同一个函数）；
 * - 清单过滤 = `src/ui/assembly/wireFilter.ts` + `src/ui/assembly/trees.ts`（三棵树的
 *   block list 与自有插件 id，与生产同一个事实源）；
 * - loopback 反代 = `src/server/assemblyMirror.ts`（与扩展里同一个 mirror 实现，
 *   只多了一层「页面直接由 labs 进程伺服」）；
 * - 数据面 = 本机真实 dsh 网关，**只读**（唯一写类动作是启动时的 token 换票，
 *   与扩展自身连接路径相同）。
 *
 * 页面路由（每棵树一个，见 `LAB_TREES`）：
 *   /（首页，列路由给人点） /chat /sidebar /sidebar-official /settings
 * 其余路径（/plugins-local/??…、/api/…、/assets/…）原样转给 mirror——实验室
 * 不需要自己的资产管线，mirror 就是生产那条。
 *
 * 环境变量：
 *   LAB_PORT      实验室 HTTP 端口（缺省 3179；0 = 随机）
 *   LAB_GATEWAY   网关地址（缺省 http://127.0.0.1:3080）
 *   LAB_TOKEN     网关 launch token（缺省读 ~/.dsh/dsh-owned.json 里该端口那份）
 *   LAB_PLUGINS   自有插件 bundle 目录（缺省 <repo>/dist/assembly/plugins）
 */
import * as http from 'node:http'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { assemblyPageHtml } from '../../src/ui/assembly/pageHtml.ts'
import { cookieHeader, exchangeToken, startAssemblyMirror, type AssemblyMirror } from '../../src/server/assemblyMirror.ts'
import { localBundleRev } from '../../src/server/localBundleRev.ts'
import { registerVersion } from '../../src/server/serverAuth.ts'
import { defaultOwnedPath, readOwnedRecord } from '../../src/server/ownedRecord.ts'
import { extractBootWire, extractFrontendAssets, filterWire, WORKSPACE_TREE_PLUGIN_ID, type BootWire } from '../../src/ui/assembly/wireFilter.ts'
import { ASSEMBLY_TREES, CHAT_TREE, SETTINGS_TREE, SIDEBAR_TREE, type AssemblyTree } from '../../src/ui/assembly/trees.ts'
import { compare as compareSemver, parse as parseSemver } from '../../src/pure/semver.ts'
import type { LogSink } from '../../src/log.ts'
import type { LabDataset } from './dataset.ts'

/** 版本门区间（与 ui/assemblyView.ts 同一口径：区间内不显示信息条）。 */
const PREREQ_MIN = '0.1.2-rc.1'
const PREREQ_MAX = '0.2.0'

/** 控制台 logger（`[lab]` 前缀）：mirror 与清单过滤的诊断都走它。 */
export function consoleLogger(quiet: boolean): LogSink {
  const write = (level: string, line: string): void => {
    if (quiet && level === 'info') return
    process.stderr.write(`[lab] ${line}\n`)
  }
  return {
    info: (line) => write('info', line),
    warn: (line) => write('warn', line),
    error: (line) => write('error', line),
  }
}


/** 一棵实验室页 = 一个路由 + 一棵树 + 就绪判据。 */
export interface LabTreeRoute {
  /** 路由名（URL 路径去掉斜杠）。 */
  route: string
  /** 页面标题 / 报告里的称呼。 */
  title: string
  tree: AssemblyTree
  /**
   * 首屏就绪选择器：等到它出现才认为这棵树挂起来了。
   * 侧栏官方对照档与自有树的就绪点不同（一个是自有类名、一个是官方的）。
   */
  readySelector: string
  /** 人看的说明（首页列出）。 */
  note: string
}

/**
 * 实验室的四棵树：三棵生产树 + 一棵**对照档**。
 * 对照档 = 侧栏树去掉自有工作区树插件（`@dsh-one/dsh-workspace-tree`），
 * 让官方 `ui-workspace` 的浏览区在同一个自有 frame 里渲染——外观对齐断言
 * （PARITY）拿它当基准：同一 frame、同一网关数据、同一宽度，只差装不装
 * 自有树插件这一个变量。
 */
export const SIDEBAR_OFFICIAL_TREE: AssemblyTree = {
  ...SIDEBAR_TREE,
  extraPluginIds: SIDEBAR_TREE.extraPluginIds.filter((id) => id !== WORKSPACE_TREE_PLUGIN_ID),
}

export const LAB_TREES: ReadonlyArray<LabTreeRoute> = [
  {
    route: 'chat',
    title: 'chat 树（装配对话区）',
    tree: CHAT_TREE,
    readySelector: '[data-slot="conversation.composer.bar"]',
    note: '官方外框/官方侧栏下线，对话流卡片全保留；#65 批 1 的自有插件（git 卡片/右键菜单/清空）都在这棵树上。',
  },
  {
    route: 'sidebar',
    title: 'sidebar 树（自有工作区树）',
    tree: SIDEBAR_TREE,
    readySelector: '.dshOneTree_root',
    note: '侧栏位装配：自有 @dsh-one/dsh-workspace-tree 以 shadow 顶掉官方浏览区（sidebar.workspaces 座位）。',
  },
  {
    route: 'sidebar-official',
    title: 'sidebar 树对照档（官方浏览区）',
    tree: SIDEBAR_OFFICIAL_TREE,
    readySelector: '[class*="_sectionHeader"]',
    note: '同一 frame 不装自有树插件，官方 WorkspaceBrowser 渲染——PARITY 套件的对齐基准。',
  },
  {
    route: 'settings',
    title: 'settings 树（设置独立成页）',
    tree: SETTINGS_TREE,
    readySelector: '[data-slot="settings.section"]',
    note: '设置页：官方外框/侧栏/对话流卡片下线，设置四件套保留。',
  },
]

export interface LabServerOptions {
  gateway: string
  token?: string
  log: LogSink
  /** 自有插件 bundle 目录（dist/assembly/plugins）。缺省时调用方负责校验存在性。 */
  pluginsDir: string
  /** 0 = 随机端口。 */
  port?: number
  /**
   * 这一轮跑法给侧栏那两棵树用的**页内数据集夹具**（#162，见 `dataset.ts`）。
   *
   * 由 `verify.ts` 决定：日常实例整轮**不给**（套件本来就按真实数据写，那是合入门禁）；
   * `--empty` 那一轮给 `SIDEBAR_DATASET`（空实例上没有数据可依赖，判据必须自足）。
   * 套件自己显式声明的 `dataset` 选项优先于这里（见 harness 的 `OpenOptions`）。
   */
  dataset?: LabDataset
  /**
   * 显式指定的网关 dsh 版本。
   *
   * 为什么需要：版本本来从 `~/.dsh/dsh-owned.json` 里读（扩展 spawn/adopt 的实例都
   * 记在那儿，顺带记了版本）。调用方自己起一个隔离的 `dsh web` 时那个文件里没有它，
   * 读到的版本是 undefined → 页面顶上会挂一条「dsh 版本未知」的信息条，那条东西不属
   * 于侧栏本身，会污染并排截图与首屏几何。所以允许调用方把它知道的版本直接传进来。
   */
  version?: string
}

export interface LabServer {
  readonly origin: string
  readonly mirrorOrigin: string
  readonly gateway: string
  /**
   * 自有插件 bundle 目录（mirror 读它、`localBundleRev` 也按它算内容版本）。
   * 套件要用同一个目录算 combo 缓存键里本地那一半（F-57），所以这里露出来——
   * 别让套件自己拼 `dist/assembly/plugins`，`LAB_PLUGINS` 换过目录时会对不上。
   */
  readonly pluginsDir: string
  /**
   * 这个实验室服务器连网关用的 launch token。露出来的理由只有一条：套件要拿**同一台
   * 网关**再起一个姊妹实验室服务器时（#173 的 F-57 要把 pluginsDir 换成一份临时产物
   * 拷贝，才能模拟「重建自己的 bundle」而不碰仓库里那份产物），它得用同一个 token 换票
   * ——外面那台是手工起的实例、token 只存在于 `LAB_TOKEN` 里时，套件自己去读
   * `~/.dsh/dsh-owned.json` 是读不到的。别把它写进报告或日志。
   */
  readonly token: string
  /** 网关 dsh 版本（来自 dsh-owned.json，取不到 undefined）。 */
  readonly dshVersion?: string
  /** 这一轮给侧栏页面用的页内数据集夹具（没有时 undefined）。 */
  readonly dataset?: LabDataset
  readonly trees: ReadonlyArray<LabTreeRoute>
  /**
   * 当天网关下发的官方 wire 里的插件 id 集合——**实验室各页面的装配来源**
   * （每棵树按它做 block list 过滤，见 `pageFor`），所以「我们 block 的 id 在不在
   * 官方清单里」这条断言拿它当事实源，而不是另起一次抓取。取一次后缓存。
   * 用途：F-11 WIRE-LIVENESS（#91）。
   */
  gatewayPluginIds(): Promise<ReadonlySet<string>>
  /**
   * 当天网关下发的官方 wire 原文（取一次后缓存）——F-11 的口径用例要在**真实清单**
   * 上合成「官方把插件切成两批」的形状（#165），只拿 id 集合合成不出来。
   */
  gatewayWire(): Promise<BootWire>
  dispose(): void
}

/** 缺省自有插件目录（repo 根的 dist/assembly/plugins）。 */
export function defaultPluginsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'assembly', 'plugins')
}

/** 该版本是否落在版本门区间内（与 ui/assemblyView.ts 的判定同口径）。 */
function inPrereqRange(version: string | undefined): boolean {
  if (version === undefined) return false
  return (
    parseSemver(version) !== null && compareSemver(version, PREREQ_MIN) >= 0 && compareSemver(version, PREREQ_MAX) < 0
  )
}

/**
 * 取网关 launch token：显式给的优先，否则读 `~/.dsh/dsh-owned.json` 里该端口那份
 * （扩展 spawn/adopt 的实例都记在这里）。取不到返回 undefined，由调用方决定报错
 * 文案（网关可能是用户手动起的、记录已过期）。
 */
export function resolveGatewayToken(
  gateway: string,
  explicit: string | undefined,
  record: { port: number; token?: string } | null,
): string | undefined {
  if (explicit !== undefined && explicit !== '') return explicit
  if (record === null || record.token === undefined) return undefined
  return record.port === gatewayPort(gateway) ? record.token : undefined
}

/** 网关 URL 的端口（显式省略时按协议默认）。 */
function gatewayPort(gateway: string): number {
  const url = new URL(gateway)
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

export async function startLabServer(options: LabServerOptions): Promise<LabServer> {
  const { gateway, log } = options
  const record = await readOwnedRecord(defaultOwnedPath())
  const token = resolveGatewayToken(gateway, options.token, record)
  if (token === undefined) {
    throw new Error(
      `lab: no launch token for ${gateway} — pass LAB_TOKEN / --token, or make sure ~/.dsh/dsh-owned.json records this port`,
    )
  }
  await exchangeToken(gateway, token, log)
  const recorded = record !== null && record.port === gatewayPort(gateway) ? record.version : undefined
  const dshVersion = options.version ?? recorded
  if (dshVersion !== undefined) registerVersion(gateway, dshVersion)

  let gatewayHtml: Promise<string> | undefined
  const gatewayIndex = (): Promise<string> => {
    gatewayHtml ??= (async () => {
      const cookie = cookieHeader(gateway)
      const res = await fetch(`${gateway}/`, { headers: cookie === undefined ? {} : { cookie } })
      if (!res.ok) throw new Error(`lab: gateway GET / HTTP ${res.status}`)
      return res.text()
    })()
    return gatewayHtml
  }

  /** 官方 wire（见 LabServer.gatewayWire / gatewayPluginIds 的说明）。 */
  let gatewayWireCache: Promise<BootWire> | undefined
  const gatewayWire = (): Promise<BootWire> => {
    gatewayWireCache ??= gatewayIndex().then((html) => extractBootWire(html))
    return gatewayWireCache
  }
  const gatewayPluginIds = (): Promise<ReadonlySet<string>> =>
    gatewayWire().then((wire) => new Set(wire.entries.map((entry) => entry.id)))

  const mirror: AssemblyMirror = await startAssemblyMirror(() => gateway, log, {
    pluginsDir: options.pluginsDir,
    treeCombos: ASSEMBLY_TREES.map((tree) => ({ framePluginId: tree.framePluginId, blockList: tree.blockList })),
  })

  /** 装配页 HTML：真实模块 + 该树的过滤清单 + 首帧主题。 */
  const pageFor = async (route: LabTreeRoute, query: URLSearchParams): Promise<string> => {
    const html = await gatewayIndex()
    // localRev 每次装配现算（与宿主同口径）：改了本地产物再重载页面，页面拿到的
    // combo URL 就该变——F-57 正是拿这一点当判据（#173）。
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
      cspNonce: `lab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      assets,
      bootWire: wire,
      bootstrapUrl: wire.batches[0].url,
      theme,
      // 版本门与生产同口径：只有网关版本落在区间外才显示信息条（实验室不做
      // 本地化，文案与 ui/assemblyView.ts 的英文档一致）。
      banner: inPrereqRange(dshVersion)
        ? undefined
        : dshVersion === undefined
          ? `The dsh version is unknown; this chat assembly expects ${PREREQ_MIN} <= version < ${PREREQ_MAX}.`
          : `The connected dsh is ${dshVersion}, which may not match this chat assembly (expects ${PREREQ_MIN} <= version < ${PREREQ_MAX}).`,
      ...(sessionId === null || sessionId === '' ? {} : { bootSessionId: sessionId }),
    })
  }

  const indexPage = (origin: string): string => `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <title>DSH One 装配实验室</title>
    <style>
      body{font:14px/1.6 system-ui,-apple-system,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1c1c1c}
      code{background:#f0f0f0;padding:1px 4px;border-radius:3px}
      li{margin:10px 0}
      .note{color:#555;font-size:13px}
      table{border-collapse:collapse;margin:12px 0}
      th,td{border:1px solid #ddd;padding:4px 8px;text-align:left;font-size:13px}
    </style>
  </head>
  <body>
    <h1>DSH One 装配实验室</h1>
    <p>装配页由仓库真实模块产出（pageHtml / wireFilter / assemblyMirror），数据面是本机真实 dsh 网关
      <code>${gateway}</code>（只读）。这份首页只给人点，自动化断言走 <code>npm run verify:lab</code>。</p>
    <table>
      <tr><th>项</th><th>值</th></tr>
      <tr><td>网关</td><td><code>${gateway}</code></td></tr>
      <tr><td>dsh 版本</td><td>${dshVersion ?? '（未知）'}</td></tr>
      <tr><td>mirror</td><td><code>${mirror.origin}</code></td></tr>
    </table>
    <h2>页面</h2>
    <ul>
      ${LAB_TREES.map(
        (route) =>
          `<li><a href="${origin}/${route.route}">/${route.route}</a> — ${route.title}<br/><span class="note">${route.note}</span></li>`,
      ).join('\n      ')}
      <li><a href="${origin}/official">/official</a> — 网关原始 GUI（同一网关、同一个浏览器里做 A/B 对照用）</li>
    </ul>
    <p class="note">URL 参数：<code>?theme=light</code> 切首帧主题；<code>?session=&lt;id&gt;</code> 给 chat 树注入启动会话。</p>
  </body>
</html>
`

  const server = http.createServer((req, res) => {
    void handleRequest(req, res)
  })

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = LAB_TREES.find((candidate) => url.pathname === `/${candidate.route}`)
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
        const html = await gatewayIndex()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }
      // 其余（/plugins-local/??…、/api/…、/assets/…）全部转给 mirror：
      // 实验室不自己伺服资产，mirror 那条链就是生产那条。
      proxyToMirror(req, res, mirror.origin)
    } catch (err) {
      log.error(`lab request ${req.url ?? ''} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String(err instanceof Error ? err.message : err))
    }
  }

  const origin = (): string => `http://127.0.0.1:${port}`

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    proxyUpgrade(req, socket, head, mirror.origin)
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address !== 'object') {
        reject(new Error('lab: no loopback address'))
        return
      }
      resolve(address.port)
    })
  }).catch((err: unknown) => {
    // 起不来（最常见是端口被上一轮遗留的进程占着）时，先把已经起的 mirror
    // 收掉再抛。mirror 自己是个监听中的 HTTP server，不收就把进程挂在启动
    // 阶段永不退出——现场表现正是「chromium 一直没起来、整轮挂住」（#88）。
    server.close()
    server.closeAllConnections()
    mirror.dispose()
    throw describeListenFailure(err, options.port ?? 0)
  })
  log.info(`assembly lab ready: ${origin()}/ (mirror ${mirror.origin}, gateway ${gateway})`)

  return {
    origin: origin(),
    mirrorOrigin: mirror.origin,
    gateway,
    pluginsDir: options.pluginsDir,
    token,
    ...(dshVersion === undefined ? {} : { dshVersion }),
    ...(options.dataset === undefined ? {} : { dataset: options.dataset }),
    trees: LAB_TREES,
    gatewayPluginIds,
    gatewayWire,
    dispose: () => {
      server.close()
      // 同 assemblyMirror：`close()` 不管已建立的连接，显式断掉，别把端口和
      // 事件循环一起留给调用方。
      server.closeAllConnections()
      mirror.dispose()
    },
  }
}

/**
 * 监听失败的人话说明（#88）：端口被占时要点名「是谁占着的」——上一轮遗留的
 * 进程、别的 session 的实验室、还是用户的别的服务，一眼能看出下一步怎么办。
 */
export function describeListenFailure(err: unknown, port: number): Error {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
    return err instanceof Error ? err : new Error(String(err))
  }
  const holder = portHolder(port)
  return new Error(
    `lab: 端口 ${port} 已被占用（EADDRINUSE），占用者：${holder ?? '（查不到是谁：lsof 不可用或没权限）'}` +
      `——换一个端口（LAB_PORT=<n> npm run verify:lab），或先结束上面那个进程。`,
  )
}

/**
 * 谁占着这个端口：`lsof` 找 LISTEN 的进程号，`ps` 取它的命令行。取不到就返回
 * undefined——查不到是谁，也不该让报错本身再失败一次。
 */
export function portHolder(port: number): string | undefined {
  try {
    const listing = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' })
    const pids = [...listing.matchAll(/^p(\d+)$/gm)].map((match) => match[1])
    if (pids.length === 0) return undefined
    return pids
      .map((pid) => {
        let command = ''
        try {
          command = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim().replace(/\s+/g, ' ')
        } catch {
          command = ''
        }
        return command === '' ? `pid ${pid}` : `pid ${pid}（${command}）`
      })
      .join('、')
  } catch {
    return undefined
  }
}

/** 原样转发到 mirror（含 WS 升级，见 proxyUpgrade）。 */
function proxyToMirror(req: IncomingMessage, res: ServerResponse, mirrorOrigin: string): void {
  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host') continue
    headers[key] = value
  }
  const preq = http.request(
    `${mirrorOrigin}${req.url ?? '/'}`,
    { method: req.method, headers },
    (pres) => {
      const out: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(pres.headers)) {
        if (value === undefined || key === 'transfer-encoding') continue
        out[key] = value
      }
      res.writeHead(pres.statusCode ?? 502, out)
      pres.pipe(res)
    },
  )
  preq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('lab: mirror proxy error')
  })
  req.pipe(preq)
}

function proxyUpgrade(req: IncomingMessage, clientSocket: Duplex, head: Buffer, mirrorOrigin: string): void {
  const preq = http.request(`${mirrorOrigin}${req.url ?? '/'}`, { headers: req.headers })
  preq.end()
  preq.on('upgrade', (pres, upstream) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [key, value] of Object.entries(pres.headers)) {
      if (value !== undefined) lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    clientSocket.write(lines.join('\r\n') + '\r\n\r\n')
    upstream.write(head)
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

/** 缺省网关地址（LAB_GATEWAY，缺省沿用扩展的 3080）。 */
export function defaultGateway(): string {
  return process.env.LAB_GATEWAY ?? 'http://127.0.0.1:3080'
}

/** 缺省实验室端口（LAB_PORT，0 = 随机）。 */
export function defaultPort(): number {
  return Number(process.env.LAB_PORT ?? 3179)
}
