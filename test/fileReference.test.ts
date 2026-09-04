import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeAtToken, arrowNavPosition, fileMentionToken, formatFileMention, restoreFileMentionTokens, tokenDeletion } from '../src/pure/fileReference.ts'

test('activeAtToken：行首与空白后的 @query 触发，query 允许 / 与 @', () => {
  assert.deepEqual(activeAtToken('@rea'), { prefix: '@rea', query: 'rea', quoted: false })
  assert.deepEqual(activeAtToken('看看 @src/ut'), { prefix: '@src/ut', query: 'src/ut', quoted: false })
  assert.deepEqual(activeAtToken('a\n@x'), { prefix: '@x', query: 'x', quoted: false })
})

test('activeAtToken：邮箱等 token 内部的 @ 不触发', () => {
  assert.equal(activeAtToken('mail a@b'), undefined)
  assert.equal(activeAtToken(''), undefined)
  assert.equal(activeAtToken('没有 at'), undefined)
})

test('activeAtToken：未闭合引号 token 标记 quoted；闭合引号回落为 plain（与官方一致）', () => {
  assert.deepEqual(activeAtToken('@"path with'), { prefix: '@"path with', query: 'path with', quoted: true })
  assert.deepEqual(activeAtToken('x @"dir/'), { prefix: '@"dir/', query: 'dir/', quoted: true })
  // 官方行为：quoted 正则不匹配闭合引号，plain 正则把整个 @"closed" 当普通 token。
  assert.deepEqual(activeAtToken('@"closed"'), { prefix: '@"closed"', query: '"closed"', quoted: false })
})

test('formatFileMention：普通路径裸写，目录补尾部斜杠', () => {
  assert.equal(formatFileMention({ path: 'README.md', kind: 'file' }), '@README.md')
  assert.equal(formatFileMention({ path: 'src/ui', kind: 'directory' }), '@src/ui/')
})

test('formatFileMention：含空白走引号语法，目录保持引号敞开以下钻', () => {
  assert.equal(formatFileMention({ path: 'a b.txt', kind: 'file' }), '@"a b.txt"')
  assert.equal(formatFileMention({ path: 'my dir', kind: 'directory' }), '@"my dir/')
})

test('formatFileMention：preserveQuote 保留显式打开的引号', () => {
  assert.equal(formatFileMention({ path: 'a.txt', kind: 'file' }, true), '@"a.txt"')
  assert.equal(formatFileMention({ path: 'src', kind: 'directory' }, true), '@"src/')
})

test('formatFileMention：控制字符与内嵌引号无法安全表示', () => {
  assert.equal(formatFileMention({ path: 'a"b.txt', kind: 'file' }), undefined)
  assert.equal(formatFileMention({ path: 'a\tb.txt', kind: 'file' }), undefined)
})

test('fileMentionToken：首选 @短名，冲突时追加序号直到唯一', () => {
  const bindings = new Map<string, string>()
  const first = fileMentionToken('截图.png', '@/a/截图.png', bindings)
  assert.equal(first, '@截图.png')
  bindings.set(first, '@/a/截图.png')
  // 同名被别的绑定占用（不同 mention）→ 序号递增
  assert.equal(fileMentionToken('截图.png', '@/b/截图.png', bindings), '@截图.png (2)')
  // 同名同 mention（重复插入同一文件）→ 直接用 @短名 覆盖注册，不递增
  assert.equal(fileMentionToken('截图.png', '@/a/截图.png', bindings), '@截图.png')
})

test('activeAtToken：常见中英文标点后可触发（行间 @ 引用）', () => {
  assert.deepEqual(activeAtToken('第一张，@img'), { prefix: '@img', query: 'img', quoted: false })
  assert.deepEqual(activeAtToken('对比：@img1'), { prefix: '@img1', query: 'img1', quoted: false })
  // 引号 token 同样支持标点后触发（汉字前是内容边界，不误触）
  assert.deepEqual(activeAtToken('第一张，@"img 1.png'), { prefix: '@"img 1.png', query: 'img 1.png', quoted: true })
  assert.equal(activeAtToken('看@"img 1.png'), undefined)
  // 标点后不误触发（邮箱/普通字符边界不变）
  assert.equal(activeAtToken('foo.a@b'), undefined)
})

test('arrowNavPosition：方向键以整个 @ token 为单元跨越', () => {
  const bindings = new Map([
    ['@img9.png', '@/tmp/dsh-one-attachments/s1/img9.png'],
    ['@pasted-1.txt', '@/tmp/dsh-one-attachments/s1/pasted-1.txt'],
  ])
  // '@img9.png 和 @pasted-1.txt 都看看'：token1 [0,9)，token2 [12,25)
  const value = '@img9.png 和 @pasted-1.txt 都看看'
  // token 起始处 → 向右跳到 token 后
  assert.equal(arrowNavPosition(value, 0, 1, bindings), 9)
  // token 内部 → 向右/向左都跨出
  assert.equal(arrowNavPosition(value, 4, 1, bindings), 9)
  assert.equal(arrowNavPosition(value, 4, -1, bindings), 0)
  // token 紧后方 → 向左跨过整个 token
  assert.equal(arrowNavPosition(value, 9, -1, bindings), 0)
  // 第二个 token 同规则
  assert.equal(arrowNavPosition(value, 12, 1, bindings), 25)
  assert.equal(arrowNavPosition(value, 20, -1, bindings), 12)
  assert.equal(arrowNavPosition(value, 26, -1, bindings), null)
  // 非 token 位置（空白/文本）→ null（走原生）
  assert.equal(arrowNavPosition(value, 10, 1, bindings), null)
  assert.equal(arrowNavPosition(value, 25, 1, bindings), null)
  assert.equal(arrowNavPosition(value, 26, 1, bindings), null)
  assert.equal(arrowNavPosition(value, value.length, -1, bindings), null)
  // 无绑定 → null
  assert.equal(arrowNavPosition(value, 0, 1, new Map()), null)
})

assert.equal(arrowNavPosition('@img9.png 和 @pasted-1.txt 都看看', 25, -1, new Map([['@pasted-1.txt','@/x/pasted-1.txt'],['@img9.png','@/x/img9.png']])), 12)


test('tokenDeletion：退格删前 token、Delete 删后 token，整段删除', () => {
  const bindings = new Map([
    ['@img9.png', '@/tmp/dsh-one-attachments/s1/img9.png'],
    ['@pasted-1.txt', '@/tmp/dsh-one-attachments/s1/pasted-1.txt'],
  ])
  const value = '@img9.png 和 @pasted-1.txt 都看看'
  // 光标在 token1 紧后（pos 9）→ 退格整段删 token1，光标回到 token1 起点
  assert.deepEqual(tokenDeletion(value, 9, -1, bindings), {
    text: ' 和 @pasted-1.txt 都看看', pos: 0, token: '@img9.png',
  })
  // 光标在 token2 内部 → 退格删 token2
  const del = tokenDeletion(value, 20, -1, bindings)
  assert.equal(del?.token, '@pasted-1.txt')
  assert.equal(del?.pos, 12)
  assert.equal(del?.text, '@img9.png 和  都看看')
  // 光标在 token1 开头 → Delete 删 token1（对称）
  assert.equal(tokenDeletion(value, 0, 1, bindings)?.token, '@img9.png')
  // 非 token 位置 → null（走原生）
  assert.equal(tokenDeletion(value, 10, -1, bindings), null)
  assert.equal(tokenDeletion(value, 26, -1, bindings), null)
  // 文本末尾退格正常（无绑定 token 在附近）
  assert.equal(tokenDeletion(value, value.length, -1, new Map()), null)
})

test('restoreFileMentionTokens：recall 时 canonical @长路径还原为 @短名 token', () => {
  const bindings = new Map<string, string>()
  const text = '@/var/folders/T/sess-1/img1.png 你看看 @/Users/a/合同（草案）.docx 还有 @src/foo 保持原样'
  const restored = restoreFileMentionTokens(text, bindings)
  // 绝对路径与相对路径引用都还原成 @短名（发送时可展开回原文）；正文不被吞
  assert.equal(restored, '@img1.png 你看看 @合同（草案）.docx 还有 @foo 保持原样')
  assert.equal(bindings.get('@img1.png'), '@/var/folders/T/sess-1/img1.png')
  assert.equal(bindings.get('@合同（草案）.docx'), '@/Users/a/合同（草案）.docx')
  assert.equal(bindings.get('@foo'), '@src/foo')
})

test('restoreFileMentionTokens：空格引号路径与同名冲突', () => {
  const bindings = new Map<string, string>()
  const text = '@/a/b.md @"/Users/x/with space.txt"'
  const restored = restoreFileMentionTokens(text, bindings)
  assert.equal(restored, '@b.md @with space.txt')
  assert.equal(bindings.get('@b.md'), '@/a/b.md')
  assert.equal(bindings.get('@with space.txt'), '@"/Users/x/with space.txt"')
  // 同名不同路径 → 递增后缀
  const again = restoreFileMentionTokens('@/a/b.md 又一次 @/c/b.md', bindings)
  assert.equal(again, '@b.md 又一次 @b.md (2)')
})

test('activeAtToken：触发边界与渲染侧一致（中文开括号触发、ASCII ( 不触发）', () => {
  assert.deepEqual(activeAtToken('（@img1'), { prefix: '@img1', query: 'img1', quoted: false })
  assert.equal(activeAtToken('func(@arg'), undefined)
})

test('activeAtToken：终止规则生效（. 后无续接字符/;!?: 后不触发补全）', () => {
  assert.deepEqual(activeAtToken('看下 @a.txt'), { prefix: '@a.txt', query: 'a.txt', quoted: false })
  assert.equal(activeAtToken('看下 @a.txt.后'), undefined)
  assert.equal(activeAtToken('看下 @a.txt,'), undefined)
  assert.equal(activeAtToken('看下 @img1:'), undefined)
  assert.equal(activeAtToken('看下 @img1;'), undefined)
  assert.equal(activeAtToken('看下 @a😀'), undefined)
})

test('activeAtToken：词中/汉字紧邻的 @ 不触发补全', () => {
  assert.equal(activeAtToken('a@img b'), undefined)
  assert.equal(activeAtToken('看@img'), undefined)
})

test('arrowNavPosition / tokenDeletion：词中 @ 不算 token（a@img b 不参与导航与删除）', () => {
  const bindings = new Map([['@img', '@/x/img.png']])
  assert.equal(arrowNavPosition('a@img b', 3, 1, bindings), null)
  assert.equal(arrowNavPosition('a@img b', 4, -1, bindings), null)
  assert.equal(tokenDeletion('a@img b', 4, -1, bindings), null)
  // 边界处的 @img 照常参与
  assert.equal(arrowNavPosition('@img b', 2, 1, bindings), 4)
  assert.equal(tokenDeletion('@img b', 4, -1, bindings)?.token, '@img')
})

test('restoreFileMentionTokens：词中的 @ 路径引用不还原（a@b/c 保持原样）', () => {
  const bindings = new Map<string, string>()
  const restored = restoreFileMentionTokens('这里 a@b/c 那里 @/x/y.txt', bindings)
  assert.equal(restored, '这里 a@b/c 那里 @y.txt')
  assert.equal(bindings.get('@y.txt'), '@/x/y.txt')
  assert.equal(bindings.has('@b/c'), false)
})
