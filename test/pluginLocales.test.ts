/**
 * 插件词典一致性（#65 返修 8）：装配线各插件用 cordis locale 注册自有词典，
 * 少写一个语言的键就会让界面在那种语言下回退成另一种语言的文案（实测踩过：
 * 菜单「已复制」只写了 en，中文界面显示 Copied）。这里直接扫源码里的
 * `locale.register('<ns>', { zh: {...}, en: {...} })` 块（#202 起也认「词典抽成模块级
 * 常量、再 `locale.register('<ns>', DICT)` 交给注册」那种写法），逐命名空间比对键集。
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

/**
 * 从 `{` 开始做一次大括号配对，取这个对象字面量的源码（含首尾括号）。
 *
 * 为什么需要它（#202）：`zh: {…}` / `en: {…}` 各自都是一个对象字面量，正则取
 * 「到下一个行首 `}`」在**只有一层嵌套**时够用，但外层还有个 `export const X = { … }`，
 * 这时要拿到「这个 const 自己的那块」就必须配对括号。跳过引号串里的括号（词典的
 * 值就是 `'…'` 串，串里的 `{n}` 这类占位会破坏计数）。
 */
function objectLiteralAt(text: string, open: number): string | undefined {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"') {
      const quote = ch
      i += 1
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1
        i += 1
      }
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return undefined
}

/** 一份 `{ zh: {…}, en: {…} }` 的两份键集；不是这个形状时返回 undefined。 */
function dictKeysOf(body: string | undefined): { zh: string[]; en: string[] } | undefined {
  if (body === undefined) return undefined
  const zhAt = body.indexOf('zh:')
  const enAt = body.indexOf('en:')
  if (zhAt < 0 || enAt < 0) return undefined
  const zh = objectLiteralAt(body, body.indexOf('{', zhAt))
  const en = objectLiteralAt(body, body.indexOf('{', enAt))
  if (zh === undefined || en === undefined) return undefined
  return { zh: keySetOf(zh), en: keySetOf(en) }
}

/**
 * 仓库相对路径、分隔符统一成 `/`：Windows 上 `path.relative` 给的是 `packages\…`，
 * 而下面的判据按 `packages/` 前缀认插件包——2026-09-22 windows-latest 上就是
 * 因为分隔符不同把「插件包里的词典块没进扫描面」误报成红的。
 */
function repoRel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

/** 每个源码根下的顶层 `.ts` 文件（与搬家前的扫法一致：不递归进子目录）。 */
function sourceFiles(): Array<{ label: string; full: string }> {
  const files: Array<{ label: string; full: string }> = []
  for (const dir of SRC_DIRS) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.ts')) continue
      const full = path.join(dir, name)
      files.push({ label: repoRel(full), full })
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
    // 另一种写法：词典抽成模块级常量、**同一个文件里**用 `locale.register('ns', DICT)`
    // 按引用交给注册（`packages/dsh-workspace-tree/src/workspaceTreePlugin.ts` 就是这一形）。
    // 为什么要支持它（#202）：浏览器验证的套件要拿**同一份值**断言页面上的文案
    // （写死中文会得到「换台机器就红」的假失败，见 harness 的 `texts()`），chat 树
    // frame 的词典因此从 register 的内联字面量变成了 `shellLocale.ts` 这个纯数据模块，
    // 而它**不在同一个文件里**——所以下面除了认「同文件的按引用注册」，还认
    // 「同一个扫描面里的纯词典模块」（`src/ui/assembly/shell/*.ts` 下的 `*.ts`）：
    // 只要那个文件里有一份 `{ zh: {…}, en: {…} }` 形状的模块级常量就算一份词典。
    // 判据（zh/en 键必须一致）一个字不放宽，只是多认两种写法。
    //
    // 认法：找 `const <名> = {`（允许 `const X: Dict = {` 这种类型标注），用括号配对
    // 取出这个对象字面量本身，只有在**它自己里面**同时有 `zh: {` 与 `en: {` 时才算
    // 词典（否则文件里别处的 zh:/en: 会被误配成一份词典，实测踩过）。
    for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*\{/g)) {
      const open = text.indexOf('{', m.index + m[0].length - 1)
      const keys = dictKeysOf(objectLiteralAt(text, open))
      if (keys === undefined) continue
      blocks.push({ file: label, ns: m[1], zh: keys.zh, en: keys.en })
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
