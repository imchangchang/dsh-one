/**
 * 用户可见文案里不许再出现内部说法（#218）。
 *
 * `assembly wire` / `assembly mirror` / `chat assembly` 在仓库内部是准确的说法，
 * 但这些串会原样落到用户眼前的失败提示里（面板打不开时的错误弹窗、页面失败提示条），
 * 用户看不懂。这类问题实验室照不出来（得真出错才显示），所以判据放在静态扫描上：
 *
 * 1. **运行时文案 bundle**（`l10n/bundle.l10n.json`，键 = 英文源串）不带 `assembly`；
 * 2. **中文 bundle** 不带「装配」与 `mirror`（此前遗留的另一半口径）；
 * 3. **页面失败提示条**自己的词典（`failureNotice.ts`，内嵌在页面脚本里、不走 bundle）
 *    中英文都不带这些说法；
 * 4. **会被拼进用户提示的 thrown Error 文本**（`wireFilter.ts` / `assemblyMirror.ts`
 *    的报错经 `showErrorMessage('… : {0}', reason)` 落到用户界面）不再以内部说法开头。
 *
 * 日志（`logger.*` 那几行，维护者看的）与 HTTP 响应体不在此列，故意留着。
 * 负向对照：把任一处改回旧串（如 `Failed to load the assembly wire from the dsh
 * gateway: {0}`）→ 这里红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PAGE_FAILURE_TEXT } from '../src/ui/assembly/failureNotice.ts'

const ROOT = path.join(import.meta.dirname, '..')

const readJson = (file: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, string>

/** 内部说法（用户看不懂的那些）。 */
const INTERNAL_EN = /assembly/i
const INTERNAL_ZH = /装配|mirror/i

test('运行时文案的英文源串不再出现 assembly（#218）', () => {
  const bundle = readJson(path.join('l10n', 'bundle.l10n.json'))
  const offenders = Object.entries(bundle)
    .filter(([key, value]) => INTERNAL_EN.test(key) || INTERNAL_EN.test(value))
    .map(([key]) => key)
  assert.deepEqual(offenders, [], '英文源串里还有内部说法')
})

test('运行时文案的中文译文不再出现「装配」/ mirror（#218）', () => {
  const bundle = readJson(path.join('l10n', 'bundle.l10n.zh-cn.json'))
  const offenders = Object.entries(bundle)
    .filter(([, value]) => INTERNAL_ZH.test(value))
    .map(([key]) => key)
  assert.deepEqual(offenders, [], '中文译文里还有内部说法')
})

test('页面失败提示条自己的词典也是平实说法（#218）', () => {
  const dictionaries: Array<[string, Readonly<Record<string, string>>]> = [
    ['zh', PAGE_FAILURE_TEXT.zh],
    ['en', PAGE_FAILURE_TEXT.en],
  ]
  for (const [lang, dict] of dictionaries) {
    for (const [key, text] of Object.entries(dict)) {
      assert.doesNotMatch(text, INTERNAL_EN, `${lang}.${key} 有内部说法`)
      assert.doesNotMatch(text, INTERNAL_ZH, `${lang}.${key} 有内部说法`)
    }
  }
})

test('会被拼进用户提示的报错文本不以内部说法开头（#218）', () => {
  // 只查 `new Error(` 紧跟着的那个字面量（含跨行的模板串）——logger.* 那几行不在此列。
  const THROW_WITH_INTERNAL_WORD = /new Error\(\s*[`'"]assembly /
  for (const file of [path.join('src', 'ui', 'assembly', 'wireFilter.ts'), path.join('src', 'server', 'assemblyMirror.ts')]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.doesNotMatch(source, THROW_WITH_INTERNAL_WORD, `${file} 的报错文本里还有内部说法`)
  }
})
