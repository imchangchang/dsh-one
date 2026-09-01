/**
 * Subagent tool-call card provenance. Pure logic — no `vscode` import.
 *
 * A fork of a parent session copies the parent's event stream verbatim,
 * including the history `subagent` tool calls (`tool/call` + `tool/result`
 * placeholder, e.g. `{kind:'continuable', subagentId}`). The copied child is a
 * clean snapshot: the subagent it references is NOT in the child's lineage
 * (its `parentSessionId` points back at the original parent), so the card's
 *「N 个子代理」chip / breadcrumb / lineage tree do not recognise it. This module
 * tells the renderer whether such a card is a snapshot copy, so it can append
 * a「快照副本」annotation instead of implying the subagent still lives here.
 *
 * Detection relies only on what a rendered tool block carries: the tool name
 * (`subagent`), its settled status, and the result text. The durable id is read
 * from the result output (the host renders a continuable result as
 * `started subagent <session-id>`), then checked against the current session's
 * lineage tree. Background-job results (`started background subagent job
 * <job-id>`) and foreground results are not lineage sessions, so they are never
 * annotated.
 */

import type { SubagentNode } from './chatContract.ts'

/**
 * The lineage subagent id of a settled `subagent` tool call, or undefined when
 * the output does not name one (background job, foreground result, unparsable).
 * Handles both the host's rendered text (`started subagent session-x`) and a
 * persisted raw result object (`{"kind":"continuable","subagentId":"..."}`).
 */
export function subagentIdFromOutput(output: string | undefined): string | undefined {
  if (!output) return undefined
  const trimmed = output.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { kind?: unknown; subagentId?: unknown }
      if (parsed?.kind === 'continuable' && typeof parsed.subagentId === 'string' && parsed.subagentId) {
        return parsed.subagentId
      }
      // Raw background/foreground result: not a lineage session id.
      return undefined
    } catch {
      // Not JSON — fall through to the rendered-text form.
    }
  }
  // "started subagent session-x". The background variant ("started background
  // subagent job …") does not start with "started subagent", so it is excluded.
  const m = trimmed.match(/^started subagent ([^\s]+)/)
  return m ? m[1] : undefined
}

/** Whether `id` appears anywhere in the lineage tree (root or a descendant). */
export function subagentInTree(tree: readonly SubagentNode[] | undefined, id: string): boolean {
  if (!tree) return false
  return tree.some((n) => n.sessionId === id || (n.children ? subagentInTree(n.children, id) : false))
}
