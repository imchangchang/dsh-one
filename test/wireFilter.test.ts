import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_BLOCKED_IDS,
  CHAT_FRAME_PLUGIN_ID,
  GIT_CARD_PLUGIN_ID,
  SETTINGS_BLOCKED_IDS,
  SETTINGS_FRAME_PLUGIN_ID,
  SIDEBAR_BLOCKED_IDS,
  SIDEBAR_FRAME_PLUGIN_ID,
  THEME_FOLLOW_PLUGIN_ID,
  extractBootWire,
  extractFrontendAssets,
  filterWire,
  bootstrapUrlOf,
  type BootWire,
} from '../src/ui/assembly/wireFilter.ts'

/**
 * 本地产物的内容版本（combo 缓存键里我们自己那一半，#173）：这里给常量，因为
 * 「内容变了 rev 就变」由 `test/comboCacheRev.test.ts` 用真文件系统钉，本文件
 * 只管「rev 怎么拼进 URL」。
 */
const LOCAL_REV = 'lrev-fixture'

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

/**
 * #178 A9：装配页的阻塞 script 取 bootstrap 批 URL，按 `phase === 'bootstrap'` 找，
 * **不假定它排在 `batches[0]`**（批次顺序是官方下发的形状，不是契约）。
 */
test('bootstrapUrlOf：按 phase 找 bootstrap 批，不看它在第几位；找不到就抛', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  assert.equal(bootstrapUrlOf(wire), wire.batches[0].url, '夹具里它恰好排第一')
  // 把 application 批挪到前面：位置变了，取到的还是 bootstrap 那条。
  const reordered: BootWire = { ...wire, batches: [wire.batches[1], wire.batches[0], ...wire.batches.slice(2)] }
  assert.equal(bootstrapUrlOf(reordered), wire.batches[0].url, '批次顺序不是契约：按 phase 找')
  assert.throws(
    () => bootstrapUrlOf({ ...wire, batches: wire.batches.filter((b) => b.phase !== 'bootstrap') }),
    /no bootstrap batch/,
    '没有 bootstrap 批要响亮抛错（少了它官方 WebBoot 根本不会启动）',
  )
})

test('filterWire：剥 blocklist、application 批重指 /plugins-local、追加 shell、bootstrap 不动', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  // 夹具是小网关（5 插件）；语义用显式最小清单验证，完整树清单另测内容。
  const filtered = filterWire(
    wire,
    [
      { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
      { id: '@deepseek-ai/dsh-client-ui-sidebar', reason: 'fixture' },
    ],
    undefined,
    undefined,
    LOCAL_REV,
  )
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'), 'ui-layout 应被剔除')
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'ui-sidebar 应被剔除')
  // shell 恰好一个，url 指 /plugins-local，rev = 官方那半 + 本地那半（#173）。
  const shell = filtered.entries.filter((e) => e.id === CHAT_FRAME_PLUGIN_ID)
  assert.equal(shell.length, 1)
  assert.match(
    shell[0].url,
    new RegExp(`^/plugins-local/\\?\\?${CHAT_FRAME_PLUGIN_ID.replaceAll('/', '\\/')}/client\\.js&rev=rev-app-${LOCAL_REV}$`),
  )
  assert.equal(shell[0].rev, `rev-app-${LOCAL_REV}`)
  // 批：bootstrap 原样（引用相等即原对象）；application 重拼、rev 是双半缓存键、含 shell。
  assert.equal(filtered.batches[0], wire.batches[0])
  const app = filtered.batches[1]
  assert.equal(app.phase, 'application')
  assert.equal(app.rev, `rev-app-${LOCAL_REV}`)
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-workspace',
    CHAT_FRAME_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
  assert.ok(
    app.url.startsWith(
      '/plugins-local/??@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js,@dsh-one/vscode-chat-ui-layout/client.js,@dsh-one/vscode-theme-follow/client.js',
    ),
    `application combo 的 id 列表：${app.url}`,
  )
  assert.ok(app.url.endsWith(`&rev=rev-app-${LOCAL_REV}`), `application combo 的缓存键：${app.url}`)
  // 判据用**官方 id 全名**：本树自己的 id 里也带 `ui-layout` 字样（#97 起叫
  // @dsh-one/vscode-chat-ui-layout），按子串判会把自有插件误当成官方外框。
  assert.ok(
    CHAT_BLOCKED_IDS.every((id) => !app.url.includes(`${id}/client.js`)),
    'application combo 不得含 blocked id',
  )
})

test('filterWire：网关清单缺 blocklist 项时**不阻断**、只报告（官方插件合并/下线是正常演进）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  wire.entries = wire.entries.filter((e) => e.id !== '@deepseek-ai/dsh-client-ui-sidebar')
  wire.batches[1].entries = wire.batches[1].entries.filter((id) => id !== '@deepseek-ai/dsh-client-ui-sidebar')
  const warnings: string[] = []
  const filtered = filterWire(wire, undefined, undefined, undefined, LOCAL_REV, (line) => warnings.push(line))
  // 不抛错、正常出清单；缺失的那条只在 warn 里报告
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /ui-sidebar/)
  assert.equal(filtered.entries.some((e) => e.id === '@deepseek-ai/dsh-client-ui-sidebar'), false)
  // 其余 blocklist 项照常剥掉
  assert.equal(filtered.entries.some((e) => e.id === '@deepseek-ai/dsh-client-ui-layout'), false)
})

test('filterWire（sidebar 树）：外框+对话流+设置子页剥除，官方侧栏/工作区树保留（#70/#71）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(
    wire,
    [
      { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
      { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'fixture' },
    ],
    SIDEBAR_FRAME_PLUGIN_ID,
    undefined,
    LOCAL_REV,
  )
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
  // #164 的 boot 闭包：ui-commands 必须放行（官方 ui-model-selection 按服务名依赖它的
  // commandUi，挡着就是「一个条目没激活 → 整页 boot 失败」，干净 profile 上整棵树挂不上）；
  // ui-permission-presets 当初被挡的理由只有「依赖 commandUi」，一并放行；
  // ui-model-selection 本来就不在列（它只在对话区的座位渲染，侧栏树不声明那个座位）。
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-commands'), 'ui-commands 在侧栏树上必须放行（#164）')
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-permission-presets'), 'ui-permission-presets 在侧栏树上必须放行（#164）')
  assert.ok(!SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-model-selection'), 'ui-model-selection 不在侧栏树 block list 里')
  // sidebar frame 插件替换 shell 位。
  const shell = filtered.entries.filter((e) => e.id === SIDEBAR_FRAME_PLUGIN_ID)
  assert.equal(shell.length, 1)
  assert.match(
    shell[0].url,
    new RegExp(
      `^/plugins-local/\\?\\?${SIDEBAR_FRAME_PLUGIN_ID.replaceAll('/', '\\/')}/client\\.js&rev=rev-app-${LOCAL_REV}$`,
    ),
  )
  const app = filtered.batches[1]
  assert.deepEqual(app.entries, [
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-workspace',
    SIDEBAR_FRAME_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
  // 同上按官方 id 全名判：自有 id（@dsh-one/vscode-sidebar-ui-layout）里带 ui-sidebar。
  assert.ok(
    SIDEBAR_BLOCKED_IDS.every((id) => !app.url.includes(`${id}/client.js`)),
    'application combo 不得含 blocked id',
  )
  assert.ok(app.url.includes('@deepseek-ai/dsh-client-ui-sidebar/client.js'), 'sidebar 树 combo 必须含官方侧栏段')
})

test('filterWire（settings 树）：外框+官方侧栏+对话流剥除，frame 换 settings-shell（#70/#71）', () => {
  const wire = extractBootWire(FIXTURE_HTML)
  const filtered = filterWire(
    wire,
    [
      { id: '@deepseek-ai/dsh-client-ui-layout', reason: 'fixture' },
      { id: '@deepseek-ai/dsh-client-ui-sidebar', reason: 'fixture' },
      { id: '@deepseek-ai/dsh-client-ui-chat', reason: 'fixture' },
    ],
    SETTINGS_FRAME_PLUGIN_ID,
    undefined,
    LOCAL_REV,
  )
  const ids = filtered.entries.map((e) => e.id)
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'settings 树官方侧栏壳不进页')
  assert.ok(!ids.includes('@deepseek-ai/dsh-client-ui-chat'), 'settings 树对话流不进页')
  assert.ok(ids.includes(SETTINGS_FRAME_PLUGIN_ID))
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
    SETTINGS_FRAME_PLUGIN_ID,
    THEME_FOLLOW_PLUGIN_ID,
  ])
})

// ---------------------------------------------------------------------------
// #165：官方把 application 阶段切成好几批时的口径
// ---------------------------------------------------------------------------

/** 一个被 block 的官方插件（干净 profile 上实测就落在第二个 application 批）。 */
const DIR_PICKER = '@deepseek-ai/dsh-client-ui-directory-picker-native'
/** 只挡它一条的最小清单（口径测试不牵扯三棵树的真实清单）。 */
const BLOCK_DIR_PICKER = [{ id: DIR_PICKER, reason: 'fixture' }]

/**
 * 手搓 wire（口径测试用）：entries 与各批自洽，批数与分批位置可控——
 * FIXTURE_HTML 是单个 application 批的迷你网关，验不到「跨批」。
 */
function wireOf(shape: {
  entries: readonly string[]
  batches: ReadonlyArray<{ phase: 'bootstrap' | 'application'; entries: readonly string[] }>
}): BootWire {
  const combo = (ids: readonly string[], rev: string): string =>
    `/plugins/??${ids.map((id) => `${id}/client.js`).join(',')}&rev=${rev}`
  return {
    rev: 'rev-root',
    entries: shape.entries.map((id) => ({ id, url: combo([id], `rev-${id.slice(-4)}`), rev: `rev-${id.slice(-4)}` })),
    batches: shape.batches.map((batch, index) => ({
      phase: batch.phase,
      url: combo(batch.entries, `rev-batch-${String(index)}`),
      rev: `rev-batch-${String(index)}`,
      entries: [...batch.entries],
    })),
  }
}

test('filterWire：block 项落在第二个 application 批里也照常剥掉（#165）', () => {
  // 干净 profile 上实测的形状：一个 bootstrap 批 + 两个 application 批，
  // 最后一个插件（directory-picker-native）被 URL 长度上限挤进第二批。
  const wire = wireOf({
    entries: ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-chat', DIR_PICKER],
    batches: [
      { phase: 'bootstrap', entries: ['@deepseek-ai/dsh-client-modules'] },
      { phase: 'application', entries: ['@deepseek-ai/dsh-client-ui-chat'] },
      { phase: 'application', entries: [DIR_PICKER] },
    ],
  })
  const warnings: string[] = []
  const filtered = filterWire(wire, BLOCK_DIR_PICKER, CHAT_FRAME_PLUGIN_ID, [THEME_FOLLOW_PLUGIN_ID], LOCAL_REV, (line) =>
    warnings.push(line),
  )
  // 修复前这里抛 application batch blocklist entries inconsistent with wire entries
  assert.deepEqual(warnings, [])
  assert.equal(filtered.entries.some((e) => e.id === DIR_PICKER), false, 'entries 里应剥掉')
  // 官方两个 application 批合回一个：保留件都在，被 block 的那条不在（批与 combo URL 都没有）
  assert.equal(filtered.batches.length, 2)
  const app = filtered.batches[1]
  assert.equal(app.phase, 'application')
  assert.equal(app.rev, `rev-batch-1-${LOCAL_REV}`, '官方那半沿用第一个 application 批的 rev，本地那半拼在后面')
  assert.deepEqual(app.entries, ['@deepseek-ai/dsh-client-ui-chat', CHAT_FRAME_PLUGIN_ID, THEME_FOLLOW_PLUGIN_ID])
  assert.equal(app.url.includes('directory-picker-native'), false, 'combo URL 不得含被 block 的段')
})

test('filterWire：#165 的两条硬判据没放宽——够不着与自相矛盾各自抛错，文案点名情形', () => {
  // ① 在 wire 里、却不在任何 application 批（例如官方把它挪进了 bootstrap 批）：
  //    过滤管道（mirror 剥段）够不着，必须抛错而不能降级成 warn
  const inBootstrap = wireOf({
    entries: ['@deepseek-ai/dsh-client-modules', DIR_PICKER],
    batches: [
      { phase: 'bootstrap', entries: ['@deepseek-ai/dsh-client-modules', DIR_PICKER] },
      { phase: 'application', entries: ['@deepseek-ai/dsh-client-modules', DIR_PICKER] },
    ],
  })
  inBootstrap.batches[1].entries = ['@deepseek-ai/dsh-client-modules']
  assert.throws(
    () => filterWire(inBootstrap, BLOCK_DIR_PICKER, undefined, undefined, LOCAL_REV),
    /in no application batch, so the filter cannot strip them: @deepseek-ai\/dsh-client-ui-directory-picker-native/,
  )
  // ② 在批里、却不在 wire.entries：清单与批次自相矛盾（旧口径也抛，别放宽掉）
  const phantom = wireOf({
    entries: ['@deepseek-ai/dsh-client-modules'],
    batches: [
      { phase: 'bootstrap', entries: ['@deepseek-ai/dsh-client-modules'] },
      { phase: 'application', entries: ['@deepseek-ai/dsh-client-modules', DIR_PICKER] },
    ],
  })
  assert.throws(
    () => filterWire(phantom, BLOCK_DIR_PICKER, undefined, undefined, LOCAL_REV),
    /in an application batch but absent from the gateway wire entries: @deepseek-ai\/dsh-client-ui-directory-picker-native/,
  )
})

test('filterWire：网关清单已含同 id 的自有插件时不重复叠加本地那份（#165）', () => {
  // 用户把自有插件包装进 profile 之后（docs/plugin-packages.md），网关 wire 里就有
  // 同名条目；再叠一份本地 bundle 会让客户端抛 duplicate graph entry。
  const wire = wireOf({
    entries: ['@deepseek-ai/dsh-client-modules', GIT_CARD_PLUGIN_ID],
    batches: [
      { phase: 'bootstrap', entries: ['@deepseek-ai/dsh-client-modules'] },
      { phase: 'application', entries: ['@deepseek-ai/dsh-client-modules', GIT_CARD_PLUGIN_ID] },
    ],
  })
  const filtered = filterWire(wire, [], CHAT_FRAME_PLUGIN_ID, [GIT_CARD_PLUGIN_ID, THEME_FOLLOW_PLUGIN_ID], LOCAL_REV)
  const gitCards = filtered.entries.filter((e) => e.id === GIT_CARD_PLUGIN_ID)
  assert.equal(gitCards.length, 1, '同 id 只能有一条 entry')
  assert.match(gitCards[0].url, /^\/plugins\//, '网关已提供时用网关那份，不再指 /plugins-local')
  assert.equal(filtered.batches[1].entries.filter((id) => id === GIT_CARD_PLUGIN_ID).length, 1)
  // 网关没有的自有插件照旧叠加本地 bundle
  const themeFollow = filtered.entries.filter((e) => e.id === THEME_FOLLOW_PLUGIN_ID)
  assert.equal(themeFollow.length, 1)
  assert.match(themeFollow[0].url, /^\/plugins-local\//)
  assert.match(filtered.batches[1].url, /@dsh-one\/vscode-theme-follow\/client\.js/)
})

test('filterWire：本地一件都不进 URL 时 rev 只有官方那一半（用户把自有包装进了 profile，#173）', () => {
  // 自有插件的 id 全由网关整包提供时，这份 combo 的内容全是官方的：本地 dist 变不该
  // 让用户重下整个整包，所以缓存键里不拼本地那一半（localRev 原样传进去、不进 URL）。
  const wire = wireOf({
    entries: ['@deepseek-ai/dsh-client-modules', GIT_CARD_PLUGIN_ID],
    batches: [
      { phase: 'bootstrap', entries: ['@deepseek-ai/dsh-client-modules'] },
      { phase: 'application', entries: ['@deepseek-ai/dsh-client-modules', GIT_CARD_PLUGIN_ID] },
    ],
  })
  const filtered = filterWire(wire, [], GIT_CARD_PLUGIN_ID, [], LOCAL_REV)
  assert.equal(filtered.batches[1].rev, 'rev-batch-1', '没有本地件时 rev 只有官方那半（长缓存照旧）')
  assert.ok(filtered.batches[1].url.endsWith('&rev=rev-batch-1'), filtered.batches[1].url)
})
