/**
 * 插件词典一致性（#65 返修 8）：装配线各插件用 cordis locale 注册自有词典，
 * 少写一个语言的键就会让界面在那种语言下回退成另一种语言的文案（实测踩过：
 * 菜单「已复制」只写了 en，中文界面显示 Copied）。这里直接扫源码里的
 * `locale.register('<ns>', { zh: {...}, en: {...} })` 块，逐命名空间比对键集。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SHELL_DIR = path.join(import.meta.dirname, '..', 'src', 'ui', 'assembly', 'shell')

/** 一个 locale.register 块：命名空间 + 两个语言的键集。 */
interface LocaleBlock {
  file: string
  ns: string
  zh: string[]
  en: string[]
}

function keySetOf(block: string): string[] {
  // 键名形如 `foo:` 或 `fooBar:`（值可以是普通串或 '{count} …' 这类插值串）
  return [...block.matchAll(/(?:^|[\s,{])([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1])
}

function collectLocaleBlocks(): LocaleBlock[] {
  const blocks: LocaleBlock[] = []
  for (const file of fs.readdirSync(SHELL_DIR)) {
    if (!file.endsWith('.ts')) continue
    const text = fs.readFileSync(path.join(SHELL_DIR, file), 'utf8')
    for (const m of text.matchAll(/locale\.register\(\s*'([^']+)',\s*\{([\s\S]*?)\n\s*\}\)/g)) {
      const zh = /zh:\s*\{([\s\S]*?)\n?\s*\}/.exec(m[2])?.[1] ?? ''
      const en = /en:\s*\{([\s\S]*?)\n?\s*\}/.exec(m[2])?.[1] ?? ''
      blocks.push({ file, ns: m[1], zh: keySetOf(zh), en: keySetOf(en) })
    }
  }
  return blocks
}

test('装配插件词典：每个命名空间的 zh/en 键完全一致', () => {
  const blocks = collectLocaleBlocks()
  assert.ok(blocks.length >= 6, `应至少扫到 6 个词典块，实际 ${String(blocks.length)}`)
  for (const block of blocks) {
    const onlyZh = block.zh.filter((k) => !block.en.includes(k))
    const onlyEn = block.en.filter((k) => !block.zh.includes(k))
    assert.deepEqual(
      { file: block.file, ns: block.ns, onlyZh, onlyEn },
      { file: block.file, ns: block.ns, onlyZh: [], onlyEn: [] },
    )
  }
})

test('装配插件词典：值非空（漏填 = 界面露出空文案）', () => {
  for (const file of fs.readdirSync(SHELL_DIR)) {
    if (!file.endsWith('.ts')) continue
    const text = fs.readFileSync(path.join(SHELL_DIR, file), 'utf8')
    for (const m of text.matchAll(/(?:zh|en):\s*\{([\s\S]*?)\n?\s*\}/g)) {
      for (const kv of m[1].matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*:\s*(['"])(.*?)\2/g)) {
        assert.notEqual(kv[3], '', `${file} 的 ${kv[1]} 值为空`)
      }
    }
  }
})
