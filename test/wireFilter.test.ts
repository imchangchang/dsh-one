import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_BLOCKED_IDS,
  SETTINGS_SHELL_PLUGIN_ID,
  SHELL_PLUGIN_ID,
  SIDEBAR_BLOCKED_IDS,
  SIDEBAR_BLOCK_LIST,
  SIDEBAR_SHELL_PLUGIN_ID,
  THEME_FOLLOW_PLUGIN_ID,
  extractBootWire,
  extractFrontendAssets,
  filterWire,
} from '../src/ui/assembly/wireFilter.ts'

/** 迷你网关 HTML 夹具：2 个 blocked + 2 个保留 + 完整四全局注入形态。 */
const FIXTURE_HTML = `<!doctype html>
<html><head><base href="/"><script>(()=>{ /* queue facade */ })()</script>
<script type="module" crossorigin src="./assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="./assets/vendor-BBB.js">
<link rel="stylesheet" crossorigin href="./assets/vendor-CCC.css">
<link rel="stylesheet" crossorigin href="./assets/index-DDD.css">
<script>globalThis["__DSH_BOOT__"] = {"rev":"rev-root","entries":[
{"id":"@deepseek-ai/dsh-client-modules","url":"/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0","rev":"r0","immediately":true},
{"id":"@deepseek-ai/dsh-client-ui-layout","url":"/plugins/??@deepseek-ai/dsh-client-ui-layout/client.js&rev=r1","rev":"r1","inject":["@deepseek-ai/dsh-client-ui-renderer"]},
{"id":"@deepseek-ai/dsh-client-ui-chat","url":"/plugins/??@deepseek-ai/dsh-client-ui-chat/client.js&rev=r2","rev":"r2","inject":["@deepseek-ai/dsh-client-ui-layout"]},
{"id":"@deepseek-ai/dsh-client-ui-sidebar","url":"/plugins/??@deepseek-ai/dsh-client-ui-sidebar/client.js&rev=r3","rev":"r3"},
{"id":"@deepseek-ai/dsh-client-ui-workspace","url":"/plugins/??@deepseek-ai/dsh-client-ui-workspace/client.js&rev=r4","rev":"r4","inject":["@deepseek-ai/dsh-client-ui-sidebar"]}
],"batches":[
{"phase":"bootstrap","url":"/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0","rev":"r0","entries":["@deepseek-ai/dsh-client-modules"]},
{"phase":"application","url":"/plugins/??@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-sidebar/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js&rev=rev-app","rev":"rev-app","entries":["@deepseek-ai/dsh-typert-registry","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-chat","@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-workspace"]}
]}</script>
<script src="/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=r0"></script>
</head><body><div id="root"></div></body></html>`

test('从网关 HTML 提取 wire 与前端资产', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  assert.equal(wire.rev, 'rev-root')
  assert.equal(wire.entries.length, 5)
  assert.equal(wire.batches.length, 2)
  const assets = extractFrontendAssets(FIXTURE_HTML)
  assert.equal(assets.moduleJs, 'assets/index-AAA.js')
  assert.deepEqual(assets.preloadJs, ['assets/vendor-BBB.js'])
  assert.deepEqual(assets.css, ['assets/vendor-CCC.css', 'assets/index-DDD.css'])
})

test('无 __DSH_BOOT__ 注入的 HTML 明确抛错', () => {
  assert.throws(() => extractBootWire('<html><body>nope</body></html>'), /__DSH_BOOT__/)
})

test('filterWire：剥 blocklist、application 批重指 /plugins-local、追加 shell、bootstrap 不动', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(wire)
  const ids = filtered.entries.map((e) => e.id)
  // blocklist 全被剔除（含保留包对它们的 inject 边——wire 元数据照抄网关原值，
  // cordis 服务改由 shell 提供；运行期不读条目的 inject 做加载校验）。
  for (const blocked of CHAT_BLOCKED_IDS) assert.ok(!ids.includes(blocked), `${blocked} 应被剔除`)
  // shell 恰好一个，url 指 /plugins-local。
  const shell = filtered.entries.filter((e) => e.id === SHELL_PLUGIN_ID)
  assert.equal(shell.length, 1)
  assert.match(shell[0].url, new RegExp(`^/plugins-local/\\?\\?${SHELL_PLUGIN_ID.replaceAll('/', '\\/')}/client\\.js&rev=rev-app$`))
  // 批：bootstrap 原样（引用相等即原对象）；application 重拼、rev 沿用、含 shell。
  assert.equal(filtered.batches[0], wire.batches[0])
  const app = filtered.batches[1]
  assert.equal(app.phase, 'application')
  assert.equal(app.rev, 'rev-app')
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-workspace',
    SHELL_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
  assert.match(
    app.url,
    /^\/plugins-local\/\?\?@deepseek-ai\/dsh-typert-registry\/client\.js,@deepseek-ai\/dsh-client-ui-chat\/client\.js,@deepseek-ai\/dsh-client-ui-workspace\/client\.js,@dsh-one\/vscode-shell\/client\.js,@dsh-one\/vscode-theme-follow\/client\.js&rev=rev-app$/,
  )
  assert.ok(!app.url.includes('ui-layout') && !app.url.includes('ui-sidebar'), 'application combo 不得含 blocked id')
})

test('filterWire：网关清单缺预期 blocklist 项即抛错（网关改版可见）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  wire.entries = wire.entries.filter((e) => e.id !== '@deepseek-ai/dsh-client-ui-sidebar')
  wire.batches[1].entries = wire.batches[1].entries.filter((id) => id !== '@deepseek-ai/dsh-client-ui-sidebar')
  assert.throws(() => filterWire(wire), /blocklist/)
})

test('filterWire（sidebar 树）：只剥官方外框，官方侧栏保留进侧栏位（#70）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(wire, SIDEBAR_BLOCK_LIST, SIDEBAR_SHELL_PLUGIN_ID)
  const ids = filtered.entries.map((e) => e.id)
  // 只有 ui-layout 被剔除；官方侧栏壳/工作区树必须保留。
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'), 'ui-layout 应被剔除')
  assert.ok(ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), '官方侧栏壳应保留')
  assert.ok(ids.includes('@deepseek-ai/dsh-client-ui-workspace'), '官方工作区树应保留')
  assert.deepEqual(SIDEBAR_BLOCKED_IDS, ['@deepseek-ai/dsh-client-ui-layout'])
  // sidebar frame 插件替换 shell 位。
  const shell = filtered.entries.filter((e) => e.id === SIDEBAR_SHELL_PLUGIN_ID)
  assert.equal(shell.length, 1)
  assert.match(
    shell[0].url,
    new RegExp(`^/plugins-local/\\?\\?${SIDEBAR_SHELL_PLUGIN_ID.replaceAll('/', '\\/')}/client\\.js&rev=rev-app$`),
  )
  const app = filtered.batches[1]
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-workspace',
    SIDEBAR_SHELL_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
  assert.ok(!app.url.includes('ui-layout'), 'application combo 不得含 ui-layout')
  assert.ok(app.url.includes('ui-sidebar'), 'sidebar 树 combo 必须含官方侧栏段')
})

test('filterWire（settings 树）：block list 同 chat 树（layout+sidebar），frame 换成 settings-shell（#70 设置独立成页）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  // settings 树清单 = CHAT_BLOCK_LIST（默认参数），只换 shell 插件 id。
  const filtered = filterWire(wire, undefined, SETTINGS_SHELL_PLUGIN_ID)
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'settings 树官方侧栏壳不进页')
  assert.ok(ids.includes(SETTINGS_SHELL_PLUGIN_ID))
  assert.ok(ids.includes(THEME_FOLLOW_PLUGIN_ID))
  const app = filtered.batches[1]
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-workspace',
    SETTINGS_SHELL_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
})
