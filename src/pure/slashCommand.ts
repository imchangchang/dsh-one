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
