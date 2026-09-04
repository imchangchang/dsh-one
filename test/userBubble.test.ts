import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeSessionReferenceUri } from '../src/pure/sessionMention.ts'
import { splitUserBubble, type UserBubbleSegment } from '../src/pure/userBubble.ts'

test('@文件 token 切成文件 chip（展示 basename，path 保留完整 token）', () => {
  assert.deepEqual(splitUserBubble('看下 @src/foo.ts 这个文件'), [
    { kind: 'text', text: '看下 ' },
    { kind: 'file', path: '@src/foo.ts', label: 'foo.ts' },
    { kind: 'text', text: ' 这个文件' },
  ])
})

test('尾斜杠 @目录 切成文件夹 chip', () => {
  assert.deepEqual(splitUserBubble('检查 @src/ 目录'), [
    { kind: 'text', text: '检查 ' },
    { kind: 'folder', path: '@src/', label: 'src' },
    { kind: 'text', text: ' 目录' },
  ])
})

test('@"带空格路径" 按引号 token 识别（闭引号并入 token，与官方一致）', () => {
  assert.deepEqual(splitUserBubble('读 @"my file.txt" 内容'), [
    { kind: 'text', text: '读 ' },
    { kind: 'file', path: '@"my file.txt"', label: 'my file.txt' },
    { kind: 'text', text: ' 内容' },
  ])
  // 目录的引号不闭合（官方 formatFileMention 的保留引号语法）
  assert.deepEqual(splitUserBubble('看 @"src/ 下面'), [
    { kind: 'text', text: '看 ' },
    { kind: 'folder', path: '@"src/', label: 'src' },
    { kind: 'text', text: ' 下面' },
  ])
})

test('非引号 token 剥离尾部标点', () => {
  assert.deepEqual(splitUserBubble('先看 @a.txt, 再看 @b.ts。'), [
    { kind: 'text', text: '先看 ' },
    { kind: 'file', path: '@a.txt', label: 'a.txt' },
    { kind: 'text', text: ', 再看 ' },
    { kind: 'file', path: '@b.ts', label: 'b.ts' },
    { kind: 'text', text: '。' },
  ])
})

test('反斜杠路径的 basename 取最后一段', () => {
  assert.deepEqual(splitUserBubble('看 @src\\a.ts'), [
    { kind: 'text', text: '看 ' },
    { kind: 'file', path: '@src\\a.ts', label: 'a.ts' },
  ])
})

test('/command token 切成无图标的 skill chip', () => {
  assert.deepEqual(splitUserBubble('/help 看看'), [
    { kind: 'skill', label: '/help' },
    { kind: 'text', text: ' 看看' },
  ])
})

test('行首或空白后的 @ 才算 token（邮箱不误伤）；@ 与 / 单独不成 chip', () => {
  assert.deepEqual(splitUserBubble('联系 a@b.com 问 @x 和 @ 和 /'), [
    { kind: 'text', text: '联系 a@b.com 问 ' },
    { kind: 'file', path: '@x', label: 'x' },
    { kind: 'text', text: ' 和 @ 和 /' },
  ])
})

test('无 token 时整段文本', () => {
  assert.deepEqual(splitUserBubble('普通文本'), [{ kind: 'text', text: '普通文本' }])
  assert.deepEqual(splitUserBubble(''), [])
})

test('references 驱动的会话 chip：同 label 多引用按文本顺序轮转各自 sessionId', () => {
  const refs = [
    { sessionId: 'id-1', label: '会话A' },
    { sessionId: 'id-2', label: '会话A' },
  ]
  assert.deepEqual(splitUserBubble('帮我看看 @会话A 和 @会话A 谢谢', refs), [
    { kind: 'text', text: '帮我看看 ' },
    { kind: 'session', sessionId: 'id-1', label: '会话A' },
    { kind: 'text', text: ' 和 ' },
    { kind: 'session', sessionId: 'id-2', label: '会话A' },
    { kind: 'text', text: ' 谢谢' },
  ])
})

test('引用出现数超出 ref 数时，剩余 @label 保持纯文本（不误渲染成文件 chip）', () => {
  assert.deepEqual(splitUserBubble('@甲 @甲', [{ sessionId: 'id-1', label: '甲' }]), [
    { kind: 'session', sessionId: 'id-1', label: '甲' },
    { kind: 'text', text: ' @甲' },
  ])
})

test('会话 chip 优先于文件推断；会话 label 撞上文件 token 前缀时剩余文本保持纯文本', () => {
  const refs = [{ sessionId: 'id-1', label: 'foo' }]
  // @foo.ts 里也含 @foo：引用消费掉首个出现后，该 token 保持纯文本（旧语义，
  // 避免把会话标题前缀误渲染成文件 chip）
  assert.deepEqual(splitUserBubble('@foo 和 @foo.ts', refs), [
    { kind: 'session', sessionId: 'id-1', label: 'foo' },
    { kind: 'text', text: ' 和 @foo.ts' },
  ])
})

test('无 references 时回退 canonical URI mention（引用失败残留）', () => {
  const uri = encodeSessionReferenceUri('s1')
  assert.deepEqual(splitUserBubble(`问 @[旧会话](${uri}) 一下`), [
    { kind: 'text', text: '问 ' },
    { kind: 'session', sessionId: 's1', label: '旧会话' },
    { kind: 'text', text: ' 一下' },
  ])
  // 坏 URI 解不开：按文件 chip 展示（对齐官方 projectUserText）
  assert.deepEqual(splitUserBubble('看 @[坏](dsh-session:%%%) 这个'), [
    { kind: 'text', text: '看 ' },
    { kind: 'file', path: '@[坏](dsh-session:%%%)', label: '[坏](dsh-session:%%%)' },
    { kind: 'text', text: ' 这个' },
  ])
})

test('文件/文件夹/命令/会话混合按文本顺序切分', () => {
  assert.deepEqual(splitUserBubble('@a.ts /cmd @b/ 和 @c'), [
    { kind: 'file', path: '@a.ts', label: 'a.ts' },
    { kind: 'text', text: ' ' },
    { kind: 'skill', label: '/cmd' },
    { kind: 'text', text: ' ' },
    { kind: 'folder', path: '@b/', label: 'b' },
    { kind: 'text', text: ' 和 ' },
    { kind: 'file', path: '@c', label: 'c' },
  ])
})

test('会话与文件引用同现：references 与会话 chip 不冲突', () => {
  const refs = [{ sessionId: 'id-1', label: '旧会话' }]
  const segments: UserBubbleSegment[] = splitUserBubble('参考 @旧会话 再看 @src/a.ts', refs)
  assert.deepEqual(segments, [
    { kind: 'text', text: '参考 ' },
    { kind: 'session', sessionId: 'id-1', label: '旧会话' },
    { kind: 'text', text: ' 再看 ' },
    { kind: 'file', path: '@src/a.ts', label: 'a.ts' },
  ])
})

test('splitUserBubble：@路径后直接接中文标点不吞正文（中文路径名保留）', () => {
  const segs = splitUserBubble('截图在 @/var/folders/T/dsh-one-attachments/截图-0903-171126.png，源码在 @/Users/a/src/index.ts，目录 @/Users/a/src/ 也看看。')
  const files = segs.filter((s) => s.kind === 'file')
  assert.deepEqual(files.map((s) => s.label), ['截图-0903-171126.png', 'index.ts'])
  // 中文文件名路径不被截断（汉字属于路径内容）
  assert.equal(files[0].path, '@/var/folders/T/dsh-one-attachments/截图-0903-171126.png')
  const folder = segs.find((s) => s.kind === 'folder')
  assert.equal(folder?.label, 'src')
  // 正文保留（中文标点留在正文侧）
  assert.ok(segs.some((s) => s.kind === 'text' && s.text.includes('，源码在')))
})

test('splitUserBubble：全角括号不是 token 终止符（文件名可含（说明））', () => {
  const segs = splitUserBubble('见 @/a/b.md（说明）')
  const file = segs.find((s) => s.kind === 'file')
  assert.equal(file?.label, 'b.md（说明）')
  assert.equal(file?.path, '@/a/b.md（说明）')
})

test('splitUserBubble：含全角括号的路径不截断（（草案）.docx 完整保留）', () => {
  const segs = splitUserBubble('这个文件 @/Users/a/济南市既有住宅增设电梯项目合同补充协议（草案）.docx 你能看吗？')
  const file = segs.find((s) => s.kind === 'file')
  assert.equal(file?.label, '济南市既有住宅增设电梯项目合同补充协议（草案）.docx')
  assert.equal(file?.path, '@/Users/a/济南市既有住宅增设电梯项目合同补充协议（草案）.docx')
  // 全角问号仍终止（正文不吞）
  assert.ok(segs.some((s) => s.kind === 'text' && s.text.includes('？') && s.text.includes('你能看吗')))
})
