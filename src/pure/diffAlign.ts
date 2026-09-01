/**
 * side-by-side diff 的行对齐：把 oldText / newText 按行配对成左右两栏可逐行对比的
 * 行对序列（LCS 对齐；行数过多时退化为行号对齐，避免大 diff 卡死渲染）。
 */

export type DiffPairKind = 'equal' | 'modify' | 'del' | 'add'

export interface DiffPair {
  kind: DiffPairKind
  /** 左栏（老文本）行内容；null = 此行是纯新增（右栏 only）。 */
  oldLine: string | null
  /** 右栏（新文本）行内容；null = 此行是纯删除（左栏 only）。 */
  newLine: string | null
}

/** LCS 动态规划表大小上限，超过退化为行号对齐（1000×1000 行）。 */
const LCS_CELL_LIMIT = 1_000_000

export function alignDiffLines(oldText: string, newText: string): DiffPair[] {
  // 空文本 = 没有行（而非一个空行）：新文件 / 文件被清空不渲染悬空的增删行。
  const oldLines = oldText === '' ? [] : oldText.split('\n')
  const newLines = newText === '' ? [] : newText.split('\n')
  if (oldLines.length * newLines.length > LCS_CELL_LIMIT) return alignByRow(oldLines, newLines)
  return pairUp(runLcs(oldLines, newLines))
}

/** 行号对齐：同号行配对，多出的行按增/删处理。 */
function alignByRow(oldLines: string[], newLines: string[]): DiffPair[] {
  const pairs: DiffPair[] = []
  const n = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < n; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : null
    const newLine = i < newLines.length ? newLines[i] : null
    if (oldLine !== null && newLine !== null) {
      pairs.push({ kind: oldLine === newLine ? 'equal' : 'modify', oldLine, newLine })
    } else if (oldLine !== null) {
      pairs.push({ kind: 'del', oldLine, newLine: null })
    } else {
      pairs.push({ kind: 'add', oldLine: null, newLine })
    }
  }
  return pairs
}

/** 标准 LCS 回溯，产出只含 equal / del / add 的最小编辑序列。 */
function runLcs(oldLines: string[], newLines: string[]): DiffPair[] {
  const n = oldLines.length
  const m = newLines.length
  // dp[i][j] = old[0..i) 与 new[0..j) 的 LCS 长度（从尾向前填表，便于回溯）。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs: DiffPair[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      pairs.push({ kind: 'equal', oldLine: oldLines[i], newLine: newLines[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // 优先走「删 old 行」：保证相邻块里 del 在前、add 在后，pairUp 才能配对。
      pairs.push({ kind: 'del', oldLine: oldLines[i], newLine: null })
      i++
    } else {
      pairs.push({ kind: 'add', oldLine: null, newLine: newLines[j] })
      j++
    }
  }
  while (i < n) pairs.push({ kind: 'del', oldLine: oldLines[i++], newLine: null })
  while (j < m) pairs.push({ kind: 'add', oldLine: null, newLine: newLines[j++] })
  return pairs
}

/**
 * 把相邻的 del 块 + add 块配对成 modify 行对（逐行对齐，行数不等时多余行保持独立），
 * 让修改行在左右两栏水平对齐（同 GitHub side-by-side）。
 */
function pairUp(pairs: DiffPair[]): DiffPair[] {
  const out: DiffPair[] = []
  let i = 0
  while (i < pairs.length) {
    if (pairs[i].kind !== 'del') {
      out.push(pairs[i])
      i++
      continue
    }
    let j = i
    const dels: string[] = []
    while (j < pairs.length && pairs[j].kind === 'del') dels.push(pairs[j].oldLine as string), j++
    const adds: string[] = []
    let k = j
    while (k < pairs.length && pairs[k].kind === 'add') adds.push(pairs[k].newLine as string), k++
    const paired = Math.min(dels.length, adds.length)
    for (let t = 0; t < paired; t++) out.push({ kind: 'modify', oldLine: dels[t], newLine: adds[t] })
    for (let t = paired; t < dels.length; t++) out.push({ kind: 'del', oldLine: dels[t], newLine: null })
    for (let t = paired; t < adds.length; t++) out.push({ kind: 'add', oldLine: null, newLine: adds[t] })
    i = k
  }
  return out
}
