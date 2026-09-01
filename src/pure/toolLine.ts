/**
 * 工具调用行式排版的纯逻辑：工具名 → kimi-cli 风格英文动作短语，以及工具
 * 输出的行数截断（默认只显示前几行 + 「共 N 行」展开提示）。无 vscode
 * 依赖，node --test 可测。
 */

/** kimi-cli 风格动作短语表（精确匹配，工具名小写后查表）。 */
const TOOL_ACTIONS: Record<string, string> = {
  bash: 'Ran a command',
  shell: 'Ran a command',
  read: 'Read',
  write: 'Using Write',
  str_replace_editor: 'Edited',
  edit: 'Edited',
  grep: 'Searched',
  glob: 'Searched',
  search: 'Searched',
  web_search: 'Searched the web',
  web_fetch: 'Fetched',
  fetch: 'Fetched',
  task: 'Ran a subagent',
  subagent: 'Ran a subagent',
}

/** 子串兜底（顺序即优先级）：官方/第三方工具名没进精确表时用。 */
const TOOL_ACTION_SUBSTRINGS: Array<[substring: string, phrase: string]> = [
  ['bash', 'Ran a command'],
  ['shell', 'Ran a command'],
  ['read', 'Read'],
  ['write', 'Using Write'],
  ['edit', 'Edited'],
  ['search', 'Searched'],
  ['grep', 'Searched'],
  ['fetch', 'Fetched'],
  ['agent', 'Ran a subagent'],
]

/**
 * Tool name → action phrase (kimi-cli style English verb phrase). Exact
 * lowercase match first, then substring heuristics; unknown tools keep their
 * raw name. The caller appends the host-computed title (e.g. the file path
 * for read) after the phrase.
 */
export function toolAction(name: string): string {
  const lower = name.trim().toLowerCase()
  const exact = TOOL_ACTIONS[lower]
  if (exact) return exact
  for (const [substring, phrase] of TOOL_ACTION_SUBSTRINGS) {
    if (lower.includes(substring)) return phrase
  }
  return name
}

/** Whether a tool's detail line is a shell command (rendered with a "$ " prefix). */
export function isCommandTool(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return lower === 'bash' || lower === 'shell' || lower.endsWith('bash') || lower.endsWith('shell')
}

/** 工具输出截断后默认展示的行数（对齐 kimi-cli 的预览长度）。 */
export const OUTPUT_PREVIEW_LINES = 5

export interface LinePreview {
  /** 截断后的预览文本（未截断时即原文）。 */
  preview: string
  /** 原文总行数。 */
  totalLines: number
  /** 是否有被藏起来的行（true 时 UI 给「共 N 行，点击展开」提示）。 */
  truncated: boolean
}

/**
 * First `maxLines` lines of a tool output. Split on '\n'; an empty string
 * counts as one (empty) line and never truncates. Trailing newline does not
 * add a phantom line to the preview — the tail lines are simply hidden.
 */
export function truncateLines(text: string, maxLines: number = OUTPUT_PREVIEW_LINES): LinePreview {
  const lines = text.split('\n')
  const totalLines = lines.length
  if (totalLines <= maxLines) return { preview: text, totalLines, truncated: false }
  return { preview: lines.slice(0, maxLines).join('\n'), totalLines, truncated: true }
}

/**
 * 工具输入参数的可读 JSON：合法就 2 空格缩进美化（工具卡展开的 IN 展示），
 * 解析失败原样返回——模型偶发输出非严格 JSON，退化为原文不吞信息。
 */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
