/**
 * block list 补全探针（#227，`scripts/dsh-upstream-watch/blockListDrift.mjs`）的单测。
 *
 * 这里不读本机 profile（CI 上没有官方包），用的是**按官方 0.1.6-alpha.2 实测形状合成的
 * 官方产物**：每个包一个 `package.json` + 一个 `lib/client.js`，只留被查的那几行
 * （服务依赖表的 `inject` 导出、提供服务的调用点）。测四件事：
 *
 * 1. 取数：`needs` / `provides` 的取法（含「找不到 inject 导出」要能报出来）；
 * 2. 目录读取：官方包目录里每条常常是指向安装树的**符号链接**，按 `isDirectory` 过滤会一条
 *    都读不到、又会静默算成「闭包是空的、三棵树一致」——合成产物里放一条符号链接钉住它；
 * 3. 正向：清单覆盖补全结果 → pass；
 * 4. 负向（#227 验收要的那条）：**把 `ui-plan` 从侧栏清单里删掉 → 必须红**，且 detail
 *    点得出它、它等的服务名与「提供方全被挡」的那个提供方；另加「多挡不红」（形态类
 *    条目本来就算不出来）与两处「取不到就红」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { scratchDirSync } from './scratchDirs.ts'

const ROOT = path.join(import.meta.dirname, '..')

interface ServiceFace {
  id: string
  needs: string[]
  provides: string[]
}

interface CheckRow {
  id: string
  name: string
  status: 'pass' | 'fail'
  detail: string
}

interface DriftModule {
  FRAME_PLUGIN_PROVIDES: string[]
  parseServiceFace(source: string, id: string): ServiceFace | null
  collectOfficialServiceFaces(root: string): { faces: ServiceFace[]; problems: string[] }
  checkBlockListDrift(opts: {
    root: string
    version?: string
    profile?: string
    trees: { key: string; label: string; blocked: string[]; framePluginId: string }[]
  }): CheckRow
}

const mod = (await import(path.join(ROOT, 'scripts', 'dsh-upstream-watch', 'blockListDrift.mjs'))) as DriftModule

const CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation'
const PLAN = '@deepseek-ai/dsh-client-ui-plan'
const CHAT = '@deepseek-ai/dsh-client-ui-chat'
const SIDEBAR = '@deepseek-ai/dsh-client-ui-sidebar'
const LAYOUT = '@deepseek-ai/dsh-client-ui-layout'
const FRAME = '@dsh-one/vscode-sidebar-ui-layout'

/** 包目录名（`@deepseek-ai/dsh-client-ui-plan` → `dsh-client-ui-plan`）：官方包目录下按短名建目录。 */
const short = (id: string): string => id.replace(/^@deepseek-ai\//, '')

/** 一件官方前端插件的合成产物：清单（含 `dsh.client`）+ 一个 bundle。 */
function pkg(files: Record<string, string>, id: string, needs: string[], provides: string[]): Record<string, string> {
  const dir = short(id)
  const provideCalls = provides.map((s, i) => `const dispose${i} = ctx.reflect.provide("${s}", impl);`).join('\n')
  const serviceClasses = provides
    .map((s) => `class Svc${s.replace(/\W/g, '_')} extends Service { constructor(ctx) { super(ctx, "${s}"); } }`)
    .join('\n')
  files[`${dir}/package.json`] = JSON.stringify({
    name: id,
    version: '0.1.6-alpha.2',
    dsh: { client: { inject: needs.filter((n) => n.startsWith('@')), platform: 'web' } },
  })
  files[`${dir}/lib/client.js`] = `
    const inject = [ ${needs.filter((n) => !n.startsWith('@')).map((n) => `"${n}"`).join(', ')} ];
    ${serviceClasses}
    ${provideCalls}
    ctx.slots.provideRoot({ hooks: {} });
    export { apply, inject };
  `
  return files
}

/**
 * 合成官方产物：只留本探针要读的东西，形状照 0.1.6-alpha.2 实测。
 * 改这里等于改「我们以为官方长什么样」。
 */
function syntheticFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  // 提供方那几件：服务表里有 provider，探针的「找不到提供方」自检才不会响。
  pkg(files, LAYOUT, ['slots', 'locale'], ['layout'])
  pkg(files, '@deepseek-ai/dsh-client-ui-renderer', [], ['slots'])
  pkg(files, '@deepseek-ai/dsh-client-locale', [], ['locale'])
  pkg(files, '@deepseek-ai/dsh-api-session-controller', ['loader', 'remote.session'], ['sessions', 'remote'])
  pkg(files, '@deepseek-ai/dsh-api-gateway', [], ['remote'])
  // 事故里的三件：conversation 提供 uiConversation，plan / chat 等它。
  pkg(files, CONVERSATION, [`@deepseek-ai/dsh-client-ui-layout`, 'slots', 'sessions', 'conversation'], [
    'conversation',
    'uiConversation',
  ])
  pkg(files, PLAN, [`@deepseek-ai/dsh-client-ui-conversation`, '@deepseek-ai/dsh-client-ui-chat', 'slots', 'remote', 'sessions', 'uiConversation'], [])
  pkg(files, CHAT, [`@deepseek-ai/dsh-client-ui-conversation`, 'slots', 'sessions', 'uiConversation'], [])
  pkg(files, SIDEBAR, [`@deepseek-ai/dsh-client-ui-conversation`, 'slots', 'layout', 'locale'], [])
  // 不是前端插件（没有 dsh.client）：目录里有它，但不该进服务面。
  files['dsh-agent/package.json'] = JSON.stringify({ name: '@deepseek-ai/dsh-agent', version: '0.1.6-alpha.2' })
  files['dsh-agent/lib/index.js'] = 'export const apply = () => {}'
  // 目录里不是包的那一条（连清单都没有）：静默跳过，不算「取不到」。
  files['not-a-package/README.md'] = '# 不是包\n'
  // `exports["./client"]` 的两种写法：客户端半不在惯例路径 `lib/client.js` 时也要读得到。
  files['dsh-client-ui-alias-string/package.json'] = JSON.stringify({
    name: '@deepseek-ai/dsh-client-ui-alias-string',
    version: '0.1.6-alpha.2',
    exports: { './client': './lib/alt.js' },
    dsh: { client: { inject: ['slots'], platform: 'web' } },
  })
  files['dsh-client-ui-alias-string/lib/alt.js'] = 'const inject = [ "slots" ];\nexport { apply, inject };'
  files['dsh-client-ui-alias-object/package.json'] = JSON.stringify({
    name: '@deepseek-ai/dsh-client-ui-alias-object',
    version: '0.1.6-alpha.2',
    exports: { './client': { types: './lib/types/client.d.ts', default: './lib/alt.js' } },
    dsh: { client: { inject: ['slots'], platform: 'web' } },
  })
  files['dsh-client-ui-alias-object/lib/alt.js'] = 'const inject = [ "slots" ];\nexport { apply, inject };'
  return files
}

/** 把合成产物铺进一个 scratch 目录（含一条符号链接，模拟本机 profile 的形状）。 */
function writeFixture(): { root: string; packagesDir: string } {
  const dir = scratchDirSync('dsh-blocklist-')
  const packagesDir = path.join(dir, 'profiles', 'node_modules', '@deepseek-ai')
  for (const [rel, content] of Object.entries(syntheticFiles())) {
    const target = path.join(packagesDir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  // 官方包目录里每条常常是指向安装树的符号链接（真实机器上 `~/.dsh/profiles/node_modules/
  // @deepseek-ai/*` 就是这样）。这里给侧栏那件另加一条真链接指向安装树，钉住取法。
  const installDir = path.join(dir, 'install', short(SIDEBAR))
  for (const rel of ['package.json', 'lib/client.js']) {
    fs.mkdirSync(path.dirname(path.join(installDir, rel)), { recursive: true })
    fs.copyFileSync(path.join(packagesDir, short(SIDEBAR), rel), path.join(installDir, rel))
  }
  fs.symlinkSync(installDir, path.join(packagesDir, `${short(SIDEBAR)}-linked`))
  return { root: packagesDir, packagesDir }
}

const TREES = (blocked: string[]): { key: string; label: string; blocked: string[]; framePluginId: string }[] => [
  { key: 'sidebar', label: '侧栏位', blocked, framePluginId: FRAME },
]

const CHECK = (root: string, blocked: string[]): CheckRow =>
  mod.checkBlockListDrift({ root, version: '0.1.6-alpha.2', profile: '合成产物', trees: TREES(blocked) })

test('取数：needs 取 bundle 导出的 inject 服务表，provides 取提供服务那几处调用点', () => {
  const files = syntheticFiles()
  const face = mod.parseServiceFace(files[`${short(PLAN)}/lib/client.js`], PLAN)
  assert.deepEqual(face?.needs, ['slots', 'remote', 'sessions', 'uiConversation'])
  assert.deepEqual(face?.provides, [])

  // 两种提供写法都认：`super(ctx, "X")`（cordis Service 的基类构造）与
  // `ctx.reflect.provide("X", …)`（官方 ui-layout 提供 layout 用的那一处）。
  const conversation = mod.parseServiceFace(files[`${short(CONVERSATION)}/lib/client.js`], CONVERSATION)
  assert.deepEqual(conversation?.provides, ['conversation', 'uiConversation'])

  // `provideRoot(` 是别的 API（官方 ui-layout 用它下发 root 级 hook），不该算成提供服务。
  const sidebar = mod.parseServiceFace(files[`${short(SIDEBAR)}/lib/client.js`], SIDEBAR)
  assert.deepEqual(sidebar?.provides, [])

  // 另一种导出形状（CommonJS 包装里的 exports.inject）也认。
  assert.deepEqual(mod.parseServiceFace('exports.inject = [ "slots", "locale" ];', 'x')?.needs, ['slots', 'locale'])
  // 取不到 inject 导出 → null（调用方据此报红，不许当成「它什么都不需要」）。
  assert.equal(mod.parseServiceFace('export const apply = () => {}', 'x'), null)
})

test('取数：逐条试读包目录，符号链接那条也读得到；不是包的条目静默跳过', () => {
  const { root } = writeFixture()
  const { faces, problems } = mod.collectOfficialServiceFaces(root)
  assert.deepEqual(problems, [])
  const ids = faces.map((f) => f.id)
  // 真目录一条 + 符号链接一条（两者同名，符号链接那条是从 install 树链过来的）。
  assert.equal(ids.filter((id) => id === SIDEBAR).length, 2, `符号链接那条要读到：${ids.join(',')}`)
  assert.equal(ids.some((id) => id.includes('dsh-agent')), false, '没有 dsh.client 的包不该进服务面')
  // 连清单都没有的那条（`not-a-package/`）走「读 package.json 失败就跳过」那一支：
  // 既不算问题、也不进服务面（它本来就不是包，报红只会变成假红）。
  assert.equal(ids.some((id) => id.includes('not-a-package')), false)
  assert.equal(faces.length, 12)
})

test('取数：client 半按 exports["./client"] 找，字符串与 { default } 两种写法都认', () => {
  const { root } = writeFixture()
  const { faces, problems } = mod.collectOfficialServiceFaces(root)
  assert.deepEqual(problems, [])
  // 两件的 bundle 都不在 `lib/client.js`（那里什么都没有），读到了就说明路径是照 exports 取的。
  for (const name of ['alias-string', 'alias-object']) {
    const face = faces.find((f) => f.id === `@deepseek-ai/dsh-client-ui-${name}`)
    assert.deepEqual(face?.needs, ['slots'], `${name} 这一件的 bundle 要按 exports 指定的路径读到`)
  }
})

test('取数：包里读不到 bundle / 解析不出 inject 导出时进 problems（取不到就报红）', () => {
  const { packagesDir } = writeFixture()
  fs.writeFileSync(path.join(packagesDir, short(CHAT), 'lib/client.js'), 'export const apply = () => {}')
  const { problems } = mod.collectOfficialServiceFaces(packagesDir)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /dsh-client-ui-chat.*找不到导出的 inject 服务表/)
})

test('正向：侧栏清单覆盖补全结果 → pass，detail 给出逐棵树读数', () => {
  const { root } = writeFixture()
  const row = CHECK(root, [CONVERSATION, PLAN, CHAT])
  assert.equal(row.status, 'pass', row.detail)
  assert.equal(row.id, 'block-list-drift')
  assert.match(row.detail, /侧栏位 手写 3 \/ 补全后 3（少挡 0、规则算不出 [01]）/)
  assert.match(row.detail, /dsh 0\.1\.6-alpha\.2/)
})

/**
 * #227 验收要的那条负向对照：把 `ui-plan` 从侧栏清单里删掉（= #225 事故前的样子）——
 * 探针必须红，并点出「它等 uiConversation、那个服务的提供方 ui-conversation 也被挡了」。
 */
test('负向对照：把 ui-plan 从侧栏清单里删掉 → 必须红，且说得出为什么', () => {
  const { root } = writeFixture()
  const row = CHECK(root, [CONVERSATION, CHAT])
  assert.equal(row.status, 'fail')
  assert.match(row.detail, /侧栏位 少挡了 1 条/)
  assert.match(row.detail, new RegExp(`${PLAN}（等 uiConversation`))
  assert.match(row.detail, new RegExp(`提供方全被挡：${CONVERSATION}`))
  // 同一份产物下把那一行加回去 → 立刻回到 pass（证明红的就是这一条）。
  assert.equal(CHECK(root, [CONVERSATION, CHAT, PLAN]).status, 'pass')
})

test('多挡不算失败：规则算不出来的手写条目只报读数', () => {
  const { root } = writeFixture()
  const row = CHECK(root, [CONVERSATION, PLAN, CHAT, SIDEBAR, LAYOUT])
  assert.equal(row.status, 'pass', row.detail)
  assert.match(row.detail, /侧栏位 手写 5 \/ 补全后 5（少挡 0、规则算不出 3）/)
  assert.match(row.detail, new RegExp(`规则算不出的手写条目 3 条（形态/角色理由，多挡无害）：${CONVERSATION}、${SIDEBAR}、${LAYOUT}`))
})

test('取不到就红：官方包一个都没读到、或有服务找不到提供方（框架那族除外）', () => {
  const { root } = writeFixture()
  // ① 一个包都没读到：不许静默算成「闭包是空的、三棵树一致」。
  const empty = path.join(path.dirname(root), 'nope')
  fs.mkdirSync(empty, { recursive: true })
  const emptyRow = CHECK(empty, [])
  assert.equal(emptyRow.status, 'fail')
  assert.match(emptyRow.detail, /一个官方前端包都没读到/)

  // ② 有插件在等的服务在官方包里找不到任何提供方（= 官方换了挂服务的写法、取法要跟着改）：
  //    把某个包的 inject 表里加一个没人提供的服务名，其余一字不动。
  const planSource = fs.readFileSync(path.join(root, short(PLAN), 'lib/client.js'), 'utf8')
  fs.writeFileSync(
    path.join(root, short(PLAN), 'lib/client.js'),
    planSource.replace('"sessions",', '"sessions", "brandNewService",'),
  )
  const row = CHECK(root, [CONVERSATION, PLAN, CHAT])
  assert.equal(row.status, 'fail')
  assert.match(row.detail, /找不到提供方：brandNewService/)
})

test('取不到就红：读不到包目录 / 某件的 bundle 文件不在', () => {
  const { root } = writeFixture()
  // ① `readdirSync` 抛（目录不存在也是这一支）：探针手里连服务面都没有，报红。
  const missing = mod.collectOfficialServiceFaces(path.join(path.dirname(root), 'not-here'))
  assert.equal(missing.faces.length, 0)
  assert.equal(missing.problems.length, 1)
  assert.match(missing.problems[0], /读不到官方包目录/)
  const missingRow = CHECK(path.join(path.dirname(root), 'not-here'), [])
  assert.equal(missingRow.status, 'fail')
  assert.match(missingRow.detail, /读不到官方包目录/)

  // ② 清单在、bundle 文件不在（读文件抛）：这一件算「取不到」，报出件名与文件名。
  fs.rmSync(path.join(root, short(CHAT), 'lib/client.js'))
  const gone = mod.collectOfficialServiceFaces(root)
  assert.equal(gone.problems.length, 1)
  assert.match(gone.problems[0], /dsh-client-ui-chat.*读不到 lib\/client\.js/)
  const goneRow = CHECK(root, [CONVERSATION, PLAN, CHAT])
  assert.equal(goneRow.status, 'fail')
  assert.match(goneRow.detail, /读不到 lib\/client\.js/)
})

test('自有 frame 插件在每棵树里都提供 layout（FRAME_PLUGIN_PROVIDES 的出处）', () => {
  assert.deepEqual(mod.FRAME_PLUGIN_PROVIDES, ['layout'])
  for (const file of ['chatLayoutPlugin.ts', 'sidebarLayoutPlugin.ts', 'settingsLayoutPlugin.ts']) {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'assembly', 'shell', file), 'utf8')
    assert.match(source, /reflect\.provide\(\s*'layout'/, `${file} 里要还有 reflect.provide('layout', …)`)
  }
})
