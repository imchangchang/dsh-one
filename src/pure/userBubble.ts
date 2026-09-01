/**
 * 用户气泡文本的引用 tokenizer，对齐官方 dsh web 的 projectUserText
 * （dsh-client-ui-conversation lib/client.js）——纯展示层：消息落盘的原文
 * 是唯一事实，本模块只按文本形态把引用切成段，不引入任何 host 结构化
 * 数据（@file/@folder 引用在 dsh 契约里没有 kind/摘要，官方同样是
 * presentation-only 的形态推断）。
 *
 * 切分规则（与官方一致）：
 * - 会话引用：references 里的 {sessionId, label} 逐条匹配文本里的 `@label`
 *   （按引用顺序各取第一次出现；同 label 多引用按文本顺序轮转）。无
 *   references 时回退到 canonical URI mention（@[label](dsh-session:…)）。
 * - `@path` / `@path/`：文件/文件夹（尾斜杠 = 文件夹）；`@"path"` 带引号
 *   路径同规则（目录的引号不闭合，如 `@"src/`）。
 * - `/command`：skill 形态，无图标。
 * 文件/文件夹 chip 展示 basename，悬停 title 用完整 token。
 */

import { sessionMentionRanges } from './sessionMention.ts'

export type UserBubbleSegment =
  | { kind: 'text'; text: string }
  | { kind: 'session'; sessionId: string; label: string }
  | { kind: 'file'; path: string; label: string }
  | { kind: 'folder'; path: string; label: string }
  | { kind: 'skill'; label: string }

/** 官方 projectUserText 的普通 token 扫描（行首或空白后的词边界 token）。 */
const PLAIN_TOKEN_PATTERN = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
/** 官方对非引号 token 的尾部标点剥离（引号 token 的捕获在闭引号前止步，无需剥离）。 */
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？]+$/gu

interface BubbleRange {
  start: number
  end: number
  kind: 'session' | 'plain'
  sessionId?: string
  /** session：不带 @ 的显示 label；plain：原始 token（含 @ 或 /）。 */
  label: string
}

/**
 * references 驱动的会话区间：每个 ref label 在文本里的全部 `@label` 出现都
 * 标记为 reserved（普通扫描不再碰，剩余出现保持纯文本——与 splitReadableMentions
 * 的旧语义一致，避免把会话标题误渲染成文件 chip）；ref 按出现顺序各取一次。
 */
function sessionRangesFromReferences(
  text: string,
  references: readonly { sessionId: string; label: string }[],
): { ranges: BubbleRange[]; reserved: Set<number> } {
  const occurrences = new Map<string, number[]>()
  const positionsOf = (label: string): number[] => {
    let cached = occurrences.get(label)
    if (cached !== undefined) return cached
    cached = []
    const needle = `@${label}`
    let from = 0
    for (let at = text.indexOf(needle, from); at >= 0; at = text.indexOf(needle, from)) {
      cached.push(at)
      from = at + needle.length
    }
    occurrences.set(label, cached)
    return cached
  }
  const reserved = new Set<number>()
  for (const label of new Set(references.map((r) => r.label))) {
    for (const start of positionsOf(label)) reserved.add(start)
  }
  const nextPosition = new Map<string, number>()
  const ranges: BubbleRange[] = []
  for (const ref of references) {
    const positions = positionsOf(ref.label)
    const index = nextPosition.get(ref.label) ?? 0
    if (index >= positions.length) continue // 文本里没有该引用（或已被同名引用占完）
    const start = positions[index]
    ranges.push({ start, end: start + ref.label.length + 1, kind: 'session', sessionId: ref.sessionId, label: ref.label })
    nextPosition.set(ref.label, index + 1)
  }
  return { ranges, reserved }
}

/**
 * 把用户气泡文本切成「文本段 + 引用段」序列（按文本出现顺序）。
 * references 缺省或为空时，会话引用按 canonical URI mention 识别
 * （引用失败残留的原始 mention，行为同 splitSessionMentions）；解析不了的
 * 坏 URI 落入普通扫描，按文件 chip 展示（与官方 projectUserText 一致）。
 */
export function splitUserBubble(
  text: string,
  references?: readonly { sessionId: string; label: string }[],
): UserBubbleSegment[] {
  let ranges: BubbleRange[]
  let reserved: Set<number>
  if (references?.length) {
    const session = sessionRangesFromReferences(text, references)
    ranges = session.ranges
    reserved = session.reserved
  } else {
    const uriRanges = sessionMentionRanges(text)
    ranges = uriRanges.map((r) => ({ ...r, kind: 'session' as const }))
    reserved = new Set(uriRanges.map((r) => r.start))
  }
  for (const match of text.matchAll(PLAIN_TOKEN_PATTERN)) {
    const start = match.index + (match[1]?.length ?? 0)
    if (reserved.has(start)) continue
    let label = match[2] ?? ''
    if (!label.startsWith('@"')) label = label.replace(TRAILING_PUNCTUATION, '')
    if (label.length <= 1) continue
    ranges.push({ start, end: start + label.length, kind: 'plain', label })
  }
  // 按位置排序；同起点会话引用优先（`@label` 同时会被普通扫描命中），
  // 再按更长的 end 优先（与官方排序一致）。
  ranges.sort((a, b) => a.start - b.start || (a.kind === b.kind ? b.end - a.end : a.kind === 'session' ? -1 : 1))

  const segments: UserBubbleSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue // 与已消费区间重叠（会话 chip 已吞掉普通命中）
    if (range.start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, range.start) })
    if (range.kind === 'session' && range.sessionId !== undefined) {
      segments.push({ kind: 'session', sessionId: range.sessionId, label: range.label })
    } else if (range.label.startsWith('@')) {
      const isFolder = range.label.endsWith('/')
      segments.push({
        kind: isFolder ? 'folder' : 'file',
        path: range.label,
        label: basename(range.label),
      })
    } else {
      segments.push({ kind: 'skill', label: range.label })
    }
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}

/** 展示名 = 去掉 @ 与引号后的最后一个路径段（官方 displayLabel 同款）。 */
function basename(token: string): string {
  return token.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? token.slice(1)
}
