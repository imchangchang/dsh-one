/**
 * 事件流上的 roster 过滤（#191）。
 *
 * 现场：dsh 0.1.6-alpha.2 上装配页**整棵渲染不出来**（`renderSlot('root') before any
 * 'root' registration`），四棵树皆然。根因是页面上的 roster 有两条来路——
 * ① 页面 boot 时那份 `__DSH_BOOT__`（我们按该树 block list 过滤过）；
 * ② 官方前端自己开的那条 SSE（`dsh-client-hmr` 的 `/plugins/events`）里 `type: "graph"`
 * 的帧，带的是**宿主下发的全量 roster，没过滤**。
 * `dsh-client-hmr` 的浏览器半在 0.1.6-alpha.1 上对 graph 帧「收到就丢」，alpha.2 改成
 * 交给客户端条目协调器（`ctx.modules.entries.sync`）按它增删页面上的插件条目——于是
 * 未过滤的那一份上位：被 block 的官方插件装回来、我们自己的 frame 插件条目被卸掉，
 * root 槽的注册随之撤销，整页白。
 *
 * 修法：这条流也由镜像伺服（`/plugins-local/events`），每一帧都按该树的 `filterWire`
 * 重新投影——与 boot 那一份**同一个函数**（所以不需要按版本分叉：alpha.1 丢掉这些帧，
 * 投影在那一版上是空转）。本文件钉四件事：
 * 1. graph 帧真的被投影：block 的官方 id 没了、自有插件 id 补回来了、批次表也对得上；
 * 2. 非 graph 帧（`rebuilt` 帧、`: connected` 注释行）原样透传，一个字不动；
 * 3. 投影不了（清单与 block list 对不上）时**丢帧**而不是放行——放行会立刻把页面洗白，
 *    丢帧只让页面保持自己那份 roster（退化成 alpha.1 的行为）；
 * 4. HTTP 契约：未知树 / 非 GET 一律 404；追加列表里混进不认识的名字时**只丢那一条**
 *    （#237），页面断开时上游连接一起收掉。
 *
 * #243 起还钉**名册基线参数（`revs`）的编码**（文件末尾那两条用例）：页面那份编码端
 * （`pageHtml.ts` 的 `transportJs`，活在页面里、只能另写一份）与镜像那份解码端
 * （`wireFilter.ts` 的 `parseRosterRevs`）必须对同一份清单给出同一份 `id → rev`——
 * 分隔符 `,` 真的会出现在值里（0.1.7 起自有条目的 rev = 多个 application 批并起来的
 * 整包缓存键，里面就带着一个 `,`），少了一层转义就会被截断成错的基线，镜像是拿它对
 * 名册的，对齐错 → 客户端把自有 frame 插件先拆后建 → `root` 槽注册撤销 → 整页白
 * （#243 现场就是这个）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { scratchDir } from './scratchDirs.ts'
import { startAssemblyMirror } from '../src/server/assemblyMirror.ts'
import { localBundleRev } from '../src/server/localBundleRev.ts'
import { assemblyPageHtml, transportJs } from '../src/ui/assembly/pageHtml.ts'
import {
  CHAT_BLOCK_LIST,
  CHAT_FRAME_PLUGIN_ID,
  filterWire,
  projectGraphFrame,
  extractBootWire,
  parseRosterRevs,
  ROSTER_REVS_PARAM,
} from '../src/ui/assembly/wireFilter.ts'

/** 宿主下发的全量 roster（三条：一条我们 block、一条保留、一条是本树的 frame 插件）。 */
const HOST_WIRE = {
  rev: 'rev-host',
  entries: [
    { id: '@deepseek-ai/dsh-client-modules', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0', rev: 'r0' },
    { id: '@deepseek-ai/dsh-client-ui-layout', url: '/plugins/??@deepseek-ai/dsh-client-ui-layout/client.js&rev=r1', rev: 'r1' },
    { id: '@deepseek-ai/dsh-typert-registry', url: '/plugins/??@deepseek-ai/dsh-typert-registry/client.js&rev=r2', rev: 'r2' },
  ],
  batches: [
    { phase: 'bootstrap', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0', rev: 'r0', entries: ['@deepseek-ai/dsh-client-modules'] },
    {
      phase: 'application',
      url: '/plugins/??@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-typert-registry/client.js&rev=rev-app',
      rev: 'rev-app',
      entries: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-typert-registry'],
    },
  ],
}

/** 网关 `/` 的注入 HTML（镜像只从这里取事件流路由，取不到也无妨）。 */
const GATEWAY_HTML = `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(HOST_WIRE)}</script></head><body></body></html>`

/** 本树追加的第二个自有插件（投影要把它补回 roster）。 */
const EXTRA_PLUGIN_ID = '@dsh-one/vscode-theme-follow'

const BLOCKED_ID = '@deepseek-ai/dsh-client-ui-layout'
const KEPT_ID = '@deepseek-ai/dsh-typert-registry'

/** 迷你网关：`/` 给注入 HTML，`/plugins/events` 给一条 SSE（注释行 + graph 帧 + rebuilt 帧）。 */
async function startStubGateway(): Promise<{ origin: string; close: () => void; eventRequests: string[] }> {
  const eventRequests: string[] = []
  const server = http.createServer((req, res) => {
    if ((req.url ?? '/') === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(GATEWAY_HTML)
      return
    }
    if ((req.url ?? '/') === '/plugins/events') {
      eventRequests.push(req.headers['accept-encoding'] ?? '')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(': connected\n\n')
      res.write(`data: ${JSON.stringify({ type: 'graph', graph: HOST_WIRE })}\n\n`)
      res.write(`data: ${JSON.stringify({ type: 'rebuilt', id: KEPT_ID, rev: 'r9' })}\n\n`)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return { origin: `http://127.0.0.1:${String(address.port)}`, close: () => server.close(), eventRequests }
}

/** 临时 pluginsDir：写入该树的自有插件产物（mirror 读它、localBundleRev 也按它算）。 */
async function pluginsDir(): Promise<string> {
  const dir = await scratchDir('dsh-one-events-')
  for (const id of [CHAT_FRAME_PLUGIN_ID, EXTRA_PLUGIN_ID]) {
    await fsp.mkdir(path.join(dir, id), { recursive: true })
    await fsp.writeFile(path.join(dir, id, 'client.js'), `window.__ModuleLoader__.load({ id: "${id}" })`)
  }
  return dir
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** 读一条 SSE 流的前 `count` 帧（每帧到空行止），读完就断开。 */
async function readFrames(url: string, count: number): Promise<string[]> {
  const controller = new AbortController()
  const res = await fetch(url, { signal: controller.signal })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  const reader = res.body?.getReader()
  assert.ok(reader !== undefined)
  const decoder = new TextDecoder()
  const frames: string[] = []
  let buffer = ''
  while (frames.length < count) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index !== -1 && frames.length < count) {
      frames.push(buffer.slice(0, index + 2))
      buffer = buffer.slice(index + 2)
      index = buffer.indexOf('\n\n')
    }
  }
  controller.abort()
  assert.equal(frames.length, count, `期望读到 ${String(count)} 帧，实到 ${String(frames.length)}：${JSON.stringify(frames)}`)
  return frames
}

test('projectGraphFrame：graph 帧换掉、其余帧一字不动', () => {
  const project = (graph: unknown): never => graph as never
  const comment = ': connected\n\n'
  assert.equal(projectGraphFrame(comment, project), comment, '注释帧不碰')
  const rebuilt = 'data: {"type":"rebuilt","id":"x","rev":"r"}\n\n'
  assert.equal(projectGraphFrame(rebuilt, project), rebuilt, 'rebuilt 帧不碰')
  const other = 'data: not-json\n\n'
  assert.equal(projectGraphFrame(other, project), other, '非 JSON 的 data 帧不碰')

  const graphFrame = `data: ${JSON.stringify({ type: 'graph', graph: HOST_WIRE })}\n\n`
  const projected = projectGraphFrame(graphFrame, (graph) => ({ ...graph, rev: 'projected' }))
  assert.equal(projected, `data: ${JSON.stringify({ type: 'graph', graph: { ...HOST_WIRE, rev: 'projected' } })}\n\n`)
})

test('镜像事件流：graph 帧按该树 block list 投影，rebuilt 帧原样透传（#191）', async () => {
  const dir = await pluginsDir()
  const gateway = await startStubGateway()
  const mirror = await startAssemblyMirror(() => gateway.origin, silent, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  try {
    const ids = [CHAT_FRAME_PLUGIN_ID, EXTRA_PLUGIN_ID].join(',')
    const frames = await readFrames(`${mirror.origin}/plugins-local/events?ids=${ids}`, 3)
    assert.equal(frames[0], ': connected\n\n', '注释行透传')
    assert.equal(
      gateway.eventRequests[0],
      'identity',
      '向上游要明文：逐帧投影要读 SSE 的字节，让网关别按浏览器的 accept-encoding 压一遍',
    )

    // ① graph 帧：与页面 boot 那份走同一个 filterWire，所以这里拿它当唯一口径对照。
    //    本地那半 rev 由镜像按 pluginsDir 现算，测试照同一个函数取。
    const expected = filterWire(HOST_WIRE, CHAT_BLOCK_LIST, CHAT_FRAME_PLUGIN_ID, [EXTRA_PLUGIN_ID], await localBundleRev(dir))
    const actual = JSON.parse((frames[1] ?? '').slice('data:'.length))
    assert.equal(actual.type, 'graph')
    assert.deepEqual(actual.graph, expected, 'graph 帧 = 该树 filterWire 的产物（同一份事实源）')
    const ids2 = (actual.graph as { entries: { id: string }[] }).entries.map((entry) => entry.id)
    assert.ok(!ids2.includes(BLOCKED_ID), '被 block 的官方插件不在 roster 里（这正是 #191 的判据）')
    assert.ok(ids2.includes(KEPT_ID), '保留的官方插件还在')
    assert.ok(ids2.includes(CHAT_FRAME_PLUGIN_ID) && ids2.includes(EXTRA_PLUGIN_ID), '自有插件条目被补回 roster')
    const batchIds = (actual.graph as { batches: { entries: string[] }[] }).batches.flatMap((batch) => batch.entries)
    assert.deepEqual([...batchIds].sort(), [...ids2].sort(), '每个条目都属于且只属于一个批次')

    // ② rebuilt 帧（HMR 重建）不归投影管：一个字都不能动。
    assert.equal(frames[2], `data: ${JSON.stringify({ type: 'rebuilt', id: KEPT_ID, rev: 'r9' })}\n\n`)
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('镜像事件流：投影不了就丢帧（不放行未过滤的 roster）', async () => {
  const dir = await pluginsDir()
  const gateway = await startStubGateway()
  // block list 里点一个宿主清单里**有、但不在任何 application 批里**的 id：filterWire
  // 会硬抛（那种条目过滤管道够不着）。这一帧必须被丢掉，否则未过滤的 roster 会放行、
  // 页面被洗白。
  const broken = [{ id: '@deepseek-ai/dsh-client-modules', reason: 'test: bootstrap-only id' }]
  const mirror = await startAssemblyMirror(() => gateway.origin, silent, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: broken }],
  })
  try {
    const frames = await readFrames(`${mirror.origin}/plugins-local/events?ids=${CHAT_FRAME_PLUGIN_ID}`, 2)
    assert.equal(frames[0], ': connected\n\n', '注释行照旧透传')
    assert.ok(frames[1]?.startsWith('data: {"type":"rebuilt"'), `graph 帧被丢掉，紧接着就是 rebuilt 帧：${String(frames[1])}`)
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('镜像事件流：未知树 / 非 GET 是 404；追加列表里混进不认识的名字只丢那一条（#237）', async () => {
  const dir = await pluginsDir()
  const gateway = await startStubGateway()
  const warnings: string[] = []
  const mirror = await startAssemblyMirror(() => gateway.origin, { ...silent, warn: (line: string) => warnings.push(line) }, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  try {
    // 第一个 id 决定取哪棵树的 block list：缺了它、或它不是一棵树，就没法投影 —— 404。
    for (const query of ['', '?ids=@dsh-one/not-a-tree']) {
      const res = await fetch(`${mirror.origin}/plugins-local/events${query}`)
      assert.equal(res.status, 404, `应当 404：${query}`)
      await res.text()
    }
    const post = await fetch(`${mirror.origin}/plugins-local/events?ids=${CHAT_FRAME_PLUGIN_ID}`, { method: 'POST' })
    assert.equal(post.status, 404, '只认 GET')
    await post.text()
    // 追加列表（第一个之后的那些）是「要补回 roster 的自有插件 id」：混进一条不认识的名字时
    // **只丢那一条**，整条流照旧开得出来（#237 同一口径——这条流一停，页面的名册就停在 boot
    // 那一刻那份）。被丢的那条要点名记在日志里，不能静默。
    const frames = await readFrames(
      `${mirror.origin}/plugins-local/events?ids=${CHAT_FRAME_PLUGIN_ID},@deepseek-ai/evil,${EXTRA_PLUGIN_ID}`,
      3,
    )
    assert.equal(frames[0], ': connected\n\n', '混进不认识的名字时整条流照常开得出来')
    assert.ok(frames[1]?.startsWith('data: {"type":"graph"'), `graph 帧照旧投影：${String(frames[1])}`)
    assert.ok(
      warnings.some((line) => line.includes('@deepseek-ai/evil')),
      `日志里点名被丢掉的那条：${warnings.join(' | ')}`,
    )
    assert.ok(!warnings.some((line) => line.includes(EXTRA_PLUGIN_ID)), '认得出的那条不许被丢')
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('镜像事件流：页面断开时上游连接一起收掉（不留 ESTABLISHED）', async () => {
  const dir = await pluginsDir()
  let open = 0
  let closed = 0
  const gateway = http.createServer((req, res) => {
    if ((req.url ?? '/') === '/plugins/events') {
      open += 1
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': connected\n\n')
      res.on('close', () => {
        closed += 1
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(GATEWAY_HTML)
  })
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve))
  const address = gateway.address()
  assert.ok(address !== null && typeof address === 'object')
  const mirror = await startAssemblyMirror(() => `http://127.0.0.1:${String(address.port)}`, silent, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  try {
    const frames = await readFrames(`${mirror.origin}/plugins-local/events?ids=${CHAT_FRAME_PLUGIN_ID}`, 1)
    assert.equal(frames[0], ': connected\n\n')
    assert.equal(open, 1)
    // 读数是被 abort 掉的那次 fetch 触发的服务端收尾：给它一点时间落定。
    for (let i = 0; i < 50 && closed === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(closed, 1, '页面断开后上游那条流也要收掉（#88 的进程不退出就是这类泄漏）')
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('装配页把事件流改道到镜像：带上本树的自有插件 id', async () => {
  const html = assemblyPageHtml({
    mirrorOrigin: 'http://127.0.0.1:1',
    cspNonce: 'n',
    assets: { moduleJs: 'assets/index-x.js', preloadJs: ['assets/vendor.js'], css: ['assets/index.css'] },
    bootWire: { rev: 'r', entries: [], batches: [] },
    bootstrapUrl: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r',
    theme: 'dark',
    localPluginIds: [CHAT_FRAME_PLUGIN_ID, EXTRA_PLUGIN_ID],
  })
  assert.ok(
    html.includes(`"/plugins-local/events?ids=" + LOCAL_PLUGIN_IDS.map(encodeURIComponent).join(",")`),
    '事件流 URL 由页面侧现拼（第一个 id 决定镜像取哪棵树的 block list）',
  )
  assert.ok(html.includes(`["${CHAT_FRAME_PLUGIN_ID}","${EXTRA_PLUGIN_ID}"]`), '该树的自有插件 id 进了页面')
  assert.ok(html.includes('"/plugins/events"'), '只改道官方那条事件流，别的 EventSource 不动')
})

// ---------------------------------------------------------------------------
// 名册基线参数（`revs`）的编码（#243）
// ---------------------------------------------------------------------------

/**
 * 页面那份编码端（`transportJs` 里的 `rosterRevs`）跑一遍，拿它真的拼出来的那条流 URL。
 *
 * 为什么要在沙箱里真跑：这一段只能活在页面内联脚本里（它读 `globalThis.__DSH_BOOT__`），
 * 所以它和镜像那份解码端是**两份实现**——本文件末尾那两条用例就是要让它们对着同一份清单
 * 比一次，转义那一层谁写歪了就红。沙箱只要给页面脚本用到的那几个全局（`EventSource` /
 * `fetch` / `location` / `document`），传输层其余部分（退避、openStream）本用例不碰。
 */
function pageStreamUrl(wire: unknown, options: { legacyRosterRevs?: boolean } = {}): string {
  const urls: string[] = []
  class StubEventSource {
    constructor(url: unknown) {
      urls.push(String(url))
    }
    addEventListener(): void {}
  }
  const context = vm.createContext({
    EventSource: StubEventSource,
    URL,
    JSON,
    console,
    setTimeout,
    location: { href: 'http://lab.local/chat', origin: 'http://lab.local', protocol: 'http:', host: 'lab.local' },
    document: { baseURI: 'http://lab.local/chat' },
    fetch: () => Promise.resolve({ ok: true, status: 200 }),
    __DSH_BOOT__: wire,
  })
  const script = transportJs('http://127.0.0.1:9500', [CHAT_FRAME_PLUGIN_ID, EXTRA_PLUGIN_ID], true, options.legacyRosterRevs === true)
  vm.runInContext(script, context, { filename: 'transport.js' })
  vm.runInContext('globalThis.__pageStream = new EventSource("/plugins/events")', context, { filename: 'page.js' })
  assert.equal(urls.length, 1, '页面没有把官方那条事件流改道（transportJs 的 EventSource 钩子没生效）')
  return urls[0] ?? ''
}

/** 一条自带的清单：自有条目的 rev 里**带着分隔符**（0.1.7 起自有条目的真实形状，见下）。 */
const COMMA_REV = '117817dcabda,0ec98e9bdd7b-694f1d2833d5'

const COMMA_WIRE = {
  rev: 'rev-host',
  entries: [
    { id: '@deepseek-ai/dsh-typert-registry', url: '/plugins/??x&rev=r2', rev: 'r2' },
    { id: CHAT_FRAME_PLUGIN_ID, url: `/plugins-local/??x&rev=${COMMA_REV}`, rev: COMMA_REV },
    { id: EXTRA_PLUGIN_ID, url: `/plugins-local/??y&rev=${COMMA_REV}`, rev: COMMA_REV },
  ],
  batches: [
    { phase: 'bootstrap', url: '/plugins/??x&rev=r0', rev: 'r0', entries: ['@deepseek-ai/dsh-client-modules'] },
    { phase: 'application', url: '/plugins-local/??x&rev=r1', rev: 'r1', entries: [CHAT_FRAME_PLUGIN_ID, EXTRA_PLUGIN_ID] },
  ],
}

test('名册基线参数：页面那份编码端编出来的每一对，镜像那份解码端都原样解回来（#243）', () => {
  const url = new URL(pageStreamUrl(COMMA_WIRE), 'http://lab.local')
  const raw = url.searchParams.get(ROSTER_REVS_PARAM) ?? ''
  // 现场有效性：这一份清单里真的有一条 rev 带着分隔符——没有它，下面那条断言在这个形状
  // 下就是空转（这正是 0.1.6 及更早的清单形状：application 只有一个批，rev 里不含 `,`）。
  assert.ok(
    COMMA_WIRE.entries.some((entry) => entry.rev.includes(',')),
    '夹具本身要有一条 rev 带分隔符，否则这条用例证明不了编码有没有用',
  )
  assert.ok(raw.includes('"'), `编出来的应当是 JSON（JSON 自带结构，值里出现什么都不影响）：${raw}`)
  const parsed = parseRosterRevs(raw)
  for (const entry of COMMA_WIRE.entries) {
    assert.equal(parsed.get(entry.id), entry.rev, `${entry.id} 的 rev 要原样来回（含分隔符那几条）`)
  }
  // 页面侧那个开关只该改编码，不该改别的：编码端换了之后，事件流的 id 表一个字不动。
  assert.equal(url.searchParams.get('ids'), `${CHAT_FRAME_PLUGIN_ID},${EXTRA_PLUGIN_ID}`)
})

test('名册基线参数：负向对照——改前那套原样拼接会把带分隔符的 rev 截断（#243）', () => {
  const raw =
    new URL(pageStreamUrl(COMMA_WIRE, { legacyRosterRevs: true }), 'http://lab.local').searchParams.get(ROSTER_REVS_PARAM) ?? ''
  const legacy = parseRosterRevs(raw)
  // 这一档就是改前那一份页面编出来的东西（`id:rev,id:rev`）：不带分隔符的条目照旧对得上，
  // 带分隔符的那一条被切成两段、只剩前一半——镜像于是拿它当「这一条变了」，客户端先拆后建，
  // 拆掉自有 frame 插件时 `root` 槽注册随之撤销、整页白（#243 现场）。
  assert.equal(legacy.get('@deepseek-ai/dsh-typert-registry'), 'r2', '不带分隔符的那一条两档一致')
  assert.notEqual(legacy.get(CHAT_FRAME_PLUGIN_ID), COMMA_REV, '带分隔符的那一条在这一档必须对不上（否则这条负向对照是空的）')
})

test('镜像事件流：基线里的 rev 含着分隔符时也照原样对齐（#243）', async () => {
  const dir = await pluginsDir()
  const gateway = await startStubGateway()
  const mirror = await startAssemblyMirror(() => gateway.origin, silent, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  const encode = (id: string, rev: string): string => encodeURIComponent(JSON.stringify([[id, rev]]))
  // 页面 boot 那份清单（编成 JSON 参数）：自有条目那一半就是整包缓存键
  // `${applicationComboRev}-${localRev}`——0.1.7 起官方有两个 application 批，`appRev`
  // 是两份批 rev 用逗号并起来，于是这个值里真的带着一个 `,`（本用例就照这个形状给）。
  const bootRevs = new Map<string, string>([
    ['@deepseek-ai/dsh-client-modules', 'r0'],
    ['@deepseek-ai/dsh-typert-registry', 'r2'],
    [CHAT_FRAME_PLUGIN_ID, COMMA_REV],
    [EXTRA_PLUGIN_ID, COMMA_REV],
  ])
  const param = encodeURIComponent(JSON.stringify([...bootRevs]))
  try {
    const ids = `${CHAT_FRAME_PLUGIN_ID},${EXTRA_PLUGIN_ID}`
    const frames = await readFrames(`${mirror.origin}/plugins-local/events?ids=${ids}&${ROSTER_REVS_PARAM}=${param}`, 2)
    const frame = JSON.parse((frames[1] ?? '').slice('data:'.length)) as {
      graph: { entries: { id: string; rev: string }[] }
    }
    const framed = new Map(frame.graph.entries.map((entry) => [entry.id, entry.rev]))
    for (const [id, rev] of bootRevs) {
      // HOST_WIRE 里没有 `@deepseek-ai/dsh-client-modules` 之外的 bootstrap 条目也无妨：
      // 对不上的那几条由 filterWire 决定，这里只比对名字两侧都有的。
      if (!framed.has(id)) continue
      assert.equal(framed.get(id), rev, `${id} 推给页面的 rev 要等于这一页 boot 那份（含带分隔符的那几条）`)
    }
    assert.equal(framed.get(EXTRA_PLUGIN_ID), COMMA_REV, '带分隔符那一条没被截断（这就是 #243 的修法本身）')
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
