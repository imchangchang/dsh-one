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
