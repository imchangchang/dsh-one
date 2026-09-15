import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_BLOCKED_IDS,
  SETTINGS_BLOCKED_IDS,
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
  // 夹具是小网关（5 插件）；语义用显式最小清单验证，完整树清单另测内容。
  const filtered = filterWire(wire, [
    { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
    { id: '@deepseek-ai/dsh-client-ui-sidebar', reason: 'fixture' },
  ])
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'), 'ui-layout 应被剔除')
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'ui-sidebar 应被剔除')
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

test('filterWire（sidebar 树）：外框+对话流+设置子页剥除，官方侧栏/工作区树保留（#70/#71）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(wire, [
    { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
    { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'fixture' },
  ], SIDEBAR_SHELL_PLUGIN_ID)
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'), 'ui-layout 应被剔除')
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-chat'), 'chat 流应被剔除')
  assert.ok(ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), '官方侧栏壳应保留')
  assert.ok(ids.includes('@deepseek-ai/dsh-client-ui-workspace'), '官方工作区树应保留')
  // 树清单内容（#71 瘦身闭包）：layout 必在；对话流卡片与设置子页在列；
  // 工作区树/ui-settings/ui-input-trigger/ui-cordis 等闭包保留件不在列。
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-chat'))
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-workspace'))
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-input-trigger'))
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
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-workspace',
    SIDEBAR_SHELL_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
  assert.ok(!app.url.includes('ui-layout') && !app.url.includes('ui-chat'), 'application combo 不得含 blocked id')
  assert.ok(app.url.includes('ui-sidebar'), 'sidebar 树 combo 必须含官方侧栏段')
})

test('filterWire（settings 树）：外框+官方侧栏+对话流剥除，frame 换 settings-shell（#70/#71）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(wire, [
    { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
    { id: '@deepseek-ai/dsh-client-ui-sidebar', reason: 'fixture' },
    { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'fixture' },
  ], SETTINGS_SHELL_PLUGIN_ID)
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'settings 树官方侧栏壳不进页')
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-chat'), 'settings 树对话流不进页')
  assert.ok(ids.includes(SETTINGS_SHELL_PLUGIN_ID))
  assert.ok(ids.includes(THEME_FOLLOW_PLUGIN_ID))
  // 树清单内容：settings 树 = layout+sidebar+对话流组（chat/conversation 保留——
  // 「对话显示」设置行是 ui-chat 贡献，Enter 行为行是 ui-conversation 贡献）。
  assert.ok(!SETTINGS_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-chat'))
  assert.ok(!SETTINGS_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.ok(SETTINGS_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-tool'))
  assert.ok(!SETTINGS_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-models'))
  const app = filtered.batches[1]
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-workspace',
    SETTINGS_SHELL_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
})
