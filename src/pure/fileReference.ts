/**
 * @file 补全的 token 语法与插入文本格式，移植自 host 包 dsh-file-reference
 * 的 grammar（lib/index.js 的 activeAtToken / formatFileMention），保持
 * 与 dsh web 完全一致的触发与序列化行为。官方按"行 + 列"匹配；这里的
 * 入参是光标前的整段文本，(?:^|\s) 里的 \s 覆盖换行，语义等价。
 */
import { attachmentBaseName } from './composerAttachment.ts'

/** 光标处活跃的 @ token；不在 @ token 上时为 undefined。 */
export interface ActiveAtToken {
  /** 含 @ 的完整 token 文本（`@sub/que` 或 `@"带空格`），用于定位替换区间。 */
  prefix: string
  /** 去掉 @ / @" 后的查询串，原样发给 fileReferences/list。 */
  query: string
  /** 用户显式开了引号（@"…未闭合）；引号 token 只出文件候选。 */
  quoted: boolean
}

/**
 * 提取光标前的 `@path` 或未闭合 `@"path with spaces` token。其它 token
 * 内部的 @（如邮箱地址）不触发补全。触发边界 = 行首/空白/常见标点（中文
 * 句子里 `，@img1` 的 @ 能开补全——官方只用 \s，dsh-one 扩展为行间触发）。
 */
export function activeAtToken(beforeCursor: string): ActiveAtToken | undefined {
  const quoted = /(?:^|[\s，。；：！？、,;!?])(@"([^"]*))$/.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  const plain = /(?:^|[\s，。；：！？、,;!?])(@(\S*))$/.exec(beforeCursor)
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined
  return { prefix: plain[1], query: plain[2], quoted: false }
}

/** fileReferences/list 候选（路径相对会话 cwd）。 */
export interface FileRefCandidate {
  path: string
  kind: 'file' | 'directory'
}

/**
 * 把选中的路径格式化为提示词文本：含空白用 @"path" 引号语法；引号中的
 * 目录在尾部斜杠后保持引号敞开，补全可以继续下一层。编辑器语法无法
 * 安全表示的路径（控制字符、内嵌引号）返回 undefined。
 */
export function formatFileMention(candidate: FileRefCandidate, preserveQuote = false): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (/["\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  if (!(preserveQuote || /\s/.test(path))) return `@${path}`
  if (candidate.kind === 'directory') return `@"${path}`
  return `@"${path}"`
}

/**
 * 为一次文件引用插入挑一个不冲突的显示 token：首选 `@短名`；已被别的
 * 绑定占用时追加 ` (2)`、` (3)`…直到唯一（与会话 mention 的
 * mentionDisplayToken 同策略）。key 即 bindings 里的键，发送时经
 * expandMentionBindings 展开成 canonical 路径引用。
 */
export function fileMentionToken(name: string, candidateMention: string, bindings: ReadonlyMap<string, string>): string {
  let token = `@${name}`
  for (let i = 2; bindings.has(token) && bindings.get(token) !== candidateMention; i += 1) {
    token = `@${name} (${i})`
  }
  return token
}

/** 输入文本里 mention 显示 token 的区间（长 token 优先、不重叠扫描）。 */
export function mentionTokenRanges(
  value: string,
  bindings: ReadonlyMap<string, string>,
): Array<{ start: number; end: number }> {
  const tokens = [...bindings.keys()].sort((a, b) => b.length - a.length)
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = 0
  while (cursor < value.length) {
    let best: { index: number; token: string } | null = null
    for (const token of tokens) {
      const index = value.indexOf(token, cursor)
      if (index >= 0 && (best === null || index < best.index)) best = { index, token }
    }
    if (best === null) break
    ranges.push({ start: best.index, end: best.index + best.token.length })
    cursor = best.index + best.token.length
  }
  return ranges
}

/**
 * 方向键的「token 原子导航」：光标在 token 上（含边界）时返回应该到达的位置
 * （整个 @ 引用作为一个单元跨过）；不在 token 上或选中态返回 null，走原生。
 */
export function arrowNavPosition(
  value: string,
  pos: number,
  dir: 1 | -1,
  bindings: ReadonlyMap<string, string>,
): number | null {
  for (const r of mentionTokenRanges(value, bindings)) {
    if (dir === 1 && pos >= r.start && pos < r.end) return r.end
    if (dir === -1 && pos > r.start && pos <= r.end) return r.start
  }
  return null
}

/**
 * 退格/Delete 的「token 原子删除」：光标在 token 后/内部时整段删除该 token
 * （Backspace 删前的 token，Delete 删后的 token——对称），返回删除后的文本、
 * 新光标位置与删除的 token（调用方须一并清理 mentionBindings）。非 token 位置
 * 返回 null，走原生删除。
 */
export function tokenDeletion(
  value: string,
  pos: number,
  dir: 1 | -1,
  bindings: ReadonlyMap<string, string>,
): { text: string; pos: number; token: string } | null {
  for (const r of mentionTokenRanges(value, bindings)) {
    if (dir === -1 && pos > r.start && pos <= r.end) {
      return { text: value.slice(0, r.start) + value.slice(r.end), pos: r.start, token: value.slice(r.start, r.end) }
    }
    if (dir === 1 && pos >= r.start && pos < r.end) {
      return { text: value.slice(0, r.start) + value.slice(r.end), pos: r.start, token: value.slice(r.start, r.end) }
    }
  }
  return null
}

/**
 * 把 recalled（↑ 拉起）的历史文本里的 canonical `@长路径` 引用还原为显示
 * token（`@短名`），与第一次输入时的形态一致（含绑定注册，高亮/原子导航
 * 可用）。只处理含分隔符的路径引用——无分隔符的 @token（相对路径/命令/
 * 邮箱）保持原样。返回还原后的文本；新增绑定写入传入的 bindings。
 */
export function restoreFileMentionTokens(text: string, bindings: Map<string, string>): string {
  return text.replace(/@"[^"\n]+"|@[^\s，。；：！？、,;!?]+/gu, (mention) => {
    const cleaned = mention.replace(/^@/, '').replace(/^"|"$/g, '')
    if (!/[\\/]/.test(cleaned)) return mention // 无分隔符：不是路径引用，原样
    const name = attachmentBaseName(cleaned)
    if (name.length === 0 || name === cleaned) return mention
    const m = formatFileMention({ path: cleaned, kind: 'file' }, false)
    if (m === undefined) return mention
    const token = fileMentionToken(name, m, bindings)
    bindings.set(token, m)
    return token
  })
}
