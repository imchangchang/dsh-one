import assert from 'node:assert/strict'
import { test } from 'node:test'
import { atTokenRangeAt, boundTokenRanges, scanAtTokens, scanCommandTokens, shouldColorAtToken, shouldColorSlashToken } from '../src/pure/tokenScan.ts'

const range = (start: number, end: number, quoted = false) => ({ start, end, quoted })
const labels = (text: string) => scanAtTokens(text).map((r) => text.slice(r.start, r.end))

test('触发边界：行首/空白/中文标点/常见 ASCII 标点/中文开括号', () => {
  // 行首、空白、中文句读、ASCII ,;!? 都触发；`.` 不是边界（@d 不触发）
  assert.deepEqual(labels('@a 和 b,@c.@d;@e!@f?'), ['@a', '@c', '@e', '@f'])
  assert.deepEqual(labels('，@a。@b；@c：@d、@e 尾'), ['@a', '@b', '@c', '@d', '@e'])
  // 新增：中文开括号（「『《〔【 触发
  assert.deepEqual(labels('（@a「@b『@c《@d〔@e【@f 结尾'), ['@a', '@b', '@c', '@d', '@e', '@f'])
})

test('触发边界：ASCII ( 与汉字/字母/点后的 @ 不触发（词中/邮箱/代码装饰器）', () => {
  assert.deepEqual(labels('func(@arg) 看@img a@b.com foo.a@b'), [])
  // 全角括号（ 是边界：@ 前是（ 时触发
  assert.deepEqual(labels('（@img1）'), ['@img1'])
})

test('终止：空白/全角标点/\p{So}/ASCII ;!?: 无条件终止', () => {
  assert.deepEqual(labels('@a b'), ['@a'])
  assert.deepEqual(labels('@a，b'), ['@a'])
  assert.deepEqual(labels('@a。b'), ['@a'])
  assert.deepEqual(labels('@a；b'), ['@a'])
  assert.deepEqual(labels('@a！b'), ['@a'])
  assert.deepEqual(labels('@a？b'), ['@a'])
  assert.deepEqual(labels('@a：b'), ['@a'])
  // 全角句点 ．/半角中点 ･（U+00B7 · 不在终止集，保留）
  assert.deepEqual(labels('@a．b'), ['@a'])
  assert.deepEqual(labels('@a･b'), ['@a'])
  assert.deepEqual(labels('@a·b'), ['@a·b'])
  // emoji（\p{So}）终止
  assert.deepEqual(labels('@a😀b'), ['@a'])
  assert.deepEqual(labels('@a®b'), ['@a'])
  // ASCII ;!?: 终止
  assert.deepEqual(labels('@a;b'), ['@a'])
  assert.deepEqual(labels('@a!b'), ['@a'])
  assert.deepEqual(labels('@a?b'), ['@a'])
  assert.deepEqual(labels('@a:b'), ['@a'])
})

test('终止：./ 仅后跟续接字符时保持，否则条件终止', () => {
  assert.deepEqual(labels('@a.txt'), ['@a.txt'])
  assert.deepEqual(labels('@a.b.c'), ['@a.b.c'])
  assert.deepEqual(labels('@a.txt,后面'), ['@a.txt'])
  assert.deepEqual(labels('@a.txt.后面'), ['@a.txt'])
  assert.deepEqual(labels('@a/x-y_1.json~tmp'), ['@a/x-y_1.json~tmp'])
  // 非续接字符：空格/汉字/emoji/终止符
  assert.deepEqual(labels('@a.txt 后面'), ['@a.txt'])
  assert.deepEqual(labels('@a.jpg；'), ['@a.jpg'])
})

test('终止：) / ）有配对开括号不终止，否则终止（平衡规则）', () => {
  assert.deepEqual(labels('@img2）'), ['@img2'])
  assert.deepEqual(labels('@img2)'), ['@img2'])
  assert.deepEqual(labels('@a(1).jpg'), ['@a(1).jpg'])
  assert.deepEqual(labels('@a（说明）'), ['@a（说明）'])
  assert.deepEqual(labels('@（说明）.docx'), ['@（说明）.docx'])
})

test('其余 ASCII 标点保持 token 字符', () => {
  assert.deepEqual(labels("@a'b#c&d+e%f$g@h*i<j>k|l\"m\\n[o]"), ["@a'b#c&d+e%f$g@h*i<j>k|l\"m\\n[o]"])
})

test('quoted 分支：闭合引号成 token，未闭合/空内容回落 plain', () => {
  assert.deepEqual(labels('@"my file.txt"'), ['@"my file.txt"'])
  assert.deepEqual(labels('@"src/ 下面'), ['@"src/'])
  assert.deepEqual(labels('@""'), ['@""']) // 空内容回落 plain（`"` 是普通 token 字符）
  assert.deepEqual(labels('@"my file.txt" 后'), ['@"my file.txt"'])
  // 换行前未闭合 → 回落 plain（止于换行/空白）
  assert.deepEqual(labels('@"a\nb'), ['@"a'])
  assert.deepEqual(atTokenRangeAt('@"my file.txt"', 0), range(0, 14, true))
  assert.deepEqual(atTokenRangeAt('@"src/', 0), range(0, 6, false))
})

test('扫描不重叠：token 内部的 @ 不重复触发', () => {
  assert.deepEqual(labels('@a@b'), ['@a@b']) // @ 是 token 字符
  assert.deepEqual(labels('@a（@b）'), ['@a（@b）'])
})

test('boundTokenRanges：扫描起点按 key 最长匹配', () => {
  const bindings = new Map([
    ['@A', 'm-a'],
    ['@A B', 'm-ab'],
  ])
  // 长 key 先命中（@A B 不会被 @A 抢先）
  assert.deepEqual(boundTokenRanges('问 @A B 和 @A，再来 @A B 和 @A2', bindings).map((r) => [r.start, r.end]), [
    [2, 6],
    [9, 11],
    [15, 19],
  ])
  // @A2：最长 key 后紧跟续接字符（2）→ 视为手动改动过的 token，该 key 不命中
  assert.equal(boundTokenRanges('@A2', bindings).length, 0)
  // @A B2：`@A B` 后跟续接字符不命中，但回退到更短的 `@A`（其后是空白，按
  // 渲染侧规则 `@A` 是完整 token）
  assert.deepEqual(boundTokenRanges('@A B2', bindings).map((r) => [r.start, r.end]), [[0, 2]])
})

test('boundTokenRanges：词中 @ 不命中（a@img b 自然排除）', () => {
  const bindings = new Map([['@img', 'm-img']])
  assert.deepEqual(boundTokenRanges('a@img b', bindings), [])
  assert.deepEqual(boundTokenRanges('看@img', bindings), [])
  assert.deepEqual(boundTokenRanges('a@b.com', bindings), [])
  assert.deepEqual(boundTokenRanges('@img b', bindings), [range(0, 4)])
})

test('boundTokenRanges：含空格显示 token 与引号 token 命中', () => {
  const bindings = new Map([
    ['@with space.txt', 'm-1'],
    ['@"q.txt"', 'm-2'],
  ])
  assert.deepEqual(boundTokenRanges('看 @with space.txt 和 @"q.txt"', bindings), [
    range(2, 17),
    range(20, 28, true),
  ])
})

test('boundTokenRanges：无绑定/无 @ token 时为空', () => {
  assert.deepEqual(boundTokenRanges('@x', new Map()), [])
  assert.deepEqual(boundTokenRanges('普通文本', new Map([['@x', 'm']])), [])
})

test('shouldColorAtToken：引号收紧尾/ + @name 词库门控', () => {
  const names = new Set(['img1.png', '旧会话', 'src'])
  // 引号无尾/：不着色（官方 FOLDER_REF_RE 引号分支须尾 / 才着色）
  assert.equal(shouldColorAtToken('@"my file.txt"', true, names), false)
  assert.equal(shouldColorAtToken('@"非目录"', true, names), false)
  // 引号带尾/（文件夹）与无引号尾/：按语法着色
  assert.equal(shouldColorAtToken('@"src/', true, names), true)
  assert.equal(shouldColorAtToken('@src/', false, names), true)
  // 引号闭合且尾/在引号内（`@"dir/"`）：dsh 目录引用引号保持敞开（`@"path/`），
  // 尾/ 不在 token 末位，按引号无尾/ 处理——不着色
  assert.equal(shouldColorAtToken('@"dir/"', true, names), false)
  // 已知 name：在候选里 → 着色
  assert.equal(shouldColorAtToken('@img1.png', false, names), true)
  assert.equal(shouldColorAtToken('@旧会话', false, names), true)
  // 未知名/半截名：不在候选里 → 不着色（保持纯文本，官方 TEXT_REF_RE 词库门控）
  assert.equal(shouldColorAtToken('@img', false, names), false)
  assert.equal(shouldColorAtToken('@nonexistent', false, names), false)
  assert.equal(shouldColorAtToken('@img1', false, names), false)
  // 无候选时所有 @name 与无尾/引号都不着色（尾/文件夹仍按语法着色）
  const empty = new Set<string>()
  assert.equal(shouldColorAtToken('@img1.png', false, empty), false)
  assert.equal(shouldColorAtToken('@src/', false, empty), true)
  assert.equal(shouldColorAtToken('@"x"', true, empty), false)
})

test('scanCommandTokens：/command 触发（行首/常见标点），区间含 /', () => {
  const labels = (text: string) => scanCommandTokens(text).map((r) => text.slice(r.start, r.end))
  // 行首触发
  assert.deepEqual(labels('/plan'), ['/plan'])
  assert.deepEqual(labels('/compact 看'), ['/compact'])
  // 边界字符后触发（空白/中文标点/ASCII 标点）
  assert.deepEqual(labels('看 /compact'), ['/compact'])
  assert.deepEqual(labels('啊，/goal'), ['/goal'])
  assert.deepEqual(labels('等一下;/model'), ['/model'])
  // 词中的 / 不触发（汉字/字母直接前导——不是边界字符）
  assert.deepEqual(labels('看/plan'), [])
  assert.deepEqual(labels('x/plan'), [])
  assert.deepEqual(labels('a^/plan'), []); // `^` 不在边界集
  // 多个命中按出现顺序，不重叠
  assert.deepEqual(labels('/plan /compact'), ['/plan', '/compact'])
  // 纯数据：start/end 精确
  assert.deepEqual(scanCommandTokens('看 /compact'), [{ start: 2, end: 10 }])
})

test('shouldColorSlashToken：/command 按 skill 名门控', () => {
  const skills = new Set(['plan', 'compact', 'model'])
  // 已知 skill/slash 命令名 → 着色
  assert.equal(shouldColorSlashToken('/plan', skills), true)
  assert.equal(shouldColorSlashToken('/compact', skills), true)
  assert.equal(shouldColorSlashToken('/model', skills), true)
  // 未知名/URL 路径 → 不着色（保持纯文本）
  assert.equal(shouldColorSlashToken('/foo', skills), false)
  assert.equal(shouldColorSlashToken('/Users', skills), false)
  // 无候选时全不着色
  assert.equal(shouldColorSlashToken('/plan', new Set<string>()), false)
})
