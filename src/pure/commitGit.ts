/**
 * commit 卡查询的 git CLI 数据面（纯函数，便于单测）。
 *
 * 与 vscode.git 扩展 API 完全独立：extension host 用 git 二进制直接查提交，
 * 兜底「窗口没打开该仓库」时 commit 卡（作者/时间/message/变更统计/命令行）仍能
 * 显示。解析对象是 `git log/show -s --format=<GIT_INFO_FORMAT> --shortstat` 的输出，
 * 字段集与 vscode.git 的 getCommit 对齐（hash/message/author/commitDate/shortStat）。
 */
import type { CommitInfoResult } from './chatContract.ts'

/**
 * 一条命令拿 6 个字段：%H(完整 40 位 hash) %an %ae %aI(作者日期 ISO8601)
 * %s(subject 首行) %b(body)，字段间 NUL 分隔，末尾 %x00 作记录终止符——
 * message 是纯文本不含 NUL，所以解析时 NUL 分隔可靠（换行只出现在 body 里）。
 */
export const GIT_INFO_FORMAT = '%H%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00'

/** --shortstat 的变更统计（字段与 vscode.git Commit.shortStat 同形，缺失即 undefined）。 */
export interface GitShortStat {
  files?: number
  insertions?: number
  deletions?: number
}

/** git show/log -s --format=<GIT_INFO_FORMAT> --shortstat 的一条提交记录。 */
export interface GitShowRecord {
  /** 完整 40 位 hash（git 总是全量输出，与查询时传入的缩略 sha 无关）。 */
  hash: string
  authorName: string
  authorEmail: string
  /** 作者日期 ISO 8601（%aI），如 2026-09-03T10:00:00+08:00。 */
  isoDate: string
  /** subject（首行）。 */
  subject: string
  /** body（不含 subject；可为空，含换行）。 */
  body: string
  /** --shortstat 变更统计；merge 等无统计输出的记录缺省。 */
  shortStat?: GitShortStat
}

/**
 * 解析 `git log --no-walk --format=<GIT_INFO_FORMAT> --shortstat <sha…>` 的整段输出。
 *
 * 输出结构（每条记录间无分隔符，只有记录自身的终止 NUL）：每条记录 = 6 个 NUL
 * 分隔字段，随后是「\n + --shortstat 统计行」，再紧跟下一条记录。字段本身不含
 * NUL，所以按「40 位 hash + 5 个 NUL 分隔字段」逐条匹配是确定的；匹配之间的文本
 * 就是上一条记录的 --shortstat（可能为空，如 merge 提交）。
 */
export function parseGitShowOutput(stdout: string): GitShowRecord[] {
  const records: GitShowRecord[] = []
  const recordRe = /([0-9a-f]{40})\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00/g
  let lastEnd = 0
  for (const m of stdout.matchAll(recordRe)) {
    if (records.length > 0) {
      // 上一条记录 end 与本条记录 start 之间，夹着上一条的 --shortstat 文本
      records[records.length - 1].shortStat = parseShortStatText(stdout.slice(lastEnd, m.index))
    }
    records.push({
      hash: m[1],
      authorName: m[2],
      authorEmail: m[3],
      isoDate: m[4],
      subject: m[5],
      body: m[6],
    })
    lastEnd = m.index + m[0].length
  }
  if (records.length > 0) {
    records[records.length - 1].shortStat = parseShortStatText(stdout.slice(lastEnd))
  }
  return records
}

/**
 * 解析 --shortstat 统计文本（git 输出带前导换行/空行；merge 等无统计时不含统计行）。
 * 形状：` 1 file changed, 1 insertion(+)` / ` 2 files changed, 30 insertions(+), 5 deletions(-)`
 * / ` 1 file changed, 2 deletions(-)`（纯删除无 insertions 段）；数字可带千分位逗号。
 */
export function parseShortStatText(text: string): GitShortStat | undefined {
  const m = text.match(
    /([\d,]+) files? changed(?:,\s*([\d,]+) insertions?\(\+\))?(?:,\s*([\d,]+) deletions?\(-\))?/,
  )
  if (!m) return undefined
  const num = (s: string | undefined): number | undefined => (s ? Number(s.replace(/,/g, '')) : undefined)
  return { files: num(m[1]) ?? 0, insertions: num(m[2]), deletions: num(m[3]) }
}

/**
 * 从仓库 remote fetchUrl 推导 GitHub commit 链接；非 GitHub 仓库返回 undefined。
 * 支持 https://github.com/owner/repo.git 与 git@github.com:owner/repo.git 两种形状。
 * vscode.git 路径与 git CLI 兜底（origin remote）共用这一个解析，不再各写一份。
 */
export function githubUrlFromRemoteUrl(fetchUrl: string | undefined, sha: string): string | undefined {
  const url = (fetchUrl ?? '').trim()
  const m = url.match(/(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return undefined
  return `https://github.com/${m[1]}/${m[2]}/commit/${sha}`
}

/**
 * 提交日期格式化为 ISO 完整时间戳（YYYY-MM-DDTHH:mm），悬浮卡的相对时间计算与
 * 命令行短 hash 展示都用它。只留日期会导致 webview new Date() 解析丢时区偏移，
 * 显示「N hours ago」比真实时间差几个小时（同日提交会偏到半天）。
 */
export function formatCommitDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/**
 * 把 CLI 查询记录投影成 webview 用的信息（subject 首行 + 完整 message + 作者 +
 * 日期 + 变更统计），与 vscode.git 路径的 commitInfoFrom 同构——webview 拿到的是
 * 同一种 CommitInfoResult，数据来源透明。
 */
export function commitInfoFromShowRecord(sha: string, rec: GitShowRecord): CommitInfoResult {
  const subject = rec.subject.trim()
  const body = rec.body.trim()
  return {
    sha,
    commitHash: rec.hash,
    found: true,
    message: subject,
    fullMessage: body.length > 0 ? `${subject}\n${body}` : subject,
    authorName: rec.authorName,
    authorEmail: rec.authorEmail.length > 0 ? rec.authorEmail : undefined,
    commitDate: formatCommitDate(new Date(rec.isoDate)),
    files: rec.shortStat?.files,
    insertions: rec.shortStat?.insertions,
    deletions: rec.shortStat?.deletions,
  }
}
