/**
 * F-54（交互活性探针）里**按文案认控件**的选择器：每条都必须解析出 zh / en 两份（#209）。
 *
 * 病根（#208 收尾时留下的）：那张交互点表里有一批选择器是**按文案**认控件的
 * （`button[aria-label="发送消息"]`、`[role="tab"]:has-text("轨迹")` 这类）。#208 把它们
 * 改成两语言都认了，但那条约束只活在人的记忆里——下一次有人写一条同类的单语言字面量，选择器
 * 在另一种页面语言上命不中，而**这套套件按「元素不在场 → 记事实跳过」放过去**：报告里看着
 * 全绿、覆盖面悄悄缩水。所以这个类目得有常驻自检，而不是靠人记得。
 *
 * 这份自检不靠选择器字符串的形状去猜哪一条是「按文案认控件」（那种扫描器脆），而是读交互点表
 * 上**声明的档位**（`LivenessPoint.textSources`，见 `livenessSuites.ts` 的 `LivenessTextTier`），
 * 逐条断言三件事：
 *
 * 1. `texts(文案)` 解析出 zh / en **两份**（解析不出第二份当场红，并点名是哪个交互点、哪条文案）；
 * 2. 两份取值来自它**声明的**那一档（`ours` 走我们那份词典、`official` 登记在
 *    `harness.ts` 的 `OFFICIAL_EXTRA`、`locale-self-name` 是两个语言的**自称**）；
 * 3. 两份取值都真的**落在**那条选择器里（写死一份字面量的写法在这里红）。
 *
 * 覆盖面按 #208 的成果：19 条文案 = 我们自己的 9 条（侧栏那几枚，`ours`）+ 官方件的 9 条
 * （`official`）+ 语言下拉那 1 条（`locale-self-name`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasOfficialExtra, texts } from './assembly-lab/harness.ts'
import {
  LIVENESS_POINTS,
  livenessTextSelectorCalls,
  type LivenessPoint,
  type LivenessTextSource,
} from './assembly-lab/livenessSuites.ts'

/**
 * 官方语言目录 `BUILT_IN_LOCALE_METADATA` 里那两个语言**用自己语言写**的名字
 * （官方 `@deepseek-ai/dsh-client-locale` 的 `lib/client.js`：`zh.label = "中文"`、
 * `en.label = "English"`）。
 *
 * 语言下拉那一枚按钮上显示的就是当前语言的自称：zh 页上是「中文」、en 页上是「English」。
 * 它**不是**某条词典键的 zh / en 译文（「中文」的英文译文是 "Chinese"，不是 "English"），
 * 所以这一档不能按「同一条键的两种译文」来判——这正是它单开一档的理由。这两份取值同样写在
 * `harness.ts` 的 `OFFICIAL_EXTRA` 里（那边管的是「这个字面量我们上哪儿查」），这里管的是
 * 「它必须等于官方语言目录里的自称」。
 */
const LOCALE_SELF_NAMES: readonly [string, string] = ['中文', 'English']

/** 一份变体在文案里的**字面量段**：把 `{app}` / `{percent}` 这类占位切掉，去掉空段与首尾空白。 */
function literalSegments(template: string): string[] {
  return template
    .split(/\{\w+\}/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * 一条变体有没有**落在**这条选择器里：它至少有一段字面量在选择器里出现。
 *
 * 为什么要「至少一段」而不是「每段都出现」：带占位的那两条的拼法只取模板的一部分——会话头
 * open-in-app 那枚的 `{app}` 由宿主填（本机上是「访达」/「Finder」），选择器只按 `{app}` 之前
 * 那一段做前缀匹配（见 `livenessSuites.ts` 的 `OPEN_IN_APP_BUTTON`）。反过来，**一份变体一段
 * 都没落进选择器**就说明这份语言上选择器命不中——那正是要红的东西（例如把选择器又改回
 * 只写中文那一条，en 那份变体就一段都落不进来）。
 */
function materializes(variant: string, selector: string): boolean {
  return literalSegments(variant).some((segment) => selector.includes(segment))
}

/** 一条问题的抬头：点名是哪个交互点、哪条文案。 */
function where(point: LivenessPoint, source: LivenessTextSource): string {
  return `交互点「${point.label}」的文案「${source.zh}」`
}

test('F-54 的文案选择器：每条都解析出 zh / en 两份、取值来自声明的档位、两份都落在选择器里', () => {
  const problems: string[] = []
  let checked = 0

  for (const point of LIVENESS_POINTS) {
    for (const source of point.textSources ?? []) {
      checked += 1
      const variants = texts(source.zh)
      if (variants.length < 2) {
        // `texts()` 在两个来源里都查不到时只原样回一条中文——这就是「缺一份」，en 页上这条
        // 选择器会静默落空。
        problems.push(
          `${where(point, source)}只解析出 ${variants.length} 条变体（${JSON.stringify(variants)}）：` +
            `声明是 ${source.tier} 档，但两种语言里只拿得出一份取值`,
        )
        continue
      }
      const [zhVariant = '', enVariant = ''] = variants
      if (zhVariant === '' || enVariant === '') {
        problems.push(`${where(point, source)}有一份变体是空串：${JSON.stringify(variants)}`)
        continue
      }

      // 取值来自哪一档：官方件的标签不经过我们那份词典，两条路不许混（混了就是档位声明错了）。
      const fromOfficialExtra = hasOfficialExtra(source.zh)
      if (source.tier === 'ours' && fromOfficialExtra) {
        problems.push(
          `${where(point, source)}声明是我们自己词典那一档（ours），但它登记在 harness.ts 的 OFFICIAL_EXTRA 里——` +
            '官方件的标签和我们词典里的键，改档位声明，别让两边都像对',
        )
      }
      if (source.tier !== 'ours' && !fromOfficialExtra) {
        problems.push(
          `${where(point, source)}声明是 ${source.tier} 档，但 harness.ts 的 OFFICIAL_EXTRA 里没有这一条` +
            '（官方件的标签不经过我们那份词典，两边都没有时 `texts()` 只会回一条中文）',
        )
      }

      // 两份取值逐字相同 = 第二份其实不存在（词典里那条只有中文一份时 `texts()` 就回两次中文）。
      if (zhVariant === enVariant) {
        problems.push(
          `${where(point, source)}的两份取值逐字相同（${zhVariant}）——另一种页面语言上实际只有这一份，等于没覆盖`,
        )
      }

      // 语言下拉那一档：取值必须是两个语言的自称，而不是某条键的译文。
      if (source.tier === 'locale-self-name' && (zhVariant !== LOCALE_SELF_NAMES[0] || enVariant !== LOCALE_SELF_NAMES[1])) {
        problems.push(
          `${where(point, source)}是语言下拉那一档（locale-self-name）：两份取值必须是语言自己用自己语言写的名字` +
            `（${LOCALE_SELF_NAMES.join(' / ')}），实测是 ${JSON.stringify(variants)}`,
        )
      }

      // 两份取值都得真的落进选择器里（含官方页那一条，它是同一个控件在官方页上的选择器）。
      for (const [index, variant] of variants.entries()) {
        const which = index === 0 ? 'zh' : 'en'
        if (!materializes(variant, point.selector)) {
          problems.push(`${where(point, source)}的 ${which} 那一份「${variant}」没落在选择器里：${point.selector}`)
        }
        if (point.official !== undefined && !materializes(variant, point.official)) {
          problems.push(`${where(point, source)}的 ${which} 那一份「${variant}」没落在**官方页**那条选择器里：${point.official}`)
        }
      }
    }
  }

  assert.ok(checked > 0, '交互点表里一条声明了文案的交互点都没有——自检没东西可查，先看看 LIVENESS_POINTS 是不是空的')
  assert.deepEqual(problems, [], `#209 自检未通过（${problems.length} 处，本文件共查了 ${checked} 条文案）：\n${problems.join('\n')}`)
})

test('F-54 的文案选择器：表里声明的档位与真正按文案拼过的选择器一一对上（两个方向都查）', () => {
  const declaredAt = new Map<string, string[]>()
  for (const point of LIVENESS_POINTS) {
    for (const source of point.textSources ?? []) {
      declaredAt.set(source.zh, [...(declaredAt.get(source.zh) ?? []), point.label])
    }
  }
  const built = new Set(livenessTextSelectorCalls())

  // 方向一：拼了选择器却没声明档位——新加一条按文案认控件的选择器时最容易漏的一步，
  // 漏了就意味着上面那个测试的口径压根没管到它。
  const builtButUndeclared = [...built].filter((zh) => !declaredAt.has(zh))
  // 方向二：声明了却没拼——选择器又被改回写死一种语言的字面量时就是这个形状。
  const declaredButUnbuilt = [...declaredAt.keys()]
    .filter((zh) => !built.has(zh))
    .map((zh) => `${zh}（声明于「${(declaredAt.get(zh) ?? []).join('」「')}」）`)

  assert.deepEqual(
    builtButUndeclared,
    [],
    '这些文案被 textSelector 拿去拼了选择器，却没有任何交互点声明它的档位（加进对应交互点的 textSources）',
  )
  assert.deepEqual(
    declaredButUnbuilt,
    [],
    '这些文案在交互点表里声明了档位、却没有被 textSelector 拿去拼选择器（选择器大概又被写死成一种语言的字面量了）',
  )
})
