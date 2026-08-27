/**
 * Workspace-list diffing for the empty-window fusion bridge.
 * Pure logic — no `vscode` import.
 */

export interface WorkspaceEntry {
  workspaceId: string
  path: string
}

/** Paths of workspaces present in `next` but not in `prev` (matched by workspaceId). */
export function newWorkspacePaths(prev: WorkspaceEntry[], next: WorkspaceEntry[]): string[] {
  const known = new Set(prev.map((w) => w.workspaceId))
  return next.filter((w) => !known.has(w.workspaceId)).map((w) => w.path)
}
