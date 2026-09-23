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
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as path from 'node:path'
import { scratchDir } from './scratchDirs.ts'
import { startAssemblyMirror } from '../src/server/assemblyMirror.ts'
import { localBundleRev } from '../src/server/localBundleRev.ts'
import { CHAT_BLOCK_LIST, CHAT_FRAME_PLUGIN_ID, filterWire, projectGraphFrame, extractBootWire } from '../src/ui/assembly/wireFilter.ts'

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
  const { assemblyPageHtml } = await import('../src/ui/assembly/pageHtml.ts')
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
