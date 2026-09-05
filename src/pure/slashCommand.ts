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
 * The panel's built-in slash commands mirrored from the host's commands/list
 * under a stock preset (keep in sync with webview.ts SLASH_COMMANDS minus the
 * client-side `/model`). When the host rejects one of these while the panel
 * advertises it, the cause is the host composition (dsh version / session
 * agent preset), not a typo — the host uses it to pick a targeted notice
 * (see chatMessages.runCommand).
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
