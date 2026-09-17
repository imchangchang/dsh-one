/**
 * combo 缓存键里「我们自己那一半」的回归（#173）。
 *
 * 用户实测的现场：改完侧栏样式、`npm run build` 重建 `dist/assembly/plugins/<id>/client.js`
 * 之后，reload 窗口看到的还是旧界面——因为整包 URL（`/plugins-local/??<ids>&rev=<rev>`）
 * 与镜像的 ETag 一字不变，webview 吃满 24 小时的 `immutable` 缓存（连条件请求都不发）。
 * 修法：rev 里拼上本地产物的内容版本（`localBundleRev`），缓存键因此跟着本地产物走。
 *
 * 本文件钉两件事（浏览器里的端到端那一条在实验室 F-57）：
 * 1. 本地产物一变（改一个字节 / 加一个文件 / 删一个文件），`localBundleRev` 就变；
 *    没变时同一个值。
 * 2. 这份 rev 真的进了 combo URL 与镜像的 ETag，而镜像**仍回 immutable 长缓存**
 *    （#71 的初衷不能被顺手砍掉：官方那半仍享长缓存，且本地没变时 URL 一字不变）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { localBundleRev } from '../src/server/localBundleRev.ts'
import { startAssemblyMirror } from '../src/server/assemblyMirror.ts'
import { CHAT_BLOCK_LIST, CHAT_FRAME_PLUGIN_ID, filterWire, extractBootWire } from '../src/ui/assembly/wireFilter.ts'

/** 迷你网关的注入 HTML（与 test/wireFilter.test.ts 同形）。 */
const GATEWAY_HTML = `<!doctype html><html><head>
<script>globalThis["__DSH_BOOT__"] = {"rev":"rev-root","entries":[
{"id":"@deepseek-ai/dsh-client-modules","url":"/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0","rev":"r0","immediately":true},
{"id":"@deepseek-ai/dsh-client-ui-layout","url":"/plugins/??@deepseek-ai/dsh-client-ui-layout/client.js&rev=r1","rev":"r1"},
{"id":"@deepseek-ai/dsh-typert-registry","url":"/plugins/??@deepseek-ai/dsh-typert-registry/client.js&rev=r2","rev":"r2"}
],"batches":[
{"phase":"bootstrap","url":"/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0","rev":"r0","entries":["@deepseek-ai/dsh-client-modules"]},
{"phase":"application","url":"/plugins/??@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-typert-registry/client.js&rev=rev-app","rev":"rev-app","entries":["@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-typert-registry"]}
]}</script>
</head><body></body></html>`

/** 官方那半里会被保留的那一段（block 的 layout 那段由镜像剥掉）。 */
const KEPT_OFFICIAL_ID = '@deepseek-ai/dsh-typert-registry'

/** 建一个临时 pluginsDir，写入 `<id>/client.js` 的内容（内容可指定）。 */
async function pluginsDirWith(content: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-one-bundle-'))
  await fsp.mkdir(path.join(dir, CHAT_FRAME_PLUGIN_ID), { recursive: true })
  await fsp.writeFile(path.join(dir, CHAT_FRAME_PLUGIN_ID, 'client.js'), content)
  return dir
}

/** 这份本地产物下的 combo URL（走真实 filterWire，localRev 现算）。 */
async function comboUrlOf(pluginsDir: string): Promise<{ url: string; rev: string; localRev: string }> {
  const localRev = await localBundleRev(pluginsDir)
  const wire = filterWire(extractBootWire(GATEWAY_HTML), CHAT_BLOCK_LIST, CHAT_FRAME_PLUGIN_ID, [], localRev)
  const app = wire.batches[1]
  return { url: app.url, rev: app.rev, localRev }
}

test('localBundleRev：内容变了版本就变，没变就一样；增删文件也算变', async () => {
  const dir = await pluginsDirWith('window.__ModuleLoader__.load({ id: "x" })')
  try {
    const first = await localBundleRev(dir)
    assert.ok(/^[0-9a-f]{12}$/.test(first), `应是 12 位十六进制：${first}`)
    assert.equal(await localBundleRev(dir), first, '内容没变时同一个版本（长缓存才不会被无谓打破）')

    // ① 改一个字节（用户现场就是「改一行 CSS 重建」）
    await fsp.writeFile(path.join(dir, CHAT_FRAME_PLUGIN_ID, 'client.js'), 'window.__ModuleLoader__.load({ id: "y" })')
    const edited = await localBundleRev(dir)
    assert.notEqual(edited, first, '改了内容，版本必须变')

    // ② 加一个插件目录（build 多打出一个插件）
    await fsp.mkdir(path.join(dir, '@dsh-one/extra'), { recursive: true })
    await fsp.writeFile(path.join(dir, '@dsh-one/extra', 'client.js'), 'x')
    const added = await localBundleRev(dir)
    assert.notEqual(added, edited, '多一个文件，版本必须变')

    // ③ 删掉它（回到②之前的内容，但目录 mtime 之类都不同了——版本由内容决定，应当回到②前那个值）
    await fsp.rm(path.join(dir, '@dsh-one/extra'), { recursive: true })
    assert.equal(await localBundleRev(dir), edited, '内容回到原样，版本也该回到原值')

    // ④ 改名也算变（同样两条路径不同：这是「相对路径也进哈希」的证据）
    await fsp.rename(path.join(dir, CHAT_FRAME_PLUGIN_ID), path.join(dir, '@dsh-one/renamed'))
    assert.notEqual(await localBundleRev(dir), edited, '换路径，版本必须变')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('localBundleRev：目录不存在（还没 build）时给一个稳定值，不抛错', async () => {
  const missing = path.join(os.tmpdir(), `dsh-one-bundle-missing-${String(Date.now())}`)
  const rev = await localBundleRev(missing)
  assert.match(rev, /^[0-9a-f]{12}$/)
  assert.equal(await localBundleRev(missing), rev, '两次读同一个不存在的目录给同一个值（缓存键不能自己抖）')
})

test('本地产物一变，combo URL 的 rev 就跟着变（#173 的核心判据）', async () => {
  const dir = await pluginsDirWith('a')
  try {
    const before = await comboUrlOf(dir)
    assert.equal(
      before.rev,
      `rev-app-${before.localRev}`,
      'rev = 官方那半（网关 application 批的 rev）+ 本地那半（本地产物内容版本）',
    )
    assert.ok(before.url.endsWith(`&rev=${before.rev}`), before.url)

    // 没变的这一遍：内容一字不动 → URL 一字不动（长缓存靠的就是这个）
    assert.deepEqual(await comboUrlOf(dir), before, '本地产物没变时缓存键必须一字不变')

    await fsp.writeFile(path.join(dir, CHAT_FRAME_PLUGIN_ID, 'client.js'), 'b')
    const after = await comboUrlOf(dir)
    assert.notEqual(after.rev, before.rev, '本地产物变了，缓存键必须变（否则 webview 吃满 immutable 缓存）')
    assert.notEqual(after.url, before.url, 'URL 就是缓存键：变的是它，不是响应头')
    assert.ok(before.url.includes(`&rev=rev-app-${before.localRev}`) && after.url.includes(`&rev=rev-app-${after.localRev}`))
    assert.equal(after.url.slice(0, after.url.indexOf('&rev=')), before.url.slice(0, before.url.indexOf('&rev=')), '变的只是 rev 那一截，id 列表不动')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

/** 迷你网关：`/` 给注入 HTML，application 批那条 combo 给两段可切的自注册 IIFE。 */
async function startStubGateway(): Promise<{ origin: string; close: () => void }> {
  const segment = (id: string): string =>
    `window.__ModuleLoader__.load({\n\tid: "${id}",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} }; var exports = module.exports;\n\t\treturn module.exports;\n\t}\n});\n`
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(GATEWAY_HTML)
      return
    }
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(segment('@deepseek-ai/dsh-client-ui-layout') + segment(KEPT_OFFICIAL_ID))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return { origin: `http://127.0.0.1:${String(address.port)}`, close: () => server.close() }
}

test('镜像：combo 仍回 immutable 长缓存，且 ETag 里带着本地那一半（#173）', async () => {
  const dir = await pluginsDirWith('local-bundle-bytes')
  const gateway = await startStubGateway()
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const mirror = await startAssemblyMirror(
    () => gateway.origin,
    logger,
    { pluginsDir: dir, treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }] },
  )
  try {
    const { url, rev } = await comboUrlOf(dir)
    const res = await fetch(`${mirror.origin}${url}`)
    assert.equal(res.status, 200)
    assert.equal(
      res.headers.get('cache-control'),
      'max-age=86400, immutable',
      '#71 的长缓存没被砍：本地没变时整包网络字节≈0 这条照旧',
    )
    assert.equal(res.headers.get('etag'), `"dsh-combo-${rev}-${CHAT_FRAME_PLUGIN_ID}"`, 'ETag 的 rev 里含本地那半')
    const body = await res.text()
    assert.ok(body.includes(KEPT_OFFICIAL_ID), '官方那半由镜像剥段后拼进来')
    assert.ok(!body.includes('@deepseek-ai/dsh-client-ui-layout'), '被 block 的官方段被镜像剥掉')
    assert.ok(body.includes('local-bundle-bytes'), '本地那半读的是 pluginsDir 下那份产物')

    // 本地重建之后：URL（缓存键）与 ETag 一起变，浏览器按新条目重取新内容。
    await fsp.writeFile(path.join(dir, CHAT_FRAME_PLUGIN_ID, 'client.js'), 'rebuilt-bytes')
    const rebuilt = await comboUrlOf(dir)
    assert.notEqual(rebuilt.url, url, '重建后页面拿到的是另一个 combo URL')
    const res2 = await fetch(`${mirror.origin}${rebuilt.url}`)
    assert.equal(res2.status, 200)
    assert.equal(res2.headers.get('etag'), `"dsh-combo-${rebuilt.rev}-${CHAT_FRAME_PLUGIN_ID}"`)
    assert.ok((await res2.text()).includes('rebuilt-bytes'), '新 URL 取到的是新产物')
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
