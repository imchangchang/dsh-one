/**
 * 面板标签页接线的静态判据（#212）。
 *
 * 为什么是静态扫描而不是跑起来断言：`panel.title` / `panel.iconPath` 都生在 VS Code
 * 宿主里，实验室（浏览器）看不到，真窗验收又只能人做。所以这里直接读源码钉住三件事：
 *
 * 1. **每一处 `createWebviewPanel` 的标题都过共用格式化函数**（`chatTitle` /
 *    `panelTabTitle`）——不许再出现各写各的（旧写法就是这里冒出 `dsh: session-47…`）；
 * 2. **标题实参里不许出现 id 片段形态与内部词**（`slice(` / `(assembled)` / `（装配）`）；
 * 3. **建出来的面板都挂了图标**，外加恢复路径（serializer 交回来的空壳）在
 *    `mountChatPanel` 里重挂一次。
 *
 * 新增一个面板却忘了标题口径或图标 → 这里红，不用等有人开窗看见 VS Code 的默认图标。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PANEL_TAB_ICON_PATH } from '../src/pure/panelTab.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** 建 webview 面板的两个源文件（`createWebviewPanel` 全仓只在它们里）。 */
const PANEL_SOURCES = [path.join('src', 'ui', 'assemblyView.ts'), path.join('src', 'ui', 'installGuide.ts')]

/** 标题必须来自共用口径，不许在这里另拼字符串。 */
const SHARED_TITLE_CALL = /\b(?:chatTitle|panelTabTitle|chatPanelTabTitle)\(/

/** 装面板时紧跟着挂图标的那一行。 */
const ICON_ASSIGNMENT = 'panel.iconPath = panelTabIconPath('

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

/** 跳过一段字符串 / 模板串，返回结束引号的下标。 */
function skipString(source: string, start: number): number {
  const quote = source[start]
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === quote) return i
  }
  return source.length - 1
}

/** 与 `source[open]` 那个 `(` 配对的下标（跳过字符串与注释，避免它们里面的括号搅局）。 */
function matchingParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i)
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const lineEnd = source.indexOf('\n', i)
      if (lineEnd === -1) return -1
      i = lineEnd
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const blockEnd = source.indexOf('*/', i + 2)
      if (blockEnd === -1) return -1
      i = blockEnd + 1
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 把实参表按顶层逗号切开（嵌套的括号 / 方括号 / 花括号与字符串都不切）。 */
function splitTopLevel(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(args, i)
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i))
      start = i + 1
    }
  }
  parts.push(args.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

interface PanelCall {
  file: string
  /** 调用表达式的原文（`createWebviewPanel(...)` 整段）。 */
  text: string
  /** 顶层实参：viewType / title / viewColumn / options。 */
  args: string[]
  /** 调用点在文件里的下标（用来找它属于哪个函数）。 */
  at: number
}

function panelCalls(relative: string): PanelCall[] {
  const source = read(relative)
  const needle = 'createWebviewPanel('
  const calls: PanelCall[] = []
  let from = 0
  for (;;) {
    const at = source.indexOf(needle, from)
    if (at === -1) break
    const open = at + needle.length - 1
    const close = matchingParen(source, open)
    assert.notEqual(close, -1, `${relative}: ${needle} 的括号没配平（静态扫描解析不了）`)
    calls.push({ file: relative, text: source.slice(at, close + 1), args: splitTopLevel(source.slice(open + 1, close)), at })
    from = close + 1
  }
  return calls
}

/** 声明了 `function <name>` 的位置（顶格，含 `export` / `async` 前缀）。 */
function functionStarts(source: string): Array<{ name: string; at: number }> {
  return [...source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].map((m) => ({ name: m[1], at: m.index }))
}

/** 调用点所属函数的函数体（从该函数声明到下一个函数声明之间）。 */
function enclosingFunction(source: string, callAt: number): string {
  const starts = functionStarts(source)
  let current = starts[0]
  let next: { at: number } | undefined
  for (let i = 0; i < starts.length; i++) {
    if (starts[i].at > callAt) {
      next = starts[i]
      break
    }
    current = starts[i]
  }
  assert.ok(current !== undefined, '调用点之前没有函数声明（静态扫描解析不了）')
  return source.slice(current.at, next?.at ?? source.length)
}

/** 指定函数的函数体（找不到就是函数没了，直接失败）。 */
function functionBody(relative: string, name: string): string {
  const source = read(relative)
  const starts = functionStarts(source)
  const index = starts.findIndex((entry) => entry.name === name)
  assert.notEqual(index, -1, `${relative}: 找不到函数 ${name}`)
  return source.slice(starts[index].at, starts[index + 1]?.at ?? source.length)
}

test('每一处 createWebviewPanel 的标题都过共用格式化函数', () => {
  let sites = 0
  for (const file of PANEL_SOURCES) {
    for (const call of panelCalls(file)) {
      sites++
      assert.ok(call.args.length >= 4, `${file}: 这条 createWebviewPanel 少了实参：${call.text}`)
      assert.match(
        call.args[1],
        SHARED_TITLE_CALL,
        `${file}: 标题没有走共用口径（chatTitle / panelTabTitle）：${call.args[1]}`,
      )
    }
  }
  // 数值本身不重要，重要的是「扫到的站点数与预期一致」——站点被删了也要有人看一眼
  assert.equal(sites, 4, `期望 4 处建面板（对话单例 / 对话多开 / 设置 / 安装引导），实到 ${sites} 处`)
})

test('标题实参里不再有 id 片段与内部词', () => {
  for (const file of PANEL_SOURCES) {
    for (const call of panelCalls(file)) {
      const title = call.args[1]
      assert.doesNotMatch(title, /\.slice\(/, `${file}: 标题里出现了 id 片段：${title}`)
      assert.doesNotMatch(title, /\(assembled\)|（装配）/i, `${file}: 标题里出现了内部词：${title}`)
      assert.doesNotMatch(title, /`dsh: /, `${file}: 标题还在用旧的冒号写法：${title}`)
    }
  }
})

test('建面板的地方都挂上了图标', () => {
  for (const file of PANEL_SOURCES) {
    const source = read(file)
    const calls = panelCalls(file)
    const iconAssignments = source.split(ICON_ASSIGNMENT).length - 1
    assert.ok(
      iconAssignments >= calls.length,
      `${file}: ${calls.length} 处建面板只有 ${iconAssignments} 处挂了图标（缺的那处会用 VS Code 默认图标）`,
    )
    for (const call of calls) {
      assert.ok(
        enclosingFunction(source, call.at).includes(ICON_ASSIGNMENT),
        `${file}: 这处建面板的所属函数里没挂图标：${call.text.slice(0, 60)}…`,
      )
    }
  }
})

test('恢复出来的面板在 mountChatPanel 里重挂标题与图标（serializer 交回来的是空壳）', () => {
  const body = functionBody(path.join('src', 'ui', 'assemblyView.ts'), 'mountChatPanel')
  assert.ok(body.includes('panel.title = chatTitle()'), 'mountChatPanel 里没有按共用口径标名')
  assert.ok(body.includes(ICON_ASSIGNMENT), 'mountChatPanel 里没有重挂图标')
})

test('两份 l10n bundle 里不再有「（装配）」这类标题 key', () => {
  for (const file of ['l10n/bundle.l10n.json', 'l10n/bundle.l10n.zh-cn.json']) {
    const bundle = JSON.parse(read(file)) as Record<string, string>
    for (const [key, value] of Object.entries(bundle)) {
      assert.doesNotMatch(key, /\(assembled\)|（装配）/, `${file}: 残留旧 key「${key}」`)
      assert.doesNotMatch(value, /\(assembled\)|（装配）/, `${file}: 「${key}」的译文残留内部词「${value}」`)
    }
    // 三处面板标题用到的主体串，两种语言都要在（少一个就会退回英文/显示 key）
    for (const key of ['Chat', 'Settings', 'Install dsh']) {
      assert.ok(key in bundle, `${file}: 缺少面板标题用的串「${key}」`)
    }
  }
})

test('图标是真资源、与扩展图标同一份，且不会被 .vscodeignore 排除', () => {
  const iconAbs = path.join(ROOT, PANEL_TAB_ICON_PATH)
  assert.ok(fs.existsSync(iconAbs), `图标文件不在：${PANEL_TAB_ICON_PATH}`)

  const pkg = JSON.parse(read('package.json')) as { icon?: string }
  assert.equal(pkg.icon, PANEL_TAB_ICON_PATH, '扩展图标与面板图标不再指向同一份资源')

  const lines = read('.vscodeignore').split('\n').map((line) => line.trim())
  const excluding = lines.filter((line) => line !== '' && !line.startsWith('#') && line.startsWith('assets'))
  assert.deepEqual(excluding, [], `.vscodeignore 排除了 assets/（图标进不了 vsix）：${excluding.join(', ')}`)
})
