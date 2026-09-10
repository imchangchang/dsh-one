import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EAGER_LANGS, LANG_ALIASES, LAZY_LANGS, canonicalLang, isLazyLang, langAssetName } from '../src/pure/highlightLang.ts'

test('围栏语言标记按别名归一到高亮语言 id', () => {
  assert.equal(canonicalLang('ts'), 'typescript')
  assert.equal(canonicalLang('tsx'), 'typescript')
  assert.equal(canonicalLang('JavaScript'), 'typescript')
  assert.equal(canonicalLang(' bash '), 'shellscript')
  assert.equal(canonicalLang('zsh'), 'shellscript')
  assert.equal(canonicalLang('yml'), 'yaml')
  assert.equal(canonicalLang('py'), 'python')
  assert.equal(canonicalLang('cs'), 'csharp')
  assert.equal(canonicalLang('md'), 'markdown')
})

test('未登记/空白/缺省语言不着色', () => {
  assert.equal(canonicalLang(undefined), undefined)
  assert.equal(canonicalLang(''), undefined)
  assert.equal(canonicalLang('   '), undefined)
  assert.equal(canonicalLang('unknownlang'), undefined)
  assert.equal(canonicalLang('text'), undefined)
})

test('常驻 3 个语言 + 懒加载 23 个，两边不重叠', () => {
  assert.deepEqual([...EAGER_LANGS], ['typescript', 'shellscript', 'json'])
  assert.equal(LAZY_LANGS.length, 23)
  assert.equal(new Set(LAZY_LANGS).size, 23)
  for (const id of EAGER_LANGS) assert.equal(LAZY_LANGS.includes(id), false, `${id} 不该同时是懒加载语言`)
})

test('别名表里的每个目标语言都是「常驻或懒加载」之一', () => {
  for (const [marker, id] of Object.entries(LANG_ALIASES)) {
    const known = isLazyLang(id) || EAGER_LANGS.includes(id)
    assert.equal(known, true, `${marker} → ${id} 既非常驻也不在懒加载表（会永远着色不了）`)
  }
})

test('懒加载语言包的资源文件名', () => {
  assert.equal(langAssetName('python'), 'lang-python.js')
  assert.equal(langAssetName('csharp'), 'lang-csharp.js')
})
