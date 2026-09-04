/**
 * @token（@ 引用）区间扫描纯函数——渲染侧与输入侧共用同一套边界与终止规则：
 *  - 渲染侧（userBubble.splitUserBubble）直接消费 scanAtTokens 产出的区间；
 *  - 输入侧（composer 高亮 / 方向键导航 / 原子删除 / 补全 token 展开 /
 *    recall 还原）在扫描起点处按 mentionBindings 做 key 最长匹配
 *    （boundTokenRanges），兼容含空格的显示 token（`@with space.txt`），
 *    `a@img b` 这类词中命中因边界校验自然排除。
 *
 * 触发边界（@ 前一字符）：行首 + `[\s，。；：！？、,;!?]` + 中文开括号
 * `（「『《〔【`。ASCII `(` 不入边界——避免代码/装饰器 `func(@arg)`、
 * `@Component(` 新增误渲染。
 *
 * plain token 逐字符终止规则：
 *  - 无条件终止：空白、中文/全角标点（`\u3000-\u303f` + `，！？；：．･`）、
 *    `\p{So}`（emoji/符号）、ASCII `; ! ? :`；
 *  - 条件终止：`.`/`,` 仅在后跟非续接字符（续接 = `[A-Za-z0-9/_~-]`）时终止；
 *  - 平衡规则：`)`/`）` 终止，除非 token 内已有配对开括号 `(`/`（`；
 *  - 其余 ASCII 标点（`' # & + % $ = @ * < > | " \ [ ]` 等）保持 token 字符。
 *
 * 已知取舍（与官方字符集边界的必然代价，文件引用时留意）：
 *  - 文件名含中文句读标点（如 `，！？．。`）、ASCII `; ! ? :`、emoji/`\p{So}`
 *    会被截断——这些字符按规则作为正文分隔符终止 token；
 *  - 中文开括号 `（` 不是终止符（文件名常见 `a（说明）.docx`），但 `「『《〔【`
 *    在终止集中（`\u3000-\u303f`），`@a「说明」` 这类文件名会被截断。
 */

export interface AtTokenRange {
  /** `@` 的下标（触发点）。 */
  start: number
  /** token 结束下标（不含）。 */
  end: number
  /** 是否走闭合引号分支（`@"…"`）。未闭合引号回落 plain，与官方一致。 */
  quoted: boolean
}

/** @ 触发边界字符集（行首之外的前置字符）；quoted 分支与边界判定共用。 */
export const AT_BOUNDARY_CHARS = '\\s，。；：！？、,;!?（「『《〔【'

const BOUNDARY_RE = new RegExp(`[${AT_BOUNDARY_CHARS}]`, 'u')
const SO_RE = /\p{So}/u

/** 边界判定：行首（undefined）或边界字符集。 */
export function isAtBoundary(before: string | undefined): boolean {
  return before === undefined || BOUNDARY_RE.test(before)
}

/** 中文/全角标点终止集（现状全集：`\u3000-\u303f` + `，！？；：．･`）。 */
function isFullwidthTerminator(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) ||
    cp === 0xff0c || // ，
    cp === 0xff01 || // ！
    cp === 0xff1f || // ？
    cp === 0xff1b || // ；
    cp === 0xff1a || // ：
    cp === 0xff0e || // ．
    cp === 0xff65 //   ･
  )
}

/** ASCII 无条件终止符：; ! ? :（新增——修 `@img1: 说明`、`@a; 看`）。 */
function isAsciiTerminator(cp: number): boolean {
  return cp === 0x3b || cp === 0x21 || cp === 0x3f || cp === 0x3a
}

/** 续接字符集（`.`/`,` 后跟此时不终止）：`[A-Za-z0-9/_~-]`。 */
function isContinuationChar(cp: number | undefined): boolean {
  if (cp === undefined) return false
  return (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0x30 && cp <= 0x39) ||
    cp === 0x2f ||
    cp === 0x5f ||
    cp === 0x7e ||
    cp === 0x2d
  )
}

/**
 * plain token 的结束下标（不含）：从 `@`（text[at] 必须为 '@'）后的第一个字符
 * 按终止规则逐字符扫描。至少推进一位（`@` 单独不成 token 由调用方过滤）。
 */
export function plainTokenEnd(text: string, at: number): number {
  let i = at + 1
  let hasOpenParen = false
  while (i < text.length) {
    const cp = text.codePointAt(i)!
    const ch = text[i]
    if (
      /\s/u.test(ch) ||
      isFullwidthTerminator(cp) ||
      SO_RE.test(String.fromCodePoint(cp)) ||
      isAsciiTerminator(cp)
    ) {
      break
    }
    if ((ch === '.' || ch === ',') && !isContinuationChar(text.codePointAt(i + 1))) break
    if ((ch === ')' || ch === '）') && !hasOpenParen) break
    if (ch === '(' || ch === '（') hasOpenParen = true
    i += cp > 0xffff ? 2 : 1
  }
  return i
}

/**
 * 闭合引号分支的结束下标（不含）：`@"…"` 吃到闭引号（含），内容至少一个字符；
 * 未闭合（到行尾/换行仍无闭引号）或空内容（`@""`）返回 null，回落 plain
 * 扫描——与官方/既有测试语义一致（未闭合引号由 plain 分支按普通字符处理）。
 */
export function quotedTokenEnd(text: string, at: number): number | null {
  let i = at + 2
  if (i >= text.length || text[i] === '"') return null
  while (i < text.length) {
    if (text[i] === '"') return i + 1
    if (text[i] === '\n' || text[i] === '\r') return null
    i += 1
  }
  return null
}

/**
 * 起点的 @token 区间：text[at] 为 '@' 且前置字符是触发边界才算；
 * 否则（词中/邮箱等）返回 null。优先闭合引号分支，未闭合回落 plain。
 */
export function atTokenRangeAt(text: string, at: number): AtTokenRange | null {
  if (text[at] !== '@' || !isAtBoundary(at === 0 ? undefined : text[at - 1])) return null
  if (text[at + 1] === '"') {
    const quotedEnd = quotedTokenEnd(text, at)
    if (quotedEnd !== null) return { start: at, end: quotedEnd, quoted: true }
  }
  return { start: at, end: plainTokenEnd(text, at), quoted: false }
}

/** 文本里全部 @token 区间（按出现顺序，不重叠；引号 token 或 plain token）。 */
export function scanAtTokens(text: string): AtTokenRange[] {
  const ranges: AtTokenRange[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '@') {
      const range = atTokenRangeAt(text, i)
      if (range !== null) {
        ranges.push(range)
        i = range.end
        continue
      }
    }
    i += 1
  }
  return ranges
}

/**
 * 输入侧 @token 区间：在扫描起点（边界校验通过的 @）处按 mentionBindings
 * 做 key 最长匹配——兼容含空格的显示 token（`@with space.txt`），词中命中
 * （`a@img b`）由边界校验自然排除，无需另写 indexOf 扫描，也避免了长短 key
 * 互相抢命中的裸子串匹配。
 *
 * key 匹配后若紧跟续接字符（`[A-Za-z0-9/_~-]`），说明输入中的 token 已被
 * 手动改动、比绑定的 key 更长（如 `@img9.png2`），不复用该 key。
 */
export function boundTokenRanges(
  text: string,
  bindings: ReadonlyMap<string, string>,
): AtTokenRange[] {
  if (bindings.size === 0) return []
  const keys = [...bindings.keys()].filter((k) => k.startsWith('@')).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return []
  const ranges: AtTokenRange[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '@' || !isAtBoundary(i === 0 ? undefined : text[i - 1])) {
      i += 1
      continue
    }
    const key = keys.find((k) => text.startsWith(k, i))
    if (key === undefined || isContinuationChar(text.codePointAt(i + key.length))) {
      i += 1
      continue
    }
    ranges.push({ start: i, end: i + key.length, quoted: key.startsWith('@"') })
    i += key.length
  }
  return ranges
}
