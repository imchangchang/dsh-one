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
  // ui-model-selection 本来就不在列（它只在对话区的槽位渲染，侧栏树不声明那个槽位）。
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
// #180：block list 逐条复核（判据 = 这棵树有没有声明它注册的槽位）
// ---------------------------------------------------------------------------

/**
 * 对话流卡片组（#180 逐条复核的那一批）：它们注册的槽位全在对话区
 * （`conversation.*` / `tool.call.*`），声明方是官方 ui-conversation / ui-chat。
 */
const CONVERSATION_CARDS = [
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-jobs',
  '@deepseek-ai/dsh-client-ui-plan',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-session-log-export',
]

test('block list 逐条复核（#180）：sidebar 树不再背对话区卡片的 id（那棵树一个对话区槽位都没声明）', () => {
  // sidebar 树的 frame 只声明 `sidebar` + `shell.overlay`，官方 ui-conversation
  // （那些槽位的声明方）也在这棵树上被下线 ⇒ 整棵对话子树不存在 ⇒ 这几件注册时
  // `slots.inject` 的回调永不跑，整件停车、不渲染任何东西。挂着它们只是白背
  // 一个官方 id 依赖（官方改名就要靠 F-11 才知道）。
  const stillBlocked = SIDEBAR_BLOCKED_IDS.filter((id) => CONVERSATION_CARDS.includes(id))
  assert.deepEqual(stillBlocked, [], '这七件在 sidebar 树上一个槽位都没声明，不该继续下线')
  // 同一批在 settings 树里要留着：设置页声明了 keyed `main`，官方 ui-conversation 的
  // 整棵子树因此注册成立，那些槽位在那棵树里**是声明了的**（放回会真注册进对话子树）。
  const settingsBlocked = SETTINGS_BLOCKED_IDS.filter((id) => CONVERSATION_CARDS.includes(id))
  assert.deepEqual(settingsBlocked, [...CONVERSATION_CARDS], 'settings 树继续下线这七件')
})

test('block list 逐条复核（#180）：没有任何槽位贡献、或槽位只由同样被下线的件声明的两件已摘除', () => {
  // ui-reference：client.js 里一次 `slots.register` / `slots.inject` 都没有
  // （只注册 `@` 触发源与词典），「reference cards」那条理由本身是错的。
  // ui-skill：唯一注册的槽位 `tool.call.toolview` 由 ui-tool 声明，而 ui-tool 在
  // 三棵树里的两棵都被下线 ⇒ 那两棵树都没声明它 ⇒ 停车。
  for (const list of [CHAT_BLOCKED_IDS, SIDEBAR_BLOCKED_IDS, SETTINGS_BLOCKED_IDS]) {
    assert.ok(!list.includes('@deepseek-ai/dsh-client-ui-reference'), 'ui-reference 不该再出现在任何 block list 里')
    assert.ok(!list.includes('@deepseek-ai/dsh-client-ui-skill'), 'ui-skill 不该再出现在任何 block list 里')
  }
})

test('block list 逐条复核（#180）：槽位在 sidebar 树**真被声明**的件继续下线', () => {
  // directory-picker-native 注册的 `sidebar.workspaces.directoryFlow` 由官方
  // ui-workspace 的 WorkspaceBrowser 声明、而自有树还要读它的占用态 ⇒ 放回它就会往
  // 我们自己的侧栏树里注册官方原生目录选择器。
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-directory-picker-native'))
  // 这四件的 inject 里有官方 `uiConversation` 服务，而 sidebar 树下线了它的提供方
  // ui-conversation ⇒ 放回它们会停在「未激活」，boot 一个条目没激活就整页抛错（#164）。
  for (const id of [
    '@deepseek-ai/dsh-client-ui-workflow-run',
    '@deepseek-ai/dsh-client-ui-deliverables',
    '@deepseek-ai/dsh-client-ui-trajectory',
    '@deepseek-ai/dsh-client-ui-goal',
  ]) {
    assert.ok(SIDEBAR_BLOCKED_IDS.includes(id), `${id} 依赖 sidebar 树没有的 uiConversation，必须继续下线`)
    assert.ok(SETTINGS_BLOCKED_IDS.includes(id), `${id} 的槽位在 settings 树里被声明，继续下线`)
  }
  // settings-general：`sidebar.settings` 槽位由官方 ui-sidebar 在 sidebar 树里声明
  // （它没有声明的只有 sidebar 树之外的树）⇒ 这棵树继续下线它。
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-general'))
})

test('block list 逐条复核（#202）：chat 树不再下线 ui-settings-general（它注册的槽位那棵树一处都没声明）', () => {
  // 官方 ui-settings-general 的槽位贡献全挂在 `sidebar.settings` 这个槽位下（它的
  // `SettingsRoot`），而 `sidebar.settings` 只有官方**侧栏壳**声明——chat 树没有侧栏壳，
  // 所以放行它是整件停车、零渲染（#202 在实验室实测：放行前后元素集合 65 项逐项相同、
  // 设置槽位锚点两边都是零枚，combo 里却真的多了它）。挂着它只是白背一个官方 id 依赖。
  assert.ok(!CHAT_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  // 同一件在 sidebar 树继续下线（那里槽位声明得了，它的 SettingsRoot 会真注册进来）。
  assert.ok(SIDEBAR_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  // settings 树本来就不下线它（那正是设置页的内容）。
  assert.ok(!SETTINGS_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  // 设置子页组里另外两件（Plugins / plugin-inventory）在 chat 树也继续下线这条到此为止：
  // #204 把它们从 chat 树摘了（判据与本件同形，见下面的 #204 那一条）。
  assert.ok(!CHAT_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  assert.ok(!CHAT_BLOCKED_IDS.includes('@deepseek-ai/dsh-client-ui-settings-plugin-inventory'))
})

/**
 * 设置子页组里 #204 从 chat 树摘除的那两件：Plugins 设置节 + 它的插件清单页签。
 */
const SETTINGS_PAGE_PLUGINS = [
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
]

test('block list 逐条复核（#204）：chat 树也不再下线设置子页组的那两件（它们注册的槽位那棵树一处都没声明）', () => {
  // 判据与 ui-settings-general（#202）同形：这两件等待的槽位（`settings.section` /
  // `settings.plugins.tab` / `settings.plugin.item`）全在 `sidebar.settings` 之下，由官方
  // ui-settings-general 的 `SettingsRoot` 注册声明；chat 树没有官方侧栏壳，`sidebar.settings`
  // 一处都没声明（#204 在真树上读过本树的槽位声明表：46 个名字里 `sidebar` /
  // `sidebar.settings` / `settings.*` 一个都没有）⇒ 这几处贡献的回调永不跑、整件停车、
  // 零渲染，挂着它只是白背一个官方 id 依赖。
  //
  // 实验室实测（各一台自起的全新 `DSH_HOME` 隔离实例、只换 chat 树清单里这两个 id）：
  // 本页 combo 58 → 60 条（两件真的进来了）、12 枚槽位锚点逐枚同值（`settings.section` /
  // `settings.plugins.tab` / `settings.plugin.item` 三处两边都是 0）、整页截图 md5 相同、
  // 元素集合只多出它们自己注入的 5 张 `<style>`（那 5 张的 125 条规则命中页面上 0 个
  // 元素）、零崩溃 / 零未激活 / 零 pageerror。
  for (const id of SETTINGS_PAGE_PLUGINS) {
    assert.ok(!CHAT_BLOCKED_IDS.includes(id), `${id} 在 chat 树一处槽位都没声明，不该继续下线`)
    // sidebar 树那一份继续挂着：那棵树里它们同样停车（`settings.*` 的声明方
    // ui-settings-general 在那棵树上也被下线），处置沿用 #180 对同类「纯流量代价」项的口径。
    assert.ok(SIDEBAR_BLOCKED_IDS.includes(id), `${id} 在 sidebar 树继续下线`)
    // settings 树本来就不下线它们（Plugins 设置节正是那一页的内容之一）。
    assert.ok(!SETTINGS_BLOCKED_IDS.includes(id))
  }
  // 摘完之后 chat 树只剩两条形态理由：官方外框（与 VS Code 容器冲突，#77）与官方
  // 侧栏壳（本树没有侧栏位，由 sidebar 树承担）。
  assert.deepEqual(
    [...CHAT_BLOCKED_IDS],
    ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'],
    'chat 树 block list 只剩这两条',
  )
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
