/**
 * 整包分类与段首 id（#237）的确定性判据。
 *
 * 现场（用户报的那一起）：profile 里装了一个第三方插件之后，dsh web 正常、dsh-one 整页
 * 起不来。宿主日志里那句
 * `assembly mirror: rejected local combo ids @changfenhuang/dsh-genui,…` 是根因的脚印——
 * 镜像把请求里的一个 id 判成「本机插件」，名字又不像 `@dsh-one/*`，于是**整份请求**回 404，
 * 这一页那一批模块全拿不到（连官方件一起 `import failed`）。
 *
 * 为什么判错：认段首 id 的正则只认双引号（`id:"…"`），而那个第三方包的产物把自己那一行
 * 写成模板字面量（`id:\`…\``，0.11.0 的 `lib/client.js` 头 300 字节逐字如此）。
 *
 * 本文件钉四件事：
 * 1. `splitComboSegments` 认三种引号（双引号 / 单引号 / 模板字面量），认不出的段如实报
 *    `undefined`（调用方据此记诊断，不再静默漏一条）；
 * 2. 整包里那条「我们没见过」的第三方 id **不再让整份请求失败**：整包照旧 200、正文里
 *    既有官方保留段、也有我们自己落盘的那一段；
 * 3. 我们自己落盘的那份**按来源**伺服（`pluginsDir/<id>/client.js` 存在），名字不像
 *    `@dsh-one/*` 的一律不读盘（路径白名单 + 来源判据合一）；
 * 4. **负向对照**：`legacyLocalClassification: true`（= 改前那一套：只认双引号 + 不认识
 *    就整份 404）下，同一个请求必须回 404——证明第 2 条那些断言真的抓得住这个 bug。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as path from 'node:path'
import { scratchDir } from './scratchDirs.ts'
import { splitComboSegments, startAssemblyMirror } from '../src/server/assemblyMirror.ts'
import { CHAT_BLOCK_LIST, CHAT_FRAME_PLUGIN_ID } from '../src/ui/assembly/wireFilter.ts'

/** 那个第三方插件的 id（形状照现场那一个：不以 `@dsh-one/` 开头）。 */
const THIRD_PARTY_ID = '@third-party/dsh-genui-lab'

/** 官方保留的那一条（能被 block list 留住，用来证明官方那半照旧在正文里）。 */
const KEPT_ID = '@deepseek-ai/dsh-typert-registry'

/** 我们自己落盘的那一条（`pluginsDir` 下有它的 client.js）。 */
const LOCAL_ID = CHAT_FRAME_PLUGIN_ID

/** 名单里点名、可 `pluginsDir` 下没有产物：只丢它自己，不许影响别人。 */
const MISSING_LOCAL_ID = '@dsh-one/vscode-not-built'

/** 三段的写法：双引号（官方/自有产物）、模板字面量（第三方产物，#237 的现场形状）、单引号。 */
const segment = (id: string, quote: string): string =>
  `window.__ModuleLoader__.load({\n\tid: ${quote}${id}${quote},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\treturn module.exports;\n\t}\n});\n`

const DOUBLE = '"'
const BACKTICK = '`'
const SINGLE = "'"

/** 迷你网关：`/` 给一份单批 wire，application 批那条 combo 给三段（见上）。 */
async function startStubGateway(): Promise<{ origin: string; close: () => void }> {
  const comboBody = segment(KEPT_ID, DOUBLE) + segment(THIRD_PARTY_ID, BACKTICK)
  const wire = {
    rev: 'rev-root',
    entries: [
      { id: '@deepseek-ai/dsh-client-modules', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0', rev: 'r0' },
      { id: KEPT_ID, url: `/plugins/??${KEPT_ID}/client.js&rev=r1`, rev: 'r1' },
      { id: THIRD_PARTY_ID, url: `/plugins/??${THIRD_PARTY_ID}/client.js&rev=r2`, rev: 'r2' },
    ],
    batches: [
      { phase: 'bootstrap', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0', rev: 'r0', entries: ['@deepseek-ai/dsh-client-modules'] },
      {
        phase: 'application',
        url: `/plugins/??${KEPT_ID}/client.js,${THIRD_PARTY_ID}/client.js&rev=rev-app`,
        rev: 'rev-app',
        entries: [KEPT_ID, THIRD_PARTY_ID],
      },
    ],
  }
  const html = `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(wire)}</script></head><body></body></html>`
  const server = http.createServer((req, res) => {
    if ((req.url ?? '/') === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html)
      return
    }
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(comboBody)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return { origin: `http://127.0.0.1:${String(address.port)}`, close: () => server.close() }
}

/** 一份 pluginsDir：只放我们自己那条的产物。 */
async function pluginsDirWithLocalBundle(): Promise<string> {
  const dir = await scratchDir('dsh-one-bundle-')
  await fsp.mkdir(path.join(dir, LOCAL_ID), { recursive: true })
  await fsp.writeFile(path.join(dir, LOCAL_ID, 'client.js'), 'globalThis.__LAB_LOCAL_BUNDLE__ = 1\n')
  return dir
}

/** 页面实际会发的那条请求（官方保留段 + 第三方段 + 我们自己的 + 一条没产物的）。 */
const comboRequest = (extra: readonly string[] = [THIRD_PARTY_ID, KEPT_ID, LOCAL_ID]): string =>
  `/plugins-local/??${[...extra].map((id) => `${id}/client.js`).join(',')}&rev=rev-app-lab`

test('splitComboSegments：三种引号都认，认不出的段如实报 undefined', () => {
  const text = segment(KEPT_ID, DOUBLE) + segment(THIRD_PARTY_ID, BACKTICK) + segment(MISSING_LOCAL_ID, SINGLE) + 'window.__ModuleLoader__.load({ factory: () => 1 });\n'
  const parts = splitComboSegments(text)
  assert.deepEqual(
    parts.map((part) => part.id),
    [KEPT_ID, THIRD_PARTY_ID, MISSING_LOCAL_ID, undefined],
    '双引号 / 模板字面量 / 单引号都读得出来；最后那段没有 id 头就如实报 undefined',
  )
  assert.ok(parts[3]?.segment.includes('factory: () => 1'), '读不出 id 的段照样切得开（它仍会被原样伺服）')
})

test('镜像整包：#237 那条第三方 id 不再让整份请求失败，官方段与本地产物都照旧伺服', async () => {
  const dir = await pluginsDirWithLocalBundle()
  const gateway = await startStubGateway()
  const warnings: string[] = []
  const logger = { info: () => undefined, warn: (line: string) => warnings.push(line), error: () => undefined }
  const mirror = await startAssemblyMirror(() => gateway.origin, logger, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  try {
    const res = await fetch(`${mirror.origin}${comboRequest()}`)
    const body = await res.text()
    assert.equal(res.status, 200, '整份请求照旧 200（从前这里因为那条第三方 id 回 404）')
    assert.ok(body.includes(THIRD_PARTY_ID), '第三方那条的段在正文里（网关那份原样带着它）')
    assert.ok(body.includes(KEPT_ID), '官方保留段在正文里')
    assert.ok(body.includes('__LAB_LOCAL_BUNDLE__'), '我们自己落盘那一段也在（按来源伺服）')
    assert.equal(warnings.length, 0, `这条路上不该有告警：${warnings.join(' | ')}`)

    // 名单里有、产物却没有的那一条：**只丢它自己**，其余照旧。
    const partial = await fetch(`${mirror.origin}${comboRequest([KEPT_ID, LOCAL_ID, MISSING_LOCAL_ID])}`)
    const partialBody = await partial.text()
    assert.equal(partial.status, 200, '少一条自产物的请求也照旧 200（从前这里整份 502）')
    assert.ok(partialBody.includes(KEPT_ID) && partialBody.includes('__LAB_LOCAL_BUNDLE__'), '其余两段照旧在')
    assert.ok(
      warnings.some((line) => line.includes(MISSING_LOCAL_ID) && line.includes('not served from')),
      `日志点名那条没伺服到的：${warnings.join(' | ')}`,
    )
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('负向对照：改前那套分类（只认双引号 + 不认识就整份 404）下，同一个请求必须回 404', async () => {
  const dir = await pluginsDirWithLocalBundle()
  const gateway = await startStubGateway()
  const warnings: string[] = []
  const logger = { info: () => undefined, warn: (line: string) => warnings.push(line), error: () => undefined }
  const mirror = await startAssemblyMirror(() => gateway.origin, logger, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
    legacyLocalClassification: true,
  })
  try {
    const res = await fetch(`${mirror.origin}${comboRequest()}`)
    const body = await res.text()
    assert.equal(res.status, 404, '改前那套分类下那份请求就是 404（= 用户现场那一页整批拿不到模块）')
    assert.ok(!body.includes('__LAB_LOCAL_BUNDLE__'), '整份被拒，连我们自己那一段都发不出去')
    assert.ok(
      warnings.some((line) => line.includes('rejected local combo ids') && line.includes(THIRD_PARTY_ID)),
      `日志里正是现场那句：${warnings.join(' | ')}`,
    )
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('镜像整包：网关那份已带的自有 id 不重复伺服（#165 的重复注册不许回来）', async () => {
  const dir = await pluginsDirWithLocalBundle()
  const gateway = await startStubGateway()
  const mirror = await startAssemblyMirror(() => gateway.origin, { info: () => undefined, warn: () => undefined, error: () => undefined }, {
    pluginsDir: dir,
    treeCombos: [{ framePluginId: CHAT_FRAME_PLUGIN_ID, blockList: CHAT_BLOCK_LIST }],
  })
  try {
    // 用户把我们自己的包装进了 profile：网关那条 combo 里也有它（stub 里用 KEPT_ID 扮演）。
    await fsp.mkdir(path.join(dir, KEPT_ID), { recursive: true })
    await fsp.writeFile(path.join(dir, KEPT_ID, 'client.js'), 'globalThis.__LAB_DUPLICATE__ = 1\n')
    const res = await fetch(`${mirror.origin}${comboRequest([KEPT_ID, LOCAL_ID])}`)
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.equal((body.match(new RegExp(`id: "${KEPT_ID.replaceAll('/', '\\/')}"`, 'g')) ?? []).length, 1, '网关那份带过的 id 只出现一次（不叠加本地那份）')
    assert.ok(!body.includes('__LAB_DUPLICATE__'), '本地那份没有被拼进去')
  } finally {
    mirror.dispose()
    gateway.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
