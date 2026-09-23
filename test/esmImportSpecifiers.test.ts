/**
 * 动态 `import()` 的说明符必须两端都认（#235，2026-09-23）。
 *
 * 为什么单独立一条判据：把绝对路径（Windows 上长成 `D:\a\dsh-one\…`）直接喂给
 * `import()`，ESM loader 会把它当成**协议**，报
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME: … Received protocol 'd:'`——整个测试文件在
 * windows-latest 上一条都跑不了（2026-09-22 的 CI：6 个单测文件 + scratchDirs 的
 * 子进程片段就是这么红的，而且是**文件级**失败，看不出跟哪条断言有关）。
 *
 * 口径：绝对路径一律经 `pathToFileURL(...).href`（或 `new URL(…, import.meta.url)`）；
 * `./`、`../`、`file:`、`node:`、`data:` 与裸包名本来就是跨平台的说明符，照旧。
 *
 * 扫描面是**源码文本**（不是模块图）：注释先按仓库既有的状态机剥掉（复用
 * scripts/platformCompatScan.mjs，与平台兼容性门禁同一套），模板串里的代码照扫——
 * `test/scratchDirs.test.ts` 里那段丢给子进程的 `-e` 代码就是靠这个被看见的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.join(import.meta.dirname, '..')
/** 本文件（判据本体）：仓库扫描时排掉，理由见最后一条用例。 */
const SELF = 'test/esmImportSpecifiers.test.ts'
const SCAN_DIRS: readonly string[] = ['test', 'scripts', 'src']
const SOURCE_RE = /\.(?:[cm]?[jt]s|tsx)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'out-empty', '.build-mock-llm'])

const { stripFileComments } = (await import(pathToFileURL(path.join(ROOT, 'scripts', 'platformCompatScan.mjs')).href)) as {
  stripFileComments(text: string): string
}

/** 一处可疑的动态 import：文件、行号、实参原文。 */
interface Offense {
  file: string
  line: number
  arg: string
}

/**
 * 实参能不能跨平台：说得清是 URL / 相对说明符 / 裸包名就算过；是**绝对路径**（POSIX
 * 的 `/x` 或 Windows 的 `D:\x`），或者是个**变量**（说不清里面装的是什么），一律不过。
 */
function specifierIsPortable(arg: string): boolean {
  const text = arg.trim()
  if (text.includes('pathToFileURL') || text.includes('new URL(')) return true
  const literal = /^(['"])([\s\S]*)\1$/.exec(text)?.[2]
  if (literal === undefined) return false
  if (literal.startsWith('/')) return false
  if (/^[A-Za-z]:[\\/]/.test(literal)) return false
  return true
}

/**
 * 逐个找 `import(` 的实参（按括号配对取整段，允许跨行）。字符串里出现不配对的括号
 * 会被数错——那种写法在本仓不存在，真出现时这条判据会先红、由人看着改。
 */
function dynamicImportArgs(source: string): Array<{ index: number; arg: string }> {
  const found: Array<{ index: number; arg: string }> = []
  const re = /(?:^|[^\w$.])import\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let i = open
    for (; i < source.length; i++) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push({ index: open, arg: source.slice(open + 1, i) })
  }
  return found
}

/** 一份源码里的违规点（注释已剥、行号按原文件）。 */
function offensesIn(file: string, source: string): Offense[] {
  const code = stripFileComments(source)
  const out: Offense[] = []
  for (const { index, arg } of dynamicImportArgs(code)) {
    if (specifierIsPortable(arg)) continue
    out.push({ file, line: source.slice(0, index).split('\n').length, arg: arg.trim().replace(/\s+/g, ' ') })
  }
  return out
}

/** 扫全仓（test / scripts / src）的每个源码文件。 */
function eachRepoSource(visit: (rel: string, source: string) => void): void {
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full)
        continue
      }
      if (!SOURCE_RE.test(entry.name)) continue
      visit(path.relative(ROOT, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'))
    }
  }
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir))
}

test('判据本身：绝对路径被认出、跨平台写法放行（正负对照）', () => {
  // 放行：file:// URL、相对路径、协议、裸包名
  assert.equal(specifierIsPortable("pathToFileURL(path.join(ROOT, 'x.mjs')).href"), true)
  assert.equal(specifierIsPortable("new URL('./x.ts', import.meta.url).href"), true)
  assert.equal(specifierIsPortable("'./x.ts'"), true)
  assert.equal(specifierIsPortable("'../src/log.ts'"), true)
  assert.equal(specifierIsPortable("'node:fs'"), true)
  assert.equal(specifierIsPortable("'some-package/client'"), true)
  // 拦下：它就是 2026-09-22 那批红的原因
  assert.equal(specifierIsPortable("path.join(ROOT, 'scripts', 'x.mjs')"), false)
  assert.equal(specifierIsPortable("process.env.DSH_SCRATCH_MODULE"), false)
  assert.equal(specifierIsPortable("'/Users/me/x.ts'"), false)
  assert.equal(specifierIsPortable("'D:\\\\a\\\\dsh-one\\\\test\\\\x.ts'"), false)
})

test('判据能抓到旧写法，且注释里的举例不算（负向对照）', () => {
  const before = `
    // 反例：import(path.join(ROOT, 'scripts', 'x.mjs')) —— 注释里的举例不算
    const mod = await import(path.join(ROOT, 'scripts', 'x.mjs'))
  `
  assert.deepEqual(offensesIn('fake.test.ts', before), [
    { file: 'fake.test.ts', line: 3, arg: "path.join(ROOT, 'scripts', 'x.mjs')" },
  ])
  const after = `const mod = await import(pathToFileURL(path.join(ROOT, 'scripts', 'x.mjs')).href)\n`
  assert.deepEqual(offensesIn('fake.test.ts', after), [])
})

test('仓库里的动态 import 一律走跨平台说明符', () => {
  const offenses: Offense[] = []
  let detected = 0
  eachRepoSource((file, source) => {
    // 本文件自己不在扫描面里：上面那条负向对照必须把反例原文（`import(path.join(…))`）
    // 写进字符串，扫描器按设计也扫字符串里的代码（scratchDirs 的子进程片段正是这么
    // 被看见的），不排掉就成了自指。判据本体只有几十行，这一段由上面的对照用例兜。
    if (file === SELF) return
    const code = stripFileComments(source)
    detected += dynamicImportArgs(code).length
    offenses.push(...offensesIn(file, source))
  })
  // 先确认判据不是「什么都没扫到所以全过」：本仓的动态 import 有两位数。
  assert.ok(detected >= 10, `只扫到 ${String(detected)} 处动态 import，扫描面或抽取逻辑像是坏了`)
  assert.deepEqual(
    offenses,
    [],
    `这些地方把绝对路径/变量直接喂给了 import()，Windows 上整个文件报 ERR_UNSUPPORTED_ESM_URL_SCHEME：\n${offenses
      .map((o) => `  ${o.file}:${String(o.line)} → import(${o.arg})`)
      .join('\n')}\n改成 import(pathToFileURL(<绝对路径>).href)。`,
  )
})
