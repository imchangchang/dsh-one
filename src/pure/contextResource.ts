/**
 * Pure helpers for resolving the resource a context-menu command was invoked
 * on. VSCode passes different argument shapes per menu location — the
 * explorer hands the resource `Uri` directly, `editor/context` may hand an
 * args object like `{ resourceUri }` — and the host falls back to the active
 * editor. No vscode import; duck-typed so it stays unit-testable.
 */

/** The local file a context-menu command should act on. */
export interface ContextMenuResource {
  /** Absolute on-disk path (Uri.fsPath semantics). */
  fsPath: string
  /**
   * Declared URI scheme when the source carried one ('file' for local files);
   * undefined for bare { fsPath } blobs with no scheme info.
   */
  scheme?: string
}

/** Whether a value looks like a VSCode Uri (fsPath string, optional scheme). */
function isUriLike(v: unknown): v is { fsPath: string; scheme?: string } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.fsPath === 'string' && (o.scheme === undefined || typeof o.scheme === 'string')
}

/**
 * Resolve the resource from a context-menu command's first argument. Accepts
 * the `Uri` itself, an args object carrying `resourceUri` / `uri` (the two
 * shapes VSCode actually passes), or a bare `{ fsPath }` blob; undefined when
 * none of them names a local path. The caller falls back to the active editor.
 */
export function contextMenuResource(arg: unknown): ContextMenuResource | undefined {
  if (isUriLike(arg)) {
    return { fsPath: arg.fsPath, scheme: arg.scheme }
  }
  if (arg && typeof arg === 'object') {
    const o = arg as Record<string, unknown>
    for (const key of ['resourceUri', 'uri'] as const) {
      if (isUriLike(o[key])) {
        const target = o[key]
        return { fsPath: target.fsPath, scheme: target.scheme }
      }
    }
  }
  return undefined
}
