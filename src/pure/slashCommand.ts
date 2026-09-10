/**
 * Decide whether composer text is a slash command (vs. a normal prompt).
 * Pure logic — no `vscode` import.
 *
 * Only the first whitespace-separated token is considered: it counts as a
 * command when it starts with `/` and has no second `/` before the first
 * whitespace. Pasted absolute paths like `/Users/…` contain a second slash,
 * so they route to the model as normal prompts; typos like `/permisison`
 * stay commands and get the unknown-command reply.
 */

export function looksLikeSlashCommand(text: string): boolean {
  const s = text.trimStart()
  if (!s.startsWith('/')) return false
  const end = s.search(/\s/)
  const token = end === -1 ? s : s.slice(0, end)
  return !token.includes('/', 1)
}

/**
 * First token's command name of a slash-command line (same classification as
 * {@link looksLikeSlashCommand}); undefined for prompts, absolute paths, and
 * a bare `/`.
 */
export function slashCommandName(text: string): string | undefined {
  const s = text.trimStart()
  if (!s.startsWith('/')) return undefined
  const end = s.search(/\s/)
  const token = end === -1 ? s : s.slice(0, end)
  if (token.includes('/', 1)) return undefined
  return token.slice(1) || undefined
}

/**
 * Host built-in slash commands the panel may advertise. The composer's list
 * is normally the host's own per-session roster (state.slashCommands, from
 * commands/list), so an advertised command is by definition host-provided;
 * this set matters when the roster fell back to the static table (endpoint
 * missing/fetch failed) or went stale across a preset switch — a host reject
 * then means the host composition (dsh version / session agent preset) lacks
 * the command, not a typo, and the host answers with a targeted notice (see
 * chatMessages.runCommand).
 */
export const HOST_SLASH_COMMAND_NAMES = [
  'compact',
  'export',
  'feedback',
  'goal',
  'permission',
  'plan',
] as const

/** Whether `name` is one of the host-built-in commands the panel advertises. */
export function isHostSlashCommand(name: string): boolean {
  return (HOST_SLASH_COMMAND_NAMES as readonly string[]).includes(name)
}

/** One commands/list entry, narrowed to the fields the panel displays. */
export interface SlashCommandSpecLike {
  name: string
  description: string
  hint?: string
}

/**
 * Narrow one commands/list roster entry (dsh-commands wire: `name`,
 * `description`, optional `input.hint`) to the panel's spec shape; malformed
 * entries drop out (undefined) instead of poisoning the whole roster.
 */
export function asSlashCommandSpec(value: unknown): SlashCommandSpecLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const c = value as { name?: unknown; description?: unknown; input?: { hint?: unknown } }
  if (typeof c.name !== 'string' || typeof c.description !== 'string') return undefined
  return {
    name: c.name,
    description: c.description,
    ...(typeof c.input?.hint === 'string' ? { hint: c.input.hint } : {}),
  }
}

/** One skills/list entry (dsh-skill catalog), narrowed to the displayed fields. */
export interface SkillSpecLike {
  name: string
  description: string
  /** 该 skill 是否也对模型可见；false 时菜单标注「仅用户」。 */
  modelInvocable: boolean
}

/**
 * Narrow one skills/list entry (dsh-api-session-controller wire: `name`,
 * `description`, `whenToUse?`, `modelInvocable`) to the panel's spec shape;
 * malformed entries drop out.
 */
export function asSkillSpec(value: unknown): SkillSpecLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const s = value as { name?: unknown; description?: unknown; modelInvocable?: unknown }
  if (typeof s.name !== 'string' || typeof s.description !== 'string') return undefined
  return { name: s.name, description: s.description, modelInvocable: s.modelInvocable !== false }
}

/**
 * `skills/list` 的返回值可能带一层 {ok,value}（个别 Remote 端点如此）或直接
 * 就是 `{skills}`：两种形状都吃，拿不到列表回空数组（skills 缺失不该挡补全）。
 */
export function asSkillList(value: unknown): SkillSpecLike[] {
  const inner =
    typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true
      ? (value as { value?: unknown }).value
      : value
  const list = (inner as { skills?: unknown } | null | undefined)?.skills
  if (!Array.isArray(list)) return []
  return list.map(asSkillSpec).filter((s): s is SkillSpecLike => s !== undefined)
}

/**
 * 斜杠候选的模糊匹配，逐行移植自官方 dsh-client-ui-commands 的
 * `fuzzyScore`/`fuzzyCandidates`：有序子序列打分（词首/分隔符边界加权、
 * 相邻命中加权、跳字与前置字符扣分），前缀命中整体优先，同分保持原序。
 * 返回 undefined = 不匹配（query 比 name 长，或子序列不成立）。
 */
export function fuzzyScore(name: string, query: string): number | undefined {
  if (query === '') return 0
  if (query.length > name.length) return undefined
  const noMatch = Number.NEGATIVE_INFINITY
  const boundaryBonus = (index: number): number =>
    index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0
  let previous: number[] = new Array<number>(name.length).fill(noMatch)
  for (let index = 0; index < name.length; index += 1) {
    if (name.charAt(index) === query.charAt(0)) previous[index] = 1 + boundaryBonus(index) - index
  }
  for (let queryIndex = 1; queryIndex < query.length; queryIndex += 1) {
    const current: number[] = new Array<number>(name.length).fill(noMatch)
    let bestGapped = noMatch
    for (let index = 0; index < name.length; index += 1) {
      const gappedIndex = index - 2
      if (gappedIndex >= 0) {
        const prior = previous[gappedIndex] ?? noMatch
        if (prior !== noMatch) bestGapped = Math.max(bestGapped, prior + gappedIndex)
      }
      if (name.charAt(index) !== query.charAt(queryIndex)) continue
      const bonus = 1 + boundaryBonus(index)
      const adjacent = index > 0 ? (previous[index - 1] ?? noMatch) : noMatch
      if (adjacent !== noMatch) current[index] = adjacent + bonus + 4
      if (bestGapped !== noMatch) current[index] = Math.max(current[index] ?? noMatch, bestGapped + bonus + 1 - index)
    }
    previous = current
  }
  let best = noMatch
  for (const score of previous) best = Math.max(best, score)
  return best === noMatch ? undefined : best
}

/** 大小写不敏感的模糊过滤：前缀命中优先，其次分数，同分保持原序。 */
export function fuzzyCandidates<T extends { name: string }>(candidates: readonly T[], rawQuery: string): T[] {
  const query = rawQuery.toLowerCase()
  if (query === '') return [...candidates]
  const ranked: Array<{ candidate: T; index: number; prefix: boolean; score: number }> = []
  candidates.forEach((candidate, index) => {
    const name = candidate.name.toLowerCase()
    const score = fuzzyScore(name, query)
    if (score === undefined) return
    ranked.push({ candidate, index, prefix: name.startsWith(query), score })
  })
  ranked.sort(
    (left, right) =>
      Number(right.prefix) - Number(left.prefix) || right.score - left.score || left.index - right.index,
  )
  return ranked.map((match) => match.candidate)
}

/**
 * 官方 dsh-client-ui-commands 的 leadingCommand token：`` `/${name} ` ``（带
 * 尾随空格）。claim 生效时 composer 的整段输入被换成它，其后文本都算这条
 * 命令的参数（ui-commands `leadingClaim`）。
 */
export function slashClaimToken(name: string): string {
  return `/${name} `
}

/**
 * 取参命令（宿主 `input` 非空 → 我们的 roster 里带 `hint`）才能被 claim：
 * 有参数要填，输入框才有「参数模式」可言。裸命令（无 hint）不作 claim。
 */
export function claimableSlashCommand(spec: SlashCommandSpecLike | undefined): boolean {
  return spec !== undefined && typeof spec.hint === 'string' && spec.hint.length > 0
}

/**
 * claim 还在不在：官方 onDraftChanged 的撤销条件——草稿不再以 token 开头就
 * 撤 claim（其余情况（含在 token 后继续打字）保持）。
 */
export function slashClaimHolds(text: string, token: string): boolean {
  return text.startsWith(token)
}
