/**
 * @file 补全的 token 语法与插入文本格式，移植自 host 包 dsh-file-reference
 * 的 grammar（lib/index.js 的 activeAtToken / formatFileMention），保持
 * 与 dsh web 完全一致的触发与序列化行为。官方按"行 + 列"匹配；这里的
 * 入参是光标前的整段文本，(?:^|\s) 里的 \s 覆盖换行，语义等价。
 */

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
 * 内部的 @（如邮箱地址）不触发补全。
 */
export function activeAtToken(beforeCursor: string): ActiveAtToken | undefined {
  const quoted = /(?:^|\s)(@"([^"]*))$/.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  const plain = /(?:^|\s)(@(\S*))$/.exec(beforeCursor)
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
