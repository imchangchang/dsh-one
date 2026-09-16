/**
 * 侧栏风格的**档位表断言**（#113）：侧栏里每一处几何（高度 / 圆角 / 字号 / 图标位 / 间距）
 * 都必须能在那张三档的官方档位表里找到出处——**不许自造中间值**。表与出处写在
 * `src/ui/assembly/shell/workspaceTree/styles.ts` 文件头的「官方档位表」一节，代码形态是
 * 它导出的 `SCALE_TIERS` / `SCALE_EXEMPT`；本文件把它们与**真正的样式字符串**、以及
 * shell 侧那张密度表对着读，做四件事：
 *
 * ① 扫 `styles.ts` 导出的 CSS 里每条规则的圆角/高度/字号/图标位（含文字行高），每个字面量
 *    都必须在档位表里**按属性对得上那一组量**（圆角对 *Radius 的量、高度对 *Height/*Size 的
 *    量、字号对 *FontSize、宽度对 *Width/*Size）——以后新控件随手写个 6px 圆角就会在这里红；
 * ② 密度表（sidebarFramePlugin.ts 的 `DENSITY_PROFILE`）的 **vscode 列全部落在紧凑档**、
 *    **official 列全部落在标准档**——「VS Code 档 = 官方紧凑档」这句话可执行；
 * ③ 紧凑档真的比标准档紧，且 VS Code 档不得大于官方原值（判据与 assemblyShellContract 同口径）；
 * ④ 例外清单里的选择器在样式里真的存在、每条都写了理由——防陈旧豁免。
 *
 * 为什么密度表要扫源码文本而不是 import：sidebarFramePlugin.ts 依赖 react 与官方私有包
 * （单测里 import 不进来），这与 assemblyShellContract.test.ts 的处理一致。styles.ts 没有
 * 任何 import，直接读它的实体最稳。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CSS, SCALE_EXEMPT, SCALE_TIERS } from '../src/ui/assembly/shell/workspaceTree/styles.ts'

const SHELL_DIR = path.join(import.meta.dirname, '..', 'src', 'ui', 'assembly', 'shell')

/** shell 侧密度表（源码文本解析，理由见文件头）。 */
function densityProfile(): Map<string, { official: string; vscode: string }> {
  const shell = fs.readFileSync(path.join(SHELL_DIR, 'sidebarFramePlugin.ts'), 'utf8')
  const entries = [...shell.matchAll(/'([a-z-]+)':\s*\{\s*official:\s*'([^']+)',\s*vscode:\s*'([^']+)'\s*\}/g)]
  assert.ok(entries.length >= 20, `密度表至少要有 20 项（实际 ${String(entries.length)}）`)
  return new Map(entries.map((m) => [m[1] ?? '', { official: m[2] ?? '', vscode: m[3] ?? '' }]))
}

type TierName = keyof typeof SCALE_TIERS

const metricEntries = (tier: TierName): [string, string][] =>
  Object.entries(SCALE_TIERS[tier] as Record<string, string>)

/** 档位表里的全部取值（三档并集）。 */
const TIER_VALUES: ReadonlySet<string> = new Set(
  (['compact', 'standard', 'container'] as TierName[]).flatMap((tier) => metricEntries(tier).map(([, value]) => value)),
)

/**
 * 属性 → 它能引用的**量的名字**：档位表里的量名就是它的语义单位（rowHeight / rowRadius /
 * fontSize…），所以「这条规则的圆角」只能引用 *Radius 的量、字号只能引用 *FontSize 的量。
 * 这样断言不只是「值在表里出现过」，而是「值对得上这一类量」。
 */
const PROP_METRIC: Readonly<Record<string, RegExp>> = {
  'border-radius': /radius$/i,
  // `(?<!line)`：文字行高（*LineHeight）不是「高度」——一个 20px 的盒子不能拿 20px 的
  // 文字行高当出处，反过来也一样。
  height: /(?<!line)(height|size)$/i,
  'min-height': /(?<!line)(height|size)$/i,
  width: /(?<!line)(width|size)$/i,
  'font-size': /fontsize$/i,
  'line-height': /lineheight$/i,
}

/** 某条属性可引用的档位取值（三档一起看）。 */
function allowedFor(prop: string): ReadonlySet<string> {
  const pattern = PROP_METRIC[prop]
  const out = new Set<string>()
  for (const tier of ['compact', 'standard', 'container'] as TierName[]) {
    for (const [metric, value] of metricEntries(tier)) if (pattern.test(metric)) out.add(value)
  }
  return out
}

/** 一条 CSS 声明里要盯的属性：圆角 / 高度 / 字号 / 图标位（宽高）与文字行高。 */
const CHECKED_PROPS = Object.keys(PROP_METRIC)

/** 不是「档位取值」的值：布局必需值（0 / 百分比 / calc）与关键字。 */
function isStructural(value: string): boolean {
  return (
    value === '0' ||
    value.endsWith('%') ||
    value.includes('calc(') ||
    value.includes('inherit') ||
    value === 'auto' ||
    value === 'none'
  )
}

interface Declaration {
  selector: string
  prop: string
  value: string
}

/** 样式字符串里全部的几何声明（注释不在字符串里，规则是扁平的 `选择器{声明}` 序列）。 */
function geometryDeclarations(css: string): Declaration[] {
  const out: Declaration[] = []
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? '').trim()
    for (const decl of (rule[2] ?? '').split(';')) {
      const at = decl.indexOf(':')
      if (at < 0) continue
      const prop = decl.slice(0, at).trim()
      const value = decl.slice(at + 1).trim()
      if (CHECKED_PROPS.includes(prop)) out.push({ selector, prop, value })
    }
  }
  return out
}

function exemptReason(selector: string): string | undefined {
  for (const entry of SCALE_EXEMPT) {
    // 例外按选择器的子串认：一条规则可能带 `:hover` / 属性选择器，都算同一条。
    for (const name of selector.split(',')) {
      if (name.trim().includes(entry.selector)) return entry.reason
    }
  }
  return undefined
}

interface ScanResult {
  offenders: string[]
  /** 逐条比过档位表的字面量数。 */
  checked: number
  /** 走密度变量的声明数（值由 shell 那张表给）。 */
  densityDriven: number
  /** 结构性取值（0 / % / calc）与非档位属性，跳过。 */
  skipped: number
}

/** 表驱动扫描：返回所有「取值在档位表里找不到出处」的声明。 */
function scanScale(css: string): ScanResult {
  const result: ScanResult = { offenders: [], checked: 0, densityDriven: 0, skipped: 0 }
  for (const { selector, prop, value } of geometryDeclarations(css)) {
    if (exemptReason(selector) !== undefined) continue
    if (value.startsWith('var(--dsh-one-density-')) {
      assert.match(value, /^var\(--dsh-one-density-[a-z-]+,\s*[^)]+\)$/, `${selector} 的 ${prop} 写法不对：${value}`)
      result.densityDriven += 1
      continue
    }
    if (value.includes('var(') || isStructural(value)) {
      result.skipped += 1
      continue
    }
    result.checked += 1
    if (!allowedFor(prop).has(value)) result.offenders.push(`${selector} { ${prop}: ${value} }`)
  }
  return result
}

test('档位表本身完整：三档都在、取值都是长度字面量、每档非空', () => {
  for (const tier of ['compact', 'standard', 'container'] as TierName[]) {
    const values = metricEntries(tier).map(([, value]) => value)
    assert.ok(values.length >= 5, `档位表 ${tier} 档至少要有 5 个量（实际 ${String(values.length)}）`)
    for (const value of values) {
      assert.match(value, /^\d+(\.\d+)?(px|%)$/, `${tier} 档的取值必须是长度字面量，得到 ${value}`)
    }
  }
  // 紧凑档真的比标准档紧：判据是数值逐项比大小，与 assemblyShellContract 同一口径，
  // 只是抬到了档位层（对同一个语义单位比两个档）。
  const compact = SCALE_TIERS.compact as Record<string, string>
  const standard = SCALE_TIERS.standard as Record<string, string>
  const px = (value: string): number => Number.parseFloat(value)
  assert.ok(px(compact.rowHeight) < px(standard.projectRowHeight), '紧凑档行高必须小于标准档工作区行高')
  assert.ok(px(compact.rowHeight) < px(standard.sessionRowHeight), '紧凑档行高必须小于标准档会话行高')
  assert.ok(px(compact.rowRadius) < px(standard.rowRadius), '紧凑档行圆角必须小于标准档行圆角')
  assert.ok(px(compact.fontSize) < px(standard.titleFontSize), '紧凑档字号必须小于标准档标题字号')
  assert.ok(px(compact.lineHeight) < px(standard.titleLineHeight), '紧凑档文字行高必须小于标准档标题行高')
  assert.ok(px(compact.rowPaddingInline) < px(standard.rowPaddingInline), '紧凑档行内边距必须小于标准档行内边距')
  assert.ok(px(compact.rowHeight) < px(standard.searchRowMinHeight), '紧凑档行高必须小于标准档搜索结果行最小高')
})

test('侧栏样式里的圆角/高度/字号/图标位取值都能在档位表里找到出处（表驱动扫描）', () => {
  const result = scanScale(CSS)
  assert.deepEqual(
    result.offenders,
    [],
    '这些取值在档位表里找不到出处（要么按档取，要么在 SCALE_EXEMPT 里写明为什么豁免）：\n' + result.offenders.join('\n'),
  )
  assert.ok(result.checked >= 30, `真正比对过的字面量太少（${String(result.checked)}），扫法可能失效了`)
  assert.ok(result.densityDriven >= 15, `走密度变量的项太少（${String(result.densityDriven)}）`)
  assert.ok(result.skipped >= 1, '至少要有几处结构性取值（0 / 百分比 / calc）被跳过')
})

test('扫描器自检：档位表里没有的值必须被判红（这条守着上面那条不是橡皮图章）', () => {
  // 自造值：6.5px 在任何档里都不存在（6px 那种「恰好是别的量的值」也在这里钉住语义——
  // 圆角只认 *Radius 的量，所以 6px 圆角同样会红）。
  const invented = scanScale('.dshOneTree_probe{border-radius:6.5px;height:31px;font-size:11.5px}')
  assert.deepEqual(invented.offenders, [
    '.dshOneTree_probe { border-radius: 6.5px }',
    '.dshOneTree_probe { height: 31px }',
    '.dshOneTree_probe { font-size: 11.5px }',
  ])
  assert.equal(invented.checked, 3)
  // 「6px 圆角」：6px 在表里是行内间隙（compact.rowGap），不是圆角——必须照样红。
  assert.deepEqual(scanScale('.dshOneTree_probe{border-radius:6px}').offenders, ['.dshOneTree_probe { border-radius: 6px }'])
  // 合法取值不报：紧凑档行圆角 5px、行高 26px、字号 12px。
  assert.deepEqual(scanScale('.dshOneTree_probe{border-radius:5px;height:26px;font-size:12px}').offenders, [])
  // 密度变量与结构性取值既不报、也不计入「比过的字面量」。
  const mixed = scanScale('.dshOneTree_probe{height:var(--dsh-one-density-row-height,34px);width:100%}')
  assert.deepEqual(mixed.offenders, [])
  assert.equal(mixed.checked, 0)
  assert.equal(mixed.densityDriven, 1)
  assert.equal(mixed.skipped, 1)
})

test('密度表：vscode 列全部落在紧凑档、official 列全部落在标准档（VS Code 档 = 官方紧凑档）', () => {
  const profile = densityProfile()
  const compact = new Set(metricEntries('compact').map(([, value]) => value))
  const standard = new Set(metricEntries('standard').map(([, value]) => value))
  const badCompact: string[] = []
  const badStandard: string[] = []
  for (const [key, value] of profile) {
    if (!compact.has(value.vscode)) badCompact.push(`${key}=${value.vscode}`)
    if (!standard.has(value.official)) badStandard.push(`${key}=${value.official}`)
  }
  assert.deepEqual(badCompact, [], '这些键的 VS Code 档不是紧凑档里的值（自造中间值）：\n' + badCompact.join('\n'))
  assert.deepEqual(badStandard, [], '这些键的官方原值不在标准档里（出处表漏登记了）：\n' + badStandard.join('\n'))
  for (const [key, value] of profile) {
    assert.ok(
      Number.parseFloat(value.vscode) <= Number.parseFloat(value.official),
      `${key} 的 VS Code 档（${value.vscode}）不得大于官方原值（${value.official}）`,
    )
  }
})

test('密度表里的每个键都写进了档位表的说明（键面 = 样式里消费的键面）', () => {
  const profile = densityProfile()
  const consumed = new Set([...CSS.matchAll(/var\(--dsh-one-density-([a-z-]+),/g)].map((m) => m[1] ?? ''))
  assert.deepEqual([...consumed].sort(), [...profile.keys()].sort(), '样式消费的密度键必须与 shell 那张表一一对应')
  // 行圆角（#113）是唯一一项进入密度表的圆角：它必须在两个档之间取值不同，否则没必要走变量。
  const rowRadius = profile.get('row-radius')
  assert.equal(rowRadius?.official, SCALE_TIERS.standard.rowRadius, 'row-radius 的官方原值要等于标准档的行圆角')
  assert.equal(rowRadius?.vscode, SCALE_TIERS.compact.rowRadius, 'row-radius 的 VS Code 档要等于紧凑档的行圆角')
})

test('例外清单：选择器在样式里真的存在，且每条都写了理由', () => {
  assert.ok(SCALE_EXEMPT.length >= 1, '例外清单不能为空')
  for (const entry of SCALE_EXEMPT) {
    assert.ok(entry.reason.trim().length >= 8, `例外 ${entry.selector} 要写明理由（不能只写几个字）`)
    assert.ok(CSS.includes(`.${entry.selector}`), `例外 ${entry.selector} 在样式里找不到（陈旧豁免）`)
  }
  // 标签组（#107）逐字沿用旧侧栏的取值，是例外里最大的一条：确认它真的还在。
  const tagRules = [...CSS.matchAll(/\.dshOneTree_tag[a-zA-Z]*\{/g)].length
  assert.ok(tagRules >= 5, `标签组的规则应当仍在样式里（实际扫到 ${String(tagRules)} 条）`)
})
