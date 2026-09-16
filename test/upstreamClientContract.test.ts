/**
 * 客户端契约面探针（#79，`scripts/dsh-upstream-watch/clientContract.mjs`）的单测。
 *
 * 三类断言的对象都是**合成 combo**（按官方 `window.__ModuleLoader__.load({…})`
 * 段结构拼出来的最小文本），所以这里是纯函数级的测试，不碰网络也不碰真网关——
 * 真网关那一路由每日 upstream-watch 的 probe.mjs 跑。
 *
 * 覆盖三件事：
 * 1. 提取函数按官方产物形状取名字（契约目录、`provideRoot` 的 hooks/keyedHooks、
 *    段内归属）；取法失效时 meta 检查会先响，而不是让三类断言各报一堆假失败；
 * 2. 依赖清单与 `src/` 里的真实取用点绑死（**从代码 grep 得出**这条要求的可执行
 *    形式：清单里的名字一旦在源码里消失，测试先红，提示把该行删掉）；
 * 3. 断言失败时指得出是哪一条、当前版本、期望的官方出处——即「故意破坏一条断言」
 *    的自动化版本（抽掉一个 slot / 一个 hook / 一个字段名 / 一个 props 名 /
 *    把字段名挪到别的插件段）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const MODULE_PATH = path.join(ROOT, 'scripts', 'dsh-upstream-watch', 'clientContract.mjs')

interface CheckRow {
  id: string
  name: string
  status: 'pass' | 'fail'
  detail: string
}

interface SlotDep {
  names: string[]
  why: string
  where: string
  expect: string
}

interface HookDep {
  name: string
  prop: string
  why: string
  where: string
  expect: string
}

interface IdentifierDep {
  names: string[]
  scope?: string[]
  why: string
  where: string
}

interface ClientContractModule {
  SLOT_DEPENDENCIES: SlotDep[]
  ROOT_HOOK_DEPENDENCIES: HookDep[]
  IDENTIFIER_DEPENDENCIES: IdentifierDep[]
  splitComboSegments(text: string): { id: string | null; start: number; end: number }[]
  extractSlotCatalog(text: string): Map<string, { kind: string; scope: string; source: string | null }>
  extractSlotMentions(text: string, segments: unknown): Map<string, { count: number; kinds: Set<string>; plugins: Set<string> }>
  extractRootHooks(text: string, segments: unknown): { hook: string; channel: string; plugin: string | null }[]
  observeCombo(opts: { comboText: string }): { segments: number; catalogSlots: string[]; rootHooks: string[] }
  checkClientContract(opts: { comboText: string | null; version?: string; unavailableReason?: string }): CheckRow[]
}

const contract = (await import(MODULE_PATH)) as ClientContractModule

// ---------------------------------------------------------------------------
// 合成 combo
// ---------------------------------------------------------------------------

/** 段数/目录条数的下限（对应 clientContract.mjs 的 MIN_SEGMENTS / MIN_CATALOG_ENTRIES）。 */
const FILLER_PLUGINS = Array.from({ length: 45 }, (_, i) => `@deepseek-ai/dsh-client-filler-${i}`)
const FILLER_SLOTS = Array.from({ length: 30 }, (_, i) => `filler.slot.${i}`)

const segment = (id: string, lines: string[]): string =>
  `window.__ModuleLoader__.load({\n  id: "${id}",\n  factory: (require) => {\n${lines.map((l) => `    ${l}`).join('\n')}\n  }\n});\n`

const catalogEntry = (name: string, source: string): string =>
  `{ key: "${name}", kind: "list", scope: "root", summary: "s", doc: "d", source: "${source}" },`

interface BreakOptions {
  /** 抽掉这个 slot 名（它的段里不再出现）。 */
  dropSlot?: string
  /** 抽掉这个 root hook 的下发。 */
  dropHook?: string
  /** 抽掉这个 hook 对应的槽位 props 名。 */
  dropProp?: string
  /** 抽掉这个字段/方法名。 */
  dropIdentifier?: string
  /** 把这个字段名挪到别的插件段（考作用域限定）。 */
  misplaceIdentifier?: string
}

/** 拼一份「该有的名字都在」的 combo；按 BreakOptions 故意破坏其中的一条。 */
function buildCombo(o: BreakOptions = {}): string {
  const parts = new Map<string, string[]>()
  const push = (plugin: string, line: string): void => {
    parts.set(plugin, [...(parts.get(plugin) ?? []), line])
  }

  for (const [i, plugin] of FILLER_PLUGINS.entries()) {
    push(plugin, catalogEntry(FILLER_SLOTS[i % FILLER_SLOTS.length], `packages/client/filler-${i}/src/client/contract/slots.ts:1`))
  }
  for (const dep of contract.SLOT_DEPENDENCIES) {
    const name = dep.names[0]
    if (name === o.dropSlot) continue
    push(FILLER_PLUGINS[0], catalogEntry(name, dep.expect))
    push(FILLER_PLUGINS[0], `ctx.slots.inject("${name}", () => ({ props: {} }));`)
  }
  for (const dep of contract.ROOT_HOOK_DEPENDENCIES) {
    if (dep.name !== o.dropHook) {
      push(FILLER_PLUGINS[1], `ctx.slots.provideRoot({ hooks: { ${dep.name}: { getSnapshot: () => snap, subscribe: () => () => {} } } });`)
    }
    if (dep.prop !== o.dropProp) push(FILLER_PLUGINS[1], `const ${dep.prop} = props.${dep.prop};`)
  }
  for (const dep of contract.IDENTIFIER_DEPENDENCIES) {
    const name = dep.names[0]
    if (name === o.dropIdentifier) continue
    const plugin = name === o.misplaceIdentifier ? FILLER_PLUGINS[2] : (dep.scope?.[0] ?? FILLER_PLUGINS[3])
    push(plugin, `const hit = material.${name};`)
  }
  return [...parts.entries()].map(([id, lines]) => segment(id, lines)).join('')
}

const rowOf = (rows: CheckRow[], id: string): CheckRow => {
  const row = rows.find((r) => r.id === id)
  assert.ok(row !== undefined, `结果里必须有 ${id} 这一行`)
  return row
}

// ---------------------------------------------------------------------------
// 1. 提取
// ---------------------------------------------------------------------------

test('插件段边界按 window.__ModuleLoader__.load({ 切，段 id 从段首读出', () => {
  const combo = buildCombo()
  const segments = contract.splitComboSegments(combo)
  assert.equal(segments.length, new Set(segments.map((s) => s.id)).size, '每段都读出了 id')
  assert.ok(segments.every((s) => s.id !== null), '所有段 id 可读')
  assert.ok(segments.length >= 45, `段数应覆盖合成插件（实际 ${segments.length}）`)
  assert.ok(segments.every((s) => s.start < s.end), '段的区间必须递增有效')
})

test('slot 契约目录按 key/kind/scope/source 取，官方源码路径带出来', () => {
  const catalog = contract.extractSlotCatalog(buildCombo())
  const entry = catalog.get('sidebar.workspaces')
  assert.ok(entry !== undefined, '契约目录里应有 sidebar.workspaces')
  assert.equal(entry.scope, 'root')
  assert.ok((entry.source ?? '').includes('ui-sidebar'), `source 应指向官方源码路径（实际 ${entry.source}）`)
})

test('provideRoot 只取 hooks/keyedHooks 的顶层键，嵌套键不误取', () => {
  const combo = segment('@deepseek-ai/dsh-client-ui-layout', [
    'ctx.slots.provideRoot({ hooks: { panelInfo: { getSnapshot: () => snap, subscribe: listen } }, keyedHooks: { resource: (key) => src } });',
  ])
  const hooks = contract.extractRootHooks(combo, contract.splitComboSegments(combo))
  assert.deepEqual(
    hooks.map((h) => `${h.channel}:${h.hook}`).sort(),
    ['hooks:panelInfo', 'keyedHooks:resource'],
  )
  assert.equal(hooks[0].plugin, '@deepseek-ai/dsh-client-ui-layout', '要带出下发这个 hook 的插件包名')
})

test('slot 在场证据按用途归类（含注入点与所属插件），观测口给出整段契约概貌', () => {
  const combo = buildCombo()
  const segments = contract.splitComboSegments(combo)
  const mentions = contract.extractSlotMentions(combo, segments)
  const hit = mentions.get('sidebar.workspaces')
  assert.ok(hit !== undefined && hit.count >= 1, '注入点要能查到')
  assert.ok(hit.kinds.has('inject'), `要记下凭哪种调用点查到（实际 ${[...hit.kinds].join(',')}）`)
  assert.ok(hit.plugins.has(FILLER_PLUGINS[0]), '要记下出现在哪个插件段')

  const obs = contract.observeCombo({ comboText: combo })
  assert.ok(obs.segments >= 45, `观测口要给出段数（实际 ${obs.segments}）`)
  assert.ok(obs.catalogSlots.includes('sidebar.workspaces'), '观测口要给出契约目录里的 slot 名')
  assert.ok(obs.rootHooks.some((h) => h.startsWith('hooks:panelInfo@')), `观测口要给出 root hook 与下发插件（实际 ${obs.rootHooks.join(', ')}）`)
})

// ---------------------------------------------------------------------------
// 2. 依赖清单与源码绑死
// ---------------------------------------------------------------------------

test('依赖清单的每个名字都能在 src 里找到取用点（清单从代码 grep 得出，不凭记忆）', () => {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  walk(SRC)
  const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

  const rows: { label: string; names: string[]; where: string }[] = [
    ...contract.SLOT_DEPENDENCIES.map((d) => ({ label: d.names.join('|'), names: d.names, where: d.where })),
    ...contract.ROOT_HOOK_DEPENDENCIES.map((d) => ({ label: d.name, names: [d.name, d.prop], where: d.where })),
    ...contract.IDENTIFIER_DEPENDENCIES.map((d) => ({ label: d.names.join('|'), names: d.names, where: d.where })),
  ]
  for (const row of rows) {
    const hit = row.names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
    assert.ok(hit, `${row.label} 在 src/ 里已无取用点——不再依赖就从 clientContract.mjs 的清单里删掉该行`)
    const paths = row.where.match(/src\/[\w./-]+\.ts/g) ?? []
    assert.ok(paths.length > 0, `${row.label} 的 where 字段必须写出我方使用点（src/...）`)
    for (const p of paths) {
      assert.ok(fs.existsSync(path.join(ROOT, p)), `${row.label} 的 where 指向不存在的文件：${p}`)
    }
  }
})

// ---------------------------------------------------------------------------
// 3. 断言与失败定位
// ---------------------------------------------------------------------------

test('该有的名字都在时，四类断言全绿', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo(), version: '0.1.6-alpha.1' })
  assert.deepEqual(rows.map((r) => r.id), ['client-combo-index', 'client-slots', 'client-root-hooks', 'client-identifiers'])
  assert.deepEqual(rows.filter((r) => r.status === 'fail'), [], rows.map((r) => `${r.id}: ${r.detail}`).join('\n'))
})

test('抽掉一个 slot：client-slots fail 并指出缺失项、期望出处与当前版本', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo({ dropSlot: 'sidebar.workspaces' }), version: '0.1.7-alpha.1' })
  const row = rowOf(rows, 'client-slots')
  assert.equal(row.status, 'fail')
  assert.ok(row.detail.includes('sidebar.workspaces'), row.detail)
  assert.ok(row.detail.includes('packages/client/ui-sidebar'), `失败信息要带官方包路径：${row.detail}`)
  assert.ok(row.detail.includes('0.1.7-alpha.1'), `失败信息要带当前版本：${row.detail}`)
  assert.equal(rowOf(rows, 'client-root-hooks').status, 'pass', '别的类别不受牵连')
  assert.equal(rowOf(rows, 'client-identifiers').status, 'pass', '别的类别不受牵连')
})

test('抽掉一个 root hook（#76 那一类）：client-root-hooks fail 并指名 provideRoot 未下发', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo({ dropHook: 'panelInfo' }), version: '0.1.6-alpha.1' })
  const row = rowOf(rows, 'client-root-hooks')
  assert.equal(row.status, 'fail')
  assert.ok(row.detail.includes('panelInfo'), row.detail)
  assert.ok(row.detail.includes('provideRoot 未下发'), row.detail)
  assert.ok(row.detail.includes('frameShared.ts'), `失败信息要带我方使用点：${row.detail}`)
})

test('hook 还在但槽位 props 名变了：同样 fail 并指名 props', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo({ dropProp: 'useWorkspaces' }), version: '0.1.6-alpha.1' })
  const row = rowOf(rows, 'client-root-hooks')
  assert.equal(row.status, 'fail')
  assert.ok(row.detail.includes('workspaces') && row.detail.includes('useWorkspaces'), row.detail)
})

test('抽掉一个字段名（#78 那一类）：client-identifiers fail 并指出作用域与我方使用点', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo({ dropIdentifier: 'attachmentIds' }), version: '0.1.6-alpha.1' })
  const row = rowOf(rows, 'client-identifiers')
  assert.equal(row.status, 'fail')
  assert.ok(row.detail.includes('attachmentIds|imageIds'), row.detail)
  assert.ok(row.detail.includes('@deepseek-ai/dsh-client-ui-conversation'), `失败信息要带作用域：${row.detail}`)
  assert.ok(row.detail.includes('composerClearPlugin.ts'), `失败信息要带我方使用点：${row.detail}`)
})

test('字段名在别的插件段里出现不算数（作用域限定生效）', () => {
  const rows = contract.checkClientContract({ comboText: buildCombo({ misplaceIdentifier: 'attachmentIds' }), version: '0.1.6-alpha.1' })
  const row = rowOf(rows, 'client-identifiers')
  assert.equal(row.status, 'fail', row.detail)
  assert.ok(row.detail.includes('attachmentIds|imageIds'), row.detail)
})

test('combo 取不到：四行全 fail 并写明原因（不让这一面显示成没问题）', () => {
  const rows = contract.checkClientContract({ comboText: null, version: '0.1.6-alpha.1', unavailableReason: 'GET /: HTTP 500' })
  assert.equal(rows.length, 4)
  for (const row of rows) {
    assert.equal(row.status, 'fail')
    assert.ok(row.detail.includes('GET /: HTTP 500'), row.detail)
  }
})

test('combo 结构变了（段数/契约目录骤减）时先响 meta 行，而不是三类断言各报一堆假失败', () => {
  const combo = segment('@deepseek-ai/dsh-client-ui-layout', ['const nothing = 1;'])
  const rows = contract.checkClientContract({ comboText: combo, version: '0.2.0' })
  const row = rowOf(rows, 'client-combo-index')
  assert.equal(row.status, 'fail')
  assert.ok(row.detail.includes('契约目录 0 条') || row.detail.includes('段 1'), row.detail)
  assert.ok(row.detail.includes('clientContract.mjs'), `要指到取法所在文件：${row.detail}`)
})
