/**
 * 侧栏风格的**档位表断言**（#113）：侧栏里每一处几何（高度 / 圆角 / 字号 / 图标位 / 间距）
 * 都必须能在那张官方档位表里找到出处——**不许自造中间值**。表与出处写在
 * `src/ui/assembly/shell/workspaceTree/styles.ts` 文件头的「官方档位表」一节，代码形态是
 * 它导出的 `SCALE_TIERS` / `SCALE_EXEMPT`；本文件把它们与**真正的样式字符串**、以及
 * shell 侧那张密度表对着读，做四件事：
 *
 * ① 扫 `styles.ts` 导出的 CSS 里每条规则的圆角/高度/字号/图标位（含文字行高），每个字面量
 *    都必须在档位表里**按属性对得上那一组量**（圆角对 *Radius 的量、高度对 *Height/*Size 的
 *    量、字号对 *FontSize、宽度对 *Width/*Size）——以后新控件随手写个 6px 圆角就会在这里红；
 * ② 密度表（sidebarFramePlugin.ts 的 `DENSITY_PROFILE`）的 **横向项 vscode 列全部落在紧凑档**、
 *    **纵向留白项取官方原值**（#119 的分工：消费点全在 `margin` 上的那几项 = 块与块之间的
 *    纵向空隙 → 取官方节奏；其余按横向口径取紧凑档）、**标题文字族取官方标题档**（#123：
 *    工作区名 / 会话标题 / 行内改名输入框 / 抽屉标题 / 回收站入口行文字那一族，两边同值且
 *    = 标准档的 `titleFontSize` / `titleLineHeight`）、**official 列全部落在标准档**；
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
import { CSS, SCALE_EXEMPT, SCALE_TIER_NAMES, SCALE_TIERS } from '../src/ui/assembly/shell/workspaceTree/styles.ts'

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

/** 档位表里的全部取值（全部分组并集）。 */
const TIER_VALUES: ReadonlySet<string> = new Set(
  SCALE_TIER_NAMES.flatMap((tier) => metricEntries(tier).map(([, value]) => value)),
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

/** 某条属性可引用的档位取值（各分组一起看）。 */
function allowedFor(prop: string): ReadonlySet<string> {
  const pattern = PROP_METRIC[prop]
  const out = new Set<string>()
  for (const tier of SCALE_TIER_NAMES) {
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

/**
 * 一个密度键在样式里的全部消费点（属性名 + 所在选择器）。写法与
 * {@link geometryDeclarations} 同源：把样式字符串当成扁平的 `选择器{声明}` 序列读，
 * 声明里出现 `var(--dsh-one-density-<键>,` 就算一处消费（带逗号，键名互为前缀也不会串）。
 */
function consumptionPoints(key: string): { selector: string; prop: string }[] {
  const out: { selector: string; prop: string }[] = []
  for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? '').trim()
    for (const decl of (rule[2] ?? '').split(';')) {
      const at = decl.indexOf(':')
      if (at < 0) continue
      const prop = decl.slice(0, at).trim()
      if (decl.includes(`var(--dsh-one-density-${key},`)) out.push({ selector, prop })
    }
  }
  return out
}

/**
 * 「纵向留白」的可执行定义（#119）：这个键的**每一个**消费点都落在外边距上（`margin` /
 * `margin-top` / `margin-bottom`）——也就是「块与块之间的纵向空隙」。`padding-*` 不算：
 * 那是控件内部的内边距，纵向档位对它的口径没变。
 */
const VERTICAL_MARGIN_PROPS: ReadonlySet<string> = new Set(['margin', 'margin-top', 'margin-bottom'])

/** 一个键是不是「纵向留白项」：有消费点，且消费点全在 margin 上。 */
function isVerticalRhythmKey(key: string): boolean {
  const points = consumptionPoints(key)
  return points.length > 0 && points.every((point) => VERTICAL_MARGIN_PROPS.has(point.prop))
}

/**
 * 纵向留白项的名单（#119）。写成显式清单而不是「自动认就完了」，是因为这份名单本身
 * 就是这次改动确立的口径的一部分——**新加一个纵向留白键时要在这里登记**，顺带读一遍
 * 上面的规则：纵向取官方节奏（vscode = official），横向取紧凑档。
 * 这一次的三项都是**块与块之间 / 分节头与下面那段之间**的空隙：
 * - `row-gap`：行与行之间（官方 `.bhn1Oq_flatList>*+*{margin-top:2px}`，本来两边同值）；
 * - `group-gap`：分组过滤条下边距、工作区分块 / 抽屉分块之间（官方 `.bhn1Oq_groupSection+.bhn1Oq_groupSection{margin-top:4px}`）；
 * - `section-header-gap`：顶栏那一行（分节头）的下边距（官方 `.bhn1Oq_sectionHeader{margin-bottom:4px}`）。
 */
const VERTICAL_RHYTHM_KEYS: readonly string[] = ['row-gap', 'group-gap', 'section-header-gap']

/**
 * 「标题文字」这一族的名单（#123）。与纵向那份名单同理，写成显式清单：口径本身是这次改动
 * 的一部分，新加一个标题类字号键时要在这里登记。
 *
 * **为什么这一族不能只靠「值在紧凑档里出现过」那条判据**：`title-font-size` 的 VS Code 档是
 * 14px，而 14px 恰好也是紧凑档的量（`iconSize`，菜单项里那个 14×14 图标盒的边长）——集合判据
 * 会把「字号被写成了图标边长」这种巧合放行。所以这一族按**量名**判：vscode = official，
 * 且 official 必须等于标准档里那一项同名量的取值（`titleFontSize` / `titleLineHeight`，
 * 官方侧栏标题 `.YDXeBa_title{font-size:14px;line-height:20px}` 的逐字出处）。
 */
const TITLE_TIER_KEYS: ReadonlyArray<{ key: string; metric: 'titleFontSize' | 'titleLineHeight' }> = [
  { key: 'title-font-size', metric: 'titleFontSize' },
  { key: 'title-line-height', metric: 'titleLineHeight' },
]

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

test('档位表本身完整：每一档都在、取值都是长度字面量、每档非空', () => {
  for (const tier of SCALE_TIER_NAMES) {
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

interface TierFaults {
  /** 既不是纵向留白、也不是标题族，却没落紧凑档的键。 */
  compact: string[]
  /** 官方原值不在标准档里的键。 */
  standard: string[]
  /** 纵向留白项没取官方原值的键（#119）。 */
  vertical: string[]
  /** 标题文字族没取官方标题档的键（#123）。 */
  title: string[]
}

/**
 * 密度表逐项归档的判据本体（#119 纵向 / #123 标题族 / 其余横向）。独立成函数是为了让下面
 * 那条「口径自检」能喂一张假表——否则这几条断言是不是橡皮图章，只能靠读代码相信。
 */
function tierFaults(profile: ReadonlyMap<string, { official: string; vscode: string }>): TierFaults {
  const compact = new Set(metricEntries('compact').map(([, value]) => value))
  const standard = new Set(metricEntries('standard').map(([, value]) => value))
  const titleTier = new Map(TITLE_TIER_KEYS.map((entry) => [entry.key, entry.metric]))
  const faults: TierFaults = { compact: [], standard: [], vertical: [], title: [] }
  for (const [key, value] of profile) {
    if (!standard.has(value.official)) faults.standard.push(`${key}=${value.official}`)
    const titleMetric = titleTier.get(key)
    if (titleMetric !== undefined) {
      // 标题文字族：**取官方标题档**（#123）——不是「≤ 官方」也不是「值在标准档里出现过」，
      // 而是「两边同值，且 = 标准档里那一项**同名量**的取值」（字号对 titleFontSize、
      // 行高对 titleLineHeight）。按量名判才不会让 14px 这种「恰好也是图标位边长」的值蒙混过关。
      const wanted = SCALE_TIERS.standard[titleMetric]
      if (value.vscode !== value.official || value.official !== wanted) {
        faults.title.push(`${key}：vscode=${value.vscode} official=${value.official}，标准档 ${titleMetric}=${wanted}`)
      }
      continue
    }
    if (isVerticalRhythmKey(key)) {
      // 纵向留白：**取官方节奏**（VS Code 档 = 官方原值），不是「≤ 官方」而是「= 官方」。
      if (value.vscode !== value.official) faults.vertical.push(`${key}：vscode=${value.vscode} official=${value.official}`)
      continue
    }
    // 其余（横向的间隙 / 内边距，以及行高、字号、圆角）：仍必须落在紧凑档。
    if (!compact.has(value.vscode)) faults.compact.push(`${key}=${value.vscode}`)
  }
  return faults
}

test('密度表：#119 与 #123 的分工——横向项取紧凑档、纵向留白项取官方节奏、标题文字族取官方标题档、official 列全在标准档', () => {
  const profile = densityProfile()

  // ① 纵向留白项的名单必须与「样式里消费点全在 margin 上」的那些键**对得上**——
  //    名单不会因为某项被悄悄砍半而失真（砍了就在下面红），也不会混进横向项。
  const derivedVertical = [...profile.keys()].filter(isVerticalRhythmKey).sort()
  assert.deepEqual(
    derivedVertical,
    [...VERTICAL_RHYTHM_KEYS].sort(),
    '样式里「消费点全在 margin 上」的密度键与 VERTICAL_RHYTHM_KEYS 对不上：' +
      '多出来的说明有一项纵向留白没登记（多半是又拿紧凑档的横向值去当纵向空隙了），' +
      '少掉的说明名单把横向项也算进来了',
  )
  // ①′ 标题文字族的名单同样要落地（登记了名字、表里真有这两项、且它们不是纵向留白项）。
  for (const { key } of TITLE_TIER_KEYS) {
    assert.ok(profile.get(key) !== undefined, `标题文字族登记的 ${key} 应当在密度表里`)
    assert.ok(!isVerticalRhythmKey(key), `${key} 是文字档，不该被当成纵向留白项`)
  }

  const faults = tierFaults(profile)

  assert.deepEqual(
    faults.compact,
    [],
    '这些键的 VS Code 档不是紧凑档里的值（自造中间值）：\n' + faults.compact.join('\n'),
  )
  assert.deepEqual(faults.standard, [], '这些键的官方原值不在标准档里（出处表漏登记了）：\n' + faults.standard.join('\n'))
  assert.deepEqual(
    faults.vertical,
    [],
    '纵向留白项必须取官方原值（#119：砍半会让顶栏 / 过滤条 / 首行糊成一坨）：\n' + faults.vertical.join('\n'),
  )
  assert.deepEqual(
    faults.title,
    [],
    '标题文字族必须取官方标题档（#123：工作区名 / 会话标题 / 行内改名输入框 / 抽屉标题 / 入口行文字\n' +
      '要的是「与官方侧栏标题一致」，也就是两边同值且等于标准档的 titleFontSize / titleLineHeight）：\n' +
      faults.title.join('\n'),
  )
  for (const [key, value] of profile) {
    assert.ok(
      Number.parseFloat(value.vscode) <= Number.parseFloat(value.official),
      `${key} 的 VS Code 档（${value.vscode}）不得大于官方原值（${value.official}）`,
    )
  }
  // ⑤ 「横向保持紧凑」的可执行形态：纵向那两项的横向邻居都得仍比官方原值紧
  //    （这次只恢复纵向，横向没被顺带改宽）。
  const horizontalNeighbours = ['section-gap', 'section-padding-inline', 'row-padding-inline', 'pill-padding-start']
  for (const key of horizontalNeighbours) {
    const entry = profile.get(key)
    assert.ok(entry !== undefined, `横向邻居 ${key} 应当在密度表里`)
    const horizontal = entry ?? { official: '', vscode: '' }
    assert.ok(
      Number.parseFloat(horizontal.vscode) < Number.parseFloat(horizontal.official),
      `${key} 是横向项，VS Code 档必须仍比官方原值紧（#119 只恢复纵向）：${horizontal.vscode} vs ${horizontal.official}`,
    )
  }
  // ⑥ 「只动标题这一族」的可执行形态（#123）：同一行里的**元信息**（时间 / 计数）仍必须
  //    逐字等于紧凑档的字号 / 行高——否则就是「顺带把整行文字都放大了」，把差异也一起抹平。
  const metaTier: ReadonlyArray<{ key: string; compact: string }> = [
    { key: 'meta-font-size', compact: SCALE_TIERS.compact.fontSize },
    { key: 'meta-line-height', compact: SCALE_TIERS.compact.lineHeight },
  ]
  for (const { key, compact: wanted } of metaTier) {
    const entry = profile.get(key)
    assert.ok(entry !== undefined, `元信息 ${key} 应当在密度表里`)
    assert.equal(
      entry?.vscode,
      wanted,
      `${key} 必须仍是紧凑档的 ${wanted}（#123 只把标题那一族放回官方标题档，元信息没跟着放）`,
    )
  }
})

test('口径自检：把标题族压回紧凑档、把元信息放大都会判红（这条守着上面那条不是橡皮图章）', () => {
  const base = densityProfile()
  const mutate = (key: string, value: { official: string; vscode: string }): TierFaults => {
    const mutated = new Map(base)
    mutated.set(key, value)
    return tierFaults(mutated)
  }

  // ① 标题字号被压回紧凑档的 12px（#123 之前的写法）——按量名判会红；注意 14px 本身在紧凑档
  //    里也有（iconSize），所以光比集合是不会红的，这正是这一族要单独判的理由。
  const shrunk = mutate('title-font-size', { official: '14px', vscode: '12px' })
  assert.deepEqual(shrunk.title, ['title-font-size：vscode=12px official=14px，标准档 titleFontSize=14px'])
  // ② 两边同值、但不是标准档那一项量（14px 换成 15px）：仍然红。
  assert.equal(mutate('title-font-size', { official: '15px', vscode: '15px' }).title.length, 1)
  // ③ 标题行高被压回紧凑档的 18px：同样红。
  assert.equal(mutate('title-line-height', { official: '20px', vscode: '18px' }).title.length, 1)
  // ④ 元信息被放大到官方标题档的 20px 行高：不落任何一档，按紧凑档那条判红。
  assert.deepEqual(mutate('meta-line-height', { official: '20px', vscode: '20px' }).compact, ['meta-line-height=20px'])
  // ⑤ 现况（真表）在两条判据下都干净——上面那些红不是「怎么改都红」。
  assert.deepEqual(tierFaults(base), { compact: [], standard: [], vertical: [], title: [] })
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
