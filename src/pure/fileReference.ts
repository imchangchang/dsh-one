/**
 * @file 补全的 token 语法与插入文本格式，移植自 host 包 dsh-file-reference
 * 的 grammar（lib/index.js 的 activeAtToken / formatFileMention），保持
 * 与 dsh web 完全一致的触发与序列化行为。官方按"行 + 列"匹配；这里的
 * 入参是光标前的整段文本，(?:^|\s) 里的 \s 覆盖换行，语义等价。
 */
import { attachmentBaseName } from './composerAttachment.ts'
import { AT_BOUNDARY_CHARS, boundTokenRanges, scanAtTokens } from './tokenScan.ts'

/** 光标处活跃的 @ token；不在 @ token 上时为 undefined。 */
export interface ActiveAtToken {
  /** 含 @ 的完整 token 文本（`@sub/que` 或 `@"带空格`），用于定位替换区间。 */
  prefix: string
  /** 去掉 @ / @" 后的查询串，原样发给 fileReferences/list。 */
  query: string
  /** 用户显式开了引号（@"…未闭合）；引号 token 只出文件候选。 */
  quoted: boolean
}

// 未闭合引号分支（与 tokenScan 的闭合引号语义互补：光标处引号未闭合才算
// quoted，闭合引号回落 plain——官方行为，与既有测试一致）。边界集与
// tokenScan 同步（含新增的中文开括号）。
const QUOTED_AT_END = new RegExp(`(?:^|[${AT_BOUNDARY_CHARS}])(@"([^"]*))$`)

/**
 * 提取光标前的 `@path` 或未闭合 `@"path with spaces` token。其它 token
 * 内部的 @（如邮箱地址）不触发补全。边界与终止规则与渲染侧共用
 * （tokenScan.ts）：触发点必须是行首/边界字符后；token 区间由终止规则
 * 决定——光标紧接正文分隔符（`!?;:`、空白、中文标点、emoji、`.`,/ 后无
 * 续接字符等）时不再触发补全。
 */
export function activeAtToken(beforeCursor: string): ActiveAtToken | undefined {
  const quoted = QUOTED_AT_END.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  // plain：取扫描区间里「正好结束在光标处」的那个（同一段文本至多一个）。
  let active: { start: number; end: number } | null = null
  for (const range of scanAtTokens(beforeCursor)) {
    if (range.end === beforeCursor.length) active = range
  }
  if (active === null) return undefined
  return {
    prefix: beforeCursor.slice(active.start, active.end),
    query: beforeCursor.slice(active.start + 1, active.end),
    quoted: false,
  }
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
  for (const r of boundTokenRanges(value, bindings)) {
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
  for (const r of boundTokenRanges(value, bindings)) {
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
 * 邮箱）保持原样。扫描起点与终止规则与渲染侧一致（tokenScan），词中的
 * @（`a@img`）不还原。
 *
 * 反查优先（与发送展开互逆）：sendCurrent 展开是 token → canonical 长路径，
 * 这里先按 canonical 反查绑定里的原 token（含 ` (2)` 后缀的原样键），命中
 * 直接用、不重复注册——上次输入过的形态原样回来；未命中（token 被删过或
 * 从未绑定）再按 fileMentionToken 生成并登记。
 */
export function restoreFileMentionTokens(text: string, bindings: Map<string, string>): string {
  let out = ''
  let cursor = 0
  for (const range of scanAtTokens(text)) {
    const mention = text.slice(range.start, range.end)
    const cleaned = mention.slice(1).replace(/^"|"$/g, '')
    if (!/[\\/]/.test(cleaned)) continue // 无分隔符：不是路径引用，原样
    const name = attachmentBaseName(cleaned)
    if (name.length === 0 || name === cleaned) continue
    const m = formatFileMention({ path: cleaned, kind: 'file' }, false)
    if (m === undefined) continue
    let token: string | null = null
    for (const [key, value] of bindings) {
      if (value === m) {
        token = key
        break
      }
    }
    if (token === null) {
      token = fileMentionToken(name, m, bindings)
      bindings.set(token, m)
    }
    out += text.slice(cursor, range.start) + token
    cursor = range.end
  }
  return out + text.slice(cursor)
}
