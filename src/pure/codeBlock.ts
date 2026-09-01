/**
 * Markdown 代码块折叠的纯逻辑：超过 maxLines 行时折叠，折叠态显示头部
 * Math.ceil(maxLines/2) 行 + 尾部剩余行，中间给「… 其余 N 行」切换（对齐
 * dsh web 的折叠样式）。无 vscode 依赖，node --test 可测。
 */

/** 代码块折叠阈值（对齐 dsh web 的 16 行）。 */
export const CODE_BLOCK_MAX_LINES = 16

export interface CodeBlockPreview {
  /** 折叠态显示的头部行。 */
  head: string[]
  /** 折叠态显示的尾部行（未折叠时为空数组）。 */
  tail: string[]
  /** 原文总行数。 */
  totalLines: number
  /** 被隐藏的行数（>0 时 UI 显示「… 其余 N 行」）。 */
  hidden: number
}

/**
 * Split a code block's text for the collapsed view. Lines within the limit
 * pass through whole; longer text keeps a head (`Math.ceil(maxLines / 2)`
 * lines) and a tail (the remaining `maxLines - headCount` lines), hiding the
 * lines in between. An empty string counts as one (empty) line and never
 * truncates.
 */
export function codeBlockPreview(text: string, maxLines: number = CODE_BLOCK_MAX_LINES): CodeBlockPreview {
  const lines = text.split('\n')
  const totalLines = lines.length
  if (totalLines <= maxLines) return { head: lines, tail: [], totalLines, hidden: 0 }
  const headCount = Math.ceil(maxLines / 2)
  return {
    head: lines.slice(0, headCount),
    tail: lines.slice(totalLines - (maxLines - headCount)),
    totalLines,
    hidden: totalLines - maxLines,
  }
}
