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

const ROOT = path.join(import.meta.dirname, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

/**
 * 扫哪些目录：VS Code 专用插件的源码（`src/ui/assembly/shell/`）+ **每个插件包**的
 * 源码（`packages/<名>/src/`，判定同 pluginPackages.test.ts：声明了 `dsh.client` 的
 * 才算插件包）。#94 把可移植插件的本体搬进了各自包里，只扫 shell 目录的话那几件
 * 从此不再被下面两条断言覆盖（词典少写一个语言会静默回退，正是本条要防的）。
 */
const SRC_DIRS: readonly string[] = [
  path.join(ROOT, 'src', 'ui', 'assembly', 'shell'),
  ...fs
    .readdirSync(PACKAGES_DIR)
    .sort()
    .map((name) => path.join(PACKAGES_DIR, name))
    .filter((dir) => {
      const manifest = path.join(dir, 'package.json')
      if (!fs.existsSync(manifest)) return false
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { dsh?: { client?: unknown } }
      return parsed.dsh?.client !== undefined
    })
    .map((dir) => path.join(dir, 'src')),
]

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

/** 每个源码根下的顶层 `.ts` 文件（与搬家前的扫法一致：不递归进子目录）。 */
function sourceFiles(): Array<{ label: string; full: string }> {
  const files: Array<{ label: string; full: string }> = []
  for (const dir of SRC_DIRS) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.ts')) continue
      const full = path.join(dir, name)
      files.push({ label: path.relative(ROOT, full), full })
    }
  }
  return files
}

function collectLocaleBlocks(): LocaleBlock[] {
  const blocks: LocaleBlock[] = []
  for (const { label, full } of sourceFiles()) {
    const text = fs.readFileSync(full, 'utf8')
    for (const m of text.matchAll(/locale\.register\(\s*'([^']+)',\s*\{([\s\S]*?)\n\s*\}\)/g)) {
      const zh = /zh:\s*\{([\s\S]*?)\n?\s*\}/.exec(m[2])?.[1] ?? ''
      const en = /en:\s*\{([\s\S]*?)\n?\s*\}/.exec(m[2])?.[1] ?? ''
      blocks.push({ file: label, ns: m[1], zh: keySetOf(zh), en: keySetOf(en) })
    }
  }
  return blocks
}

test('装配插件词典：每个命名空间的 zh/en 键完全一致', () => {
  const blocks = collectLocaleBlocks()
  assert.ok(blocks.length >= 6, `应至少扫到 6 个词典块，实际 ${String(blocks.length)}`)
  assert.ok(
    blocks.some((block) => block.file.startsWith('packages/')),
    '插件包（packages/*）里的词典块必须也在扫描面里（#94 搬家后仍要覆盖）',
  )
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
  for (const { label, full } of sourceFiles()) {
    const text = fs.readFileSync(full, 'utf8')
    for (const m of text.matchAll(/(?:zh|en):\s*\{([\s\S]*?)\n?\s*\}/g)) {
      for (const kv of m[1].matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*:\s*(['"])(.*?)\2/g)) {
        assert.notEqual(kv[3], '', `${label} 的 ${kv[1]} 值为空`)
      }
    }
  }
})
