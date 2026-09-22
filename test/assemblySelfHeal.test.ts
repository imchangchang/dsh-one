/**
 * 装配页启动自愈的**确定性**判据（#228）：浏览器实验室里那套 F-67 验的是「在真页面上
 * 真的救回来了」，这里把同一段内联脚本放进一个最小沙箱里逐条走它的分支——那些分支在
 * 真页面上要么造不出来、要么造出来代价太大：
 *
 * - **存储不可用**（隐私模式那类）必须**不重载**：写不下「已经试过一次」的记录就没有
 *   「只用一次」的保证，宁可落到失败提示条也不许循环；
 * - **摘不干净的条目**（不在本页清单里 / 落在 bootstrap 批 / 是它所在批的唯一成员）必须
 *   不浪费那一次重载——官方 `parseBootManifest` 会拒绝空批与「不属于任何批的条目」；
 * - **本页清单三处一起摘**（entries / 批 entries / 批的 combo URL），其中 URL 那一段在
 *   实验室的现场里没法真的走到（合成 id 不进 URL，进了镜像就整包 404）；
 * - **只认审计文本里的 id**：文本不是那个形状时一个字节都不动。
 *
 * 跑法：把 `selfHealJs()` 的产物丢进 `node:vm` 的上下文里（页面里它是内联 `<script>`，
 * 全局就是它的作用域），外面给 `sessionStorage` / `console` / `document` / `location`
 * 一套替身，然后看它写了什么、调没调 reload。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as vm from 'node:vm'
import { SELF_HEAL_MARK, SELF_HEAL_STORAGE_KEY, selfHealJs } from '../src/ui/assembly/selfHeal.ts'
import { PAGE_FAILURE_API } from '../src/ui/assembly/failureNotice.ts'

/** 审计原文的形状（与 `verify:lab` 的 F-01 同一条口径：`web boot: N entry … did not activate`）。 */
const audit = (lines: string[]): string => `web boot: ${String(lines.length)} entr${lines.length === 1 ? 'y' : 'ies'} did not activate\n${lines.join('\n')}`

const PENDING = '@deepseek-ai/dsh-client-ui-plan: pending (waiting for service: uiConversation)'
const IMPORT_FAILED = '@deepseek-ai/dsh-client-lab-drift: import failed (see console for the import error)'

/** 一份最小的本页清单：bootstrap 批（loader 自己）+ application 批（两条官方 + 本树插件）。 */
const bootWire = (): Record<string, unknown> => ({
  rev: 'rev-1',
  entries: [
    { id: '@deepseek-ai/dsh-client-modules', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=b', rev: 'b' },
    { id: '@deepseek-ai/dsh-client-ui-plan', url: '/plugins-local/??@deepseek-ai/dsh-client-ui-plan/client.js&rev=c', rev: 'c' },
    { id: '@deepseek-ai/dsh-client-lab-drift', url: '/plugins-local/??@deepseek-ai/dsh-client-lab-drift/client.js&rev=c', rev: 'c' },
    { id: '@dsh-one/vscode-sidebar-ui-layout', url: '/plugins-local/??@dsh-one/vscode-sidebar-ui-layout/client.js&rev=c', rev: 'c' },
  ],
  batches: [
    { phase: 'bootstrap', url: '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=b', rev: 'b', entries: ['@deepseek-ai/dsh-client-modules'] },
    {
      phase: 'application',
      url: '/plugins-local/??@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-lab-drift/client.js,@dsh-one/vscode-sidebar-ui-layout/client.js&rev=c',
      rev: 'c',
      entries: ['@deepseek-ai/dsh-client-ui-plan', '@deepseek-ai/dsh-client-lab-drift', '@dsh-one/vscode-sidebar-ui-layout'],
    },
  ],
})

interface RunOptions {
  wire?: unknown
  /** 上一轮留下的记录（字符串即原样塞进 sessionStorage，用来造「坏记录」那一档）。 */
  stored?: string
  /** `setItem` 抛错（存储不可用）。 */
  storageBroken?: boolean
  /** 这一页有没有失败提示条那一格（`failureNotice.ts` 的全局）。 */
  failureApi?: boolean
  /** 运行脚本之后依次在沙箱里发出的控制台错误（在沙箱内造 Error，`instanceof` 才成立）。 */
  emit?: readonly string[]
}

interface RunResult {
  reloads: number
  /** 页面自己那些 warn 行（留痕）。 */
  warns: string[]
  /** 透传出去的控制台错误（原样，证明这层没吞）。 */
  passedThrough: string[]
  storage: Record<string, string>
  mark: string | null
  wire: { entries: { id: string }[]; batches: { phase: string; url: string; entries: string[] }[] } | undefined
  notices: string[]
  noticeShown: number
}

function run(options: RunOptions = {}): RunResult {
  const storage: Record<string, string> = {}
  if (options.stored !== undefined) storage[SELF_HEAL_STORAGE_KEY] = options.stored
  const warns: string[] = []
  const passedThrough: string[] = []
  const notices: string[] = []
  let noticeShown = 0
  let reloads = 0
  let mark: string | null = null
  const sandbox: Record<string, unknown> = {
    __DSH_BOOT__: options.wire === undefined ? bootWire() : options.wire,
    console: {
      warn: (text: unknown) => warns.push(String(text)),
      error: (text: unknown) => passedThrough.push(String(text)),
    },
    sessionStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        if (options.storageBroken === true) throw new Error('storage unavailable')
        storage[key] = value
      },
    },
    document: { documentElement: { setAttribute: (name: string, value: string) => { if (name === SELF_HEAL_MARK) mark = value } } },
    location: { reload: () => { reloads += 1 } },
    window: { addEventListener: () => undefined },
  }
  if (options.failureApi !== false) {
    sandbox[PAGE_FAILURE_API] = {
      note: (text: unknown, force?: unknown) => notices.push(`${force === true ? 'force:' : ''}${String(text)}`),
      show: () => { noticeShown += 1 },
    }
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(selfHealJs(), context)
  // 审计错误在沙箱**里面**造：外面造的 Error 跨 realm，脚本里那句 `arg instanceof Error`
  // 会认不出来（页面里是同 realm，没这个问题）。
  for (const text of options.emit ?? []) {
    vm.runInContext(`console.error(new Error(${JSON.stringify(text)}))`, context)
  }
  return {
    reloads,
    warns,
    passedThrough,
    storage,
    mark,
    wire: sandbox.__DSH_BOOT__ as RunResult['wire'],
    notices,
    noticeShown,
  }
}

const record = (result: RunResult): { attempt?: number; removed?: string[]; reason?: string } | null => {
  const raw = result.storage[SELF_HEAL_STORAGE_KEY]
  return raw === undefined ? null : (JSON.parse(raw) as { removed: string[]; reason: string })
}

/**
 * 清单里的 id 表。
 *
 * 为什么经 `Array.from` 过一道：脚本跑在 `node:vm` 的上下文里，它产出的数组是**那个
 * realm 的** Array——`assert.deepStrictEqual` 连原型一起比，跨 realm 的数组永远不等
 * 于字面量（读数看起来一模一样，红起来却毫无线索）。
 */
const ids = (list: readonly unknown[] | undefined): string[] =>
  Array.from(list ?? [], (row) => String((row as { id?: unknown }).id ?? row))

test('第一次遇到审计：写下「要摘谁、为什么」并重载这一页一次', () => {
  const result = run({ emit: [audit([PENDING])] })
  assert.equal(result.reloads, 1, '第一次遇到审计要重载一次')
  assert.deepEqual(record(result)?.removed, ['@deepseek-ai/dsh-client-ui-plan'])
  assert.match(record(result)?.reason ?? '', /web boot: 1 entry did not activate/)
  assert.equal(result.warns.length, 1, '留痕：一条日志')
  assert.match(result.warns[0] ?? '', /the boot audit named \[@deepseek-ai\/dsh-client-ui-plan\]/)
  assert.match(result.warns[0] ?? '', /dropping \[@deepseek-ai\/dsh-client-ui-plan\] and reloading this page once/)
  assert.match(result.warns[0] ?? '', /did not activate/, '日志里带「因为什么」（官方审计原文）')
  assert.deepEqual(
    result.passedThrough,
    [`Error: ${audit([PENDING])}`],
    '原始审计错误原样透传（这层只旁听，不吞；沙箱侧把 Error 记成 `Error: <message>`）',
  )
  assert.equal(result.noticeShown, 0, '救得回来的时候不该落失败提示条')
})

test('重载之后（记录已在）：本页清单三处一起摘掉，不再重载', () => {
  const first = run({ emit: [audit([PENDING])] })
  const stored = first.storage[SELF_HEAL_STORAGE_KEY] ?? ''
  const result = run({ stored })
  assert.equal(result.reloads, 0, '已经用过那一次，不再重载')
  assert.deepEqual(
    ids(result.wire?.entries),
    ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-lab-drift', '@dsh-one/vscode-sidebar-ui-layout'],
    '被点名那条从 entries 里摘掉了',
  )
  assert.deepEqual(ids(result.wire?.batches[1]?.entries), ['@deepseek-ai/dsh-client-lab-drift', '@dsh-one/vscode-sidebar-ui-layout'], '批的 entries 里也摘掉了')
  assert.ok(!(result.wire?.batches[1]?.url ?? '').includes('dsh-client-ui-plan'), `combo URL 里也摘掉了：${result.wire?.batches[1]?.url ?? ''}`)
  assert.equal(result.wire?.batches[0]?.entries.length, 1, 'bootstrap 批一个字节不动')
  assert.equal(result.mark, '@deepseek-ai/dsh-client-ui-plan', '页面上留下「摘过谁」的痕迹')
  assert.match(result.warns[0] ?? '', /stripped \[@deepseek-ai\/dsh-client-ui-plan\] from this page's manifest/)
  assert.match(result.warns[0] ?? '', /previous load's boot audit was: web boot: 1 entry did not activate/, '留痕里带上一轮「因为什么」')
})

test('重载之后再失败：不再摘、不再重载，落到失败提示条', () => {
  const first = run({ emit: [audit([PENDING])] })
  const stored = first.storage[SELF_HEAL_STORAGE_KEY] ?? ''
  const result = run({ stored, emit: [audit([IMPORT_FAILED])] })
  assert.equal(result.reloads, 0, '只试一次：第二次不再重载')
  assert.deepEqual(record(result)?.removed, ['@deepseek-ai/dsh-client-ui-plan'], '记录一个字节不改（没有第二次摘）')
  assert.deepEqual(result.storage[SELF_HEAL_STORAGE_KEY], stored, 'sessionStorage 里那份记录原样')
  assert.equal(result.noticeShown, 1, '落到失败提示条')
  assert.match(result.notices[0] ?? '', /did not activate/, '提示条拿到的是官方那段审计原文')
  assert.match(
    result.notices[0] ?? '',
    /^force:/,
    '显式交过去时带 force（被动捕获到的那一句可能更早落进提示条：跨源经典脚本被浏览器抹成 Script error.）',
  )
  assert.ok(
    result.warns.some((line) => line.includes('failed again after the single retry; dropping nothing more')),
    `留痕：写明不再摘（${result.warns.join(' | ')}）`,
  )
})

test('次数上限：同一次加载里连报两次也只动一次（handled 之后不再处理）', () => {
  const result = run({ emit: [audit([PENDING]), audit([IMPORT_FAILED])] })
  assert.equal(result.reloads, 1, '只重载一次')
  assert.equal(result.warns.length, 1, '只留一条痕')
})

test('存储不可用：不重载（写不下记录就没有「只试一次」的保证），落到失败提示条', () => {
  const result = run({ storageBroken: true, emit: [audit([PENDING])] })
  assert.equal(result.reloads, 0)
  assert.equal(record(result), null)
  assert.ok(
    result.warns.some((line) => line.includes('cannot record the single retry (session storage unavailable); not reloading')),
    result.warns.join(' | '),
  )
  assert.equal(result.noticeShown, 1)
})

test('文本不是审计形状：什么都不动（不重载、不记录、不落提示条）', () => {
  const result = run({ emit: ['Error: something else broke\n  at foo', audit([])] })
  assert.equal(result.reloads, 0)
  assert.equal(result.warns.length, 0)
  assert.equal(result.noticeShown, 0)
  assert.equal(record(result), null)
})

test('点名的 id 不在本页清单里：不浪费那一次重载，落到失败提示条', () => {
  const result = run({ emit: [audit(['@deepseek-ai/dsh-client-ui-nope: import failed (see console for the import error)'])] })
  assert.equal(result.reloads, 0)
  assert.equal(record(result), null)
  assert.match(result.warns[0] ?? '', /none of them can be dropped from this page's manifest; not reloading/)
  assert.equal(result.noticeShown, 1)
})

test('点名的 id 落在 bootstrap 批：不动它（loader 自己），落到失败提示条', () => {
  const result = run({ emit: [audit(['@deepseek-ai/dsh-client-modules: pending (waiting for service: loader)'])] })
  assert.equal(result.reloads, 0)
  assert.equal(result.noticeShown, 1)
  assert.equal(result.wire?.batches[0]?.entries.length, 1, 'bootstrap 批没被动过')
})

test('点名的 id 是它所在批的唯一成员：不摘（摘了会剩一个空批，官方解析器拒），落到失败提示条', () => {
  const wire = {
    rev: 'rev-1',
    entries: [{ id: '@deepseek-ai/dsh-client-lab-drift', url: '/plugins-local/??@deepseek-ai/dsh-client-lab-drift/client.js&rev=c', rev: 'c' }],
    batches: [{ phase: 'application', url: '/plugins-local/??@deepseek-ai/dsh-client-lab-drift/client.js&rev=c', rev: 'c', entries: ['@deepseek-ai/dsh-client-lab-drift'] }],
  }
  const result = run({ wire, emit: [audit([IMPORT_FAILED])] })
  assert.equal(result.reloads, 0)
  assert.equal(record(result), null)
  assert.equal(result.noticeShown, 1)
})

test('没有失败提示条那一格时也不炸（页面缺那一半时只是没地方落提示）', () => {
  const result = run({ failureApi: false, emit: [audit([PENDING])] })
  assert.equal(result.reloads, 1)
  assert.equal(result.noticeShown, 0)
})

test('坏记录（不是那份 JSON 形状）：当作没有记录，照常重试一次', () => {
  const result = run({ stored: '{"nope":true}', emit: [audit([PENDING])] })
  assert.equal(result.reloads, 1)
  assert.deepEqual(record(result)?.removed, ['@deepseek-ai/dsh-client-ui-plan'])
})

test('多条审计条目：点名的都摘（只认文本里点出来的那些）', () => {
  const result = run({ emit: [audit([PENDING, IMPORT_FAILED])] })
  assert.equal(result.reloads, 1)
  assert.deepEqual(record(result)?.removed, ['@deepseek-ai/dsh-client-ui-plan', '@deepseek-ai/dsh-client-lab-drift'])
})
