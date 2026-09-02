/**
 * 会话引用（@会话）mention 的纯函数编解码，对齐 host 包 dsh-session-reference
 * 的 canonical 格式（lib/types/uri.js）：
 *   URI     = `dsh-session:` + base64url(JSON.stringify(sessionId))
 *   mention = `@[label](uri)`（label 里 `\` 和 `]` 要转义）
 * host 在 agent/pre-step 解析 direct user message 里的 mention，把被引用会话的
 * 只读快照注入为 sourced context。这里只做编解码与文本展开，不碰网络。
 * 浏览器安全：不用 Buffer（webview 由 esbuild 打包进浏览器环境）。
 */

export const SESSION_REFERENCE_SCHEME = 'dsh-session:'

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(payload: string): string {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 任意 session id → canonical `dsh-session:` URI（base64url 保证往返无损）。 */
export function encodeSessionReferenceUri(sessionId: string): string {
  return SESSION_REFERENCE_SCHEME + b64urlEncode(JSON.stringify(sessionId))
}

/** canonical URI → session id；不合法/非 canonical（重编码不等）返回 null。 */
export function decodeSessionReferenceUri(uri: string): string | null {
  if (!uri.startsWith(SESSION_REFERENCE_SCHEME)) return null
  const payload = uri.slice(SESSION_REFERENCE_SCHEME.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null
  try {
    const parsed: unknown = JSON.parse(b64urlDecode(payload))
    if (typeof parsed !== 'string') return null
    return encodeSessionReferenceUri(parsed) === uri ? parsed : null
  } catch {
    return null
  }
}

function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/g, (m) => `\\${m}`)
}

function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/g, '$1')
}

/** 渲染一条 host 可识别的 Markdown mention：`@[label](dsh-session:...)`。 */
export function formatSessionMention(label: string, sessionId: string): string {
  return `@[${escapeLabel(label)}](${encodeSessionReferenceUri(sessionId)})`
}

export interface SessionMention {
  sessionId: string
  label: string
}

const MENTION_PATTERN = /@\[((?:\\.|[^\\\]])*)\]\((dsh-session:[^\s)]*)\)|(dsh-session:[A-Za-z0-9_-]+)/g

/**
 * 从文本里提取 mention（Markdown 形态与裸 URI 都算），对齐 host 的
 * parseSessionReferenceText，但容错：解码失败的片段原样保留、不计入结果。
 */
export function parseSessionMentions(text: string): { text: string; references: SessionMention[] } {
  const references: SessionMention[] = []
  const rendered = text.replace(MENTION_PATTERN, (match, rawLabel: string, markdownUri: string, bareUri: string) => {
    const uri = markdownUri ?? bareUri
    const sessionId = decodeSessionReferenceUri(uri)
    if (sessionId === null) return match
    const label = rawLabel === undefined ? sessionId : unescapeLabel(rawLabel)
    references.push({ sessionId, label })
    return `@${label}`
  })
  return { text: rendered, references }
}

/**
 * 文本里全部会话 mention 的 [start, end) 区间（按出现顺序），坏 URI 跳过。
 * splitSessionMentions 与用户气泡 tokenizer（src/pure/userBubble.ts）共用。
 */
export interface SessionMentionRange {
  start: number
  end: number
  sessionId: string
  label: string
}

export function sessionMentionRanges(text: string): SessionMentionRange[] {
  const ranges: SessionMentionRange[] = []
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const uri = match[2] ?? match[3]
    const sessionId = decodeSessionReferenceUri(uri)
    if (sessionId === null) continue
    const at = match.index
    ranges.push({ start: at, end: at + match[0].length, sessionId, label: match[1] === undefined ? sessionId : unescapeLabel(match[1]) })
  }
  return ranges
}

/**
 * 把文本按 mention 切成段（文本段为 string，mention 段为 SessionMention），
 * 供纯文本渲染（用户气泡）交替拼 DOM。坏 URI 留在文本段里。
 */
export function splitSessionMentions(text: string): Array<string | SessionMention> {
  const segments: Array<string | SessionMention> = []
  let last = 0
  for (const range of sessionMentionRanges(text)) {
    if (range.start > last) segments.push(text.slice(last, range.start))
    segments.push({ sessionId: range.sessionId, label: range.label })
    last = range.end
  }
  if (last < text.length) segments.push(text.slice(last))
  return segments
}

/**
 * host 解析引用后落盘的是可读文本（mention 被替换成 `@label`），气泡里
 * 不再有 canonical URI 可切。这个函数用注入上下文 source.references 里的
 * {sessionId, label} 把可读 `@label` 重新切成 mention 段：按引用顺序各取
 * 第一次出现，找不到的引用跳过（文本里恰好有同名 `@label` 时可能切到
 * 用户自己打的字，可接受的边界）。
 */
export function splitReadableMentions(
  text: string,
  references: readonly SessionMention[],
): Array<string | SessionMention> {
  const segments: Array<string | SessionMention> = []
  let rest = text
  for (const ref of references) {
    const needle = `@${ref.label}`
    const at = rest.indexOf(needle)
    if (at < 0) continue
    if (at > 0) segments.push(rest.slice(0, at))
    segments.push({ sessionId: ref.sessionId, label: ref.label })
    rest = rest.slice(at + needle.length)
  }
  if (rest) segments.push(rest)
  return segments
}

/**
 * 发送前把输入框里的显示 token（`@标题`）展开为 canonical mention。
 * bindings 由 @ 补全在插入时记录（token → mention）；按 token 长度从长到短
 * 替换，避免 `@A` 抢在 `@A B` 前面命中。token 不含 `[`，不会误伤已展开的
 * mention 文本。手动删改过 token（不再完整出现）就自然留在原文里。
 */
export function expandMentionBindings(text: string, bindings: ReadonlyMap<string, string>): string {
  let out = text
  for (const token of [...bindings.keys()].sort((a, b) => b.length - a.length)) {
    const mention = bindings.get(token)
    if (mention && out.includes(token)) out = out.split(token).join(mention)
  }
  return out
}

/**
 * 为一次插入挑一个不冲突的显示 token：首选 `@标题`；已被别的会话占用时
 * 追加 ` (2)`、` (3)`…直到唯一（标题重复的边界，backlog 要求处理）。
 */
export function mentionDisplayToken(title: string, sessionId: string, bindings: ReadonlyMap<string, string>): string {
  const mention = formatSessionMention(title, sessionId)
  let token = `@${title}`
  for (let i = 2; bindings.has(token) && bindings.get(token) !== mention; i += 1) {
    token = `@${title} (${i})`
  }
  return token
}
