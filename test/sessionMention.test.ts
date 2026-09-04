import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeSessionReferenceUri,
  encodeSessionReferenceUri,
  expandMentionBindings,
  formatSessionMention,
  mentionDisplayToken,
  parseSessionMentions,
  splitReadableMentions,
  splitSessionMentions,
} from '../src/pure/sessionMention.ts'

test('URI 编解码往返：普通 id 与含特殊字符的 id 都无损', () => {
  for (const id of ['abc123', 's/ession: id 中文 ✅', '']) {
    assert.equal(decodeSessionReferenceUri(encodeSessionReferenceUri(id)), id)
  }
})

test('编码对齐 host 格式：base64url(JSON.stringify(id))，与 dsh-session-reference 一致', () => {
  // host: Buffer.from(JSON.stringify('abc'), 'utf8').toString('base64url')
  assert.equal(encodeSessionReferenceUri('abc'), `dsh-session:${Buffer.from('"abc"', 'utf8').toString('base64url')}`)
})

test('decode 拒绝非 canonical 与畸形输入', () => {
  assert.equal(decodeSessionReferenceUri('dsh-session:not base64!!!'), null)
  assert.equal(decodeSessionReferenceUri('dsh-session:'), null)
  assert.equal(decodeSessionReferenceUri('https://example.com'), null)
  // 合法 base64url 但解码后不是 JSON 字符串
  assert.equal(decodeSessionReferenceUri(`dsh-session:${Buffer.from('123', 'utf8').toString('base64url')}`), null)
  // 非 canonical：payload 带多余填充位，重编码不等
  assert.equal(decodeSessionReferenceUri(`${encodeSessionReferenceUri('abc')}=`), null)
})

test('formatSessionMention 转义 label 里的反斜杠和右括号', () => {
  const m = formatSessionMention('a]b\\c', 's1')
  assert.equal(m, `@[a\\]b\\\\c](${encodeSessionReferenceUri('s1')})`)
  assert.deepEqual(parseSessionMentions(m).references, [{ sessionId: 's1', label: 'a]b\\c' }])
})

test('parseSessionMentions 提取 Markdown mention 与裸 URI，渲染为 @label', () => {
  const uri = encodeSessionReferenceUri('s1')
  const { text, references } = parseSessionMentions(`参考 @[旧会话](${uri}) 和裸链 ${uri} 谢谢`)
  assert.equal(text, '参考 @旧会话 和裸链 @s1 谢谢')
  assert.deepEqual(references, [
    { sessionId: 's1', label: '旧会话' },
    { sessionId: 's1', label: 's1' },
  ])
})

test('parseSessionMentions 对坏 URI 容错：原样保留，不进 references', () => {
  const { text, references } = parseSessionMentions('看 @[坏](dsh-session:%%%) 这个')
  assert.equal(text, '看 @[坏](dsh-session:%%%) 这个')
  assert.deepEqual(references, [])
})

test('splitSessionMentions 交替切出文本段与 mention 段', () => {
  const uri = encodeSessionReferenceUri('s1')
  assert.deepEqual(splitSessionMentions(`问 @[旧会话](${uri}) 一下`), [
    '问 ',
    { sessionId: 's1', label: '旧会话' },
    ' 一下',
  ])
  // 无 mention 时原样一段；坏 URI 留在文本段里
  assert.deepEqual(splitSessionMentions('没有引用'), ['没有引用'])
  assert.deepEqual(splitSessionMentions('坏 @[x](dsh-session:%%%)'), ['坏 @[x](dsh-session:%%%)'])
})

test('expandMentionBindings 长 token 优先，全部出现都替换', () => {
  const bindings = new Map([
    ['@A', formatSessionMention('A', 'id-a')],
    ['@A B', formatSessionMention('A B', 'id-ab')],
  ])
  const out = expandMentionBindings('问 @A B 和 @A 各一遍，再来 @A B', bindings)
  assert.equal(
    out,
    `问 ${formatSessionMention('A B', 'id-ab')} 和 ${formatSessionMention('A', 'id-a')} 各一遍，再来 ${formatSessionMention('A B', 'id-ab')}`,
  )
})

test('expandMentionBindings 不动未登记的 @ 文本和已展开的 mention', () => {
  const mention = formatSessionMention('旧会话', 'id-1')
  const bindings = new Map([['@旧会话', mention]])
  assert.equal(expandMentionBindings(`邮箱 a@b.com 与 ${mention}`, bindings), `邮箱 a@b.com 与 ${mention}`)
  assert.equal(expandMentionBindings('没有登记 @路人', bindings), '没有登记 @路人')
})

test('expandMentionBindings：词中的 @ 不展开（a@img b），边界处的照常展开', () => {
  const bindings = new Map([['@img', formatSessionMention('img', 'id-1')]])
  assert.equal(expandMentionBindings('a@img b 和 看@img 和 @img', bindings), `a@img b 和 看@img 和 ${formatSessionMention('img', 'id-1')}`)
})

test('mentionDisplayToken 标题重复时追加序号直到唯一', () => {
  const bindings = new Map<string, string>()
  const t1 = mentionDisplayToken('周报', 'id-1', bindings)
  bindings.set(t1, formatSessionMention('周报', 'id-1'))
  // 同一个会话再次插入，复用同一 token
  assert.equal(mentionDisplayToken('周报', 'id-1', bindings), '@周报')
  // 另一个会话撞标题，得到 (2)
  const t2 = mentionDisplayToken('周报', 'id-2', bindings)
  assert.equal(t2, '@周报 (2)')
  bindings.set(t2, formatSessionMention('周报', 'id-2'))
  assert.equal(mentionDisplayToken('周报', 'id-3', bindings), '@周报 (3)')
})

test('splitReadableMentions 按引用顺序切出可读 @label', () => {
  const refs = [
    { sessionId: 'id-1', label: '会话甲' },
    { sessionId: 'id-2', label: '会话乙' },
  ]
  assert.deepEqual(splitReadableMentions('@会话甲 和 @会话乙 都看下', refs), [
    { sessionId: 'id-1', label: '会话甲' },
    ' 和 ',
    { sessionId: 'id-2', label: '会话乙' },
    ' 都看下',
  ])
})

test('splitReadableMentions 找不到的引用跳过，无命中时返回整段文本', () => {
  const refs = [{ sessionId: 'id-1', label: '不存在' }]
  assert.deepEqual(splitReadableMentions('普通文本', refs), ['普通文本'])
  assert.deepEqual(splitReadableMentions('@甲 @甲', [{ sessionId: 'id-1', label: '甲' }]), [
    { sessionId: 'id-1', label: '甲' },
    ' @甲',
  ])
})
